const BasePlugin = require('../src/plugins/basePlugin');

class SecurityHeadersPlugin extends BasePlugin {
    constructor() {
        super();
        
        this.name = 'SecurityHeaders';
        this.version = '1.0.0';
        this.description = 'Adds comprehensive security headers to responses';
        this.author = 'API Gateway Team';
        
        this.defaultHeaders = {
            'X-Powered-By-Gateway': 'API-Gateway/1.0.0',
            'X-Request-ID': null, // Will be set per request
            'X-Response-Time': null, // Will be calculated
            'X-RateLimit-Remaining': null, // Will be set if available
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
        };
    }
    
    async initialize(config = {}) {
        await super.initialize(config);
        
        // Merge custom headers from config
        const customHeaders = this.getConfig('headers') || {};
        this.defaultHeaders = { ...this.defaultHeaders, ...customHeaders };
        
        // Override specific headers if provided
        const overrides = this.getConfig('overrides') || {};
        Object.assign(this.defaultHeaders, overrides);
        
        this.log('info', 'Security headers plugin initialized', {
            headerCount: Object.keys(this.defaultHeaders).length
        });
    }
    
    async beforeResponse(context) {
        const { req, res } = context;
        
        // Add all security headers
        Object.entries(this.defaultHeaders).forEach(([header, value]) => {
            if (value !== null) {
                res.setHeader(header, value);
            }
        });
        
        // Set request ID
        if (req.requestId) {
            res.setHeader('X-Request-ID', req.requestId);
        }
        
        // Calculate and set response time if available
        if (req.pluginData?.analyticsTracker?.startTime) {
            const responseTime = Date.now() - req.pluginData.analyticsTracker.startTime;
            res.setHeader('X-Response-Time', `${responseTime}ms`);
        }
        
        // Set rate limit info if available
        if (req.rateLimit) {
            res.setHeader('X-RateLimit-Limit', req.rateLimit.limit);
            res.setHeader('X-RateLimit-Remaining', req.rateLimit.remaining);
            res.setHeader('X-RateLimit-Reset', req.rateLimit.reset);
        }
        
        // Add cache headers if not already set
        if (!res.getHeader('Cache-Control')) {
            const cacheControl = this.getCacheControlForPath(req.path);
            if (cacheControl) {
                res.setHeader('Cache-Control', cacheControl);
            }
        }
        
        // Add CORS headers if not already set by CORS middleware
        if (!res.getHeader('Access-Control-Allow-Origin') && this.getConfig('corsEnabled')) {
            res.setHeader('Access-Control-Allow-Origin', this.getConfig('corsOrigin') || '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
        }
        
        this.log('debug', 'Security headers added', { 
            requestId: req.requestId,
            path: req.path
        });
        
        return context;
    }
    
    /**
     * Get appropriate cache control for path
     */
    getCacheControlForPath(path) {
        const cacheRules = this.getConfig('cacheRules') || {};
        
        for (const [pattern, control] of Object.entries(cacheRules)) {
            if (path.startsWith(pattern)) {
                return control;
            }
        }
        
        // Default cache control
        return this.getConfig('defaultCacheControl') || null;
    }
    
    /**
     * Handle security violations
     */
    async onError(context) {
        const { req, res, error } = context;
        
        // Add security headers even for error responses
        Object.entries(this.defaultHeaders).forEach(([header, value]) => {
            if (value !== null && !res.headersSent) {
                res.setHeader(header, value);
            }
        });
        
        // Log security-related errors
        if (this.isSecurityError(error)) {
            this.log('warn', 'Security error detected', {
                requestId: req.requestId,
                error: error.message,
                path: req.path,
                ip: this.getClientIP(req)
            });
        }
        
        return context;
    }
    
    /**
     * Check if error is security-related
     */
    isSecurityError(error) {
        const securityErrors = [
            'Unauthorized',
            'Forbidden',
            'ValidationError',
            'AuthenticationError',
            'RateLimitError'
        ];
        
        return securityErrors.includes(error.name) || 
               error.status === 401 || 
               error.status === 403 ||
               error.status === 429;
    }
    
    /**
     * Get client IP address
     */
    getClientIP(req) {
        return req.headers['x-forwarded-for'] ||
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress ||
               req.socket.remoteAddress ||
               req.ip;
    }
    
    /**
     * Get current security configuration
     */
    getSecurityConfig() {
        return {
            headers: this.defaultHeaders,
            corsEnabled: this.getConfig('corsEnabled'),
            corsOrigin: this.getConfig('corsOrigin'),
            cacheRules: this.getConfig('cacheRules'),
            defaultCacheControl: this.getConfig('defaultCacheControl')
        };
    }
}

module.exports = SecurityHeadersPlugin;
