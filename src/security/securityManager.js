const logger = require('../utils/logger');
const validator = require('validator');

class SecurityManager {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            helmet: config.helmet || {},
            cors: config.cors || {
                origin: '*',
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
                credentials: true
            },
            inputValidation: config.inputValidation !== false,
            sanitization: config.sanitization !== false,
            xss: config.xss !== false,
            sqlInjection: config.sqlInjection !== false,
            maxRequestSize: config.maxRequestSize || '10mb',
            blacklistedIPs: config.blacklistedIPs || [],
            whitelistedIPs: config.whitelistedIPs || [],
            suspiciousPatterns: config.suspiciousPatterns || [
                /(<script|<\/script|javascript:|on\w+\s*=)/gi,
                /(union|select|insert|update|delete|drop|create|alter|exec|execute|script|javascript)/gi,
                /(\.\.\/|\.\.\\ )/g
            ]
        };
        
        this.securityViolations = new Map();
    }
    
    /**
     * Initialize security manager
     */
    async initialize() {
        if (!this.config.enabled) {
            logger.info('Security manager disabled');
            return;
        }
        
        logger.info('Security manager initialized');
    }
    
    /**
     * Security middleware
     */
    middleware() {
        return (req, res, next) => {
            if (!this.config.enabled) {
                return next();
            }
            
            try {
                // Check IP blacklist/whitelist
                if (!this.checkIPAccess(req)) {
                    return this.blockRequest(req, res, 'IP blocked');
                }
                
                // Validate and sanitize input
                if (this.config.inputValidation) {
                    this.validateInput(req);
                }
                
                if (this.config.sanitization) {
                    this.sanitizeInput(req);
                }
                
                // Check for security threats
                if (this.detectSecurityThreats(req)) {
                    return this.blockRequest(req, res, 'Security threat detected');
                }
                
                // Add security headers
                this.addSecurityHeaders(res);
                
                next();
                
            } catch (error) {
                logger.error('Security middleware error:', error);
                
                if (error.name === 'SecurityError') {
                    return this.blockRequest(req, res, error.message);
                }
                
                next(error);
            }
        };
    }
    
    /**
     * Check IP access
     */
    checkIPAccess(req) {
        const clientIP = this.getClientIP(req);
        
        // Check whitelist first
        if (this.config.whitelistedIPs.length > 0) {
            return this.config.whitelistedIPs.includes(clientIP);
        }
        
        // Check blacklist
        if (this.config.blacklistedIPs.includes(clientIP)) {
            this.recordViolation(clientIP, 'IP_BLACKLISTED');
            return false;
        }
        
        return true;
    }
    
    /**
     * Validate input
     */
    validateInput(req) {
        // Validate headers
        Object.entries(req.headers).forEach(([key, value]) => {
            if (typeof value === 'string' && value.length > 8192) {
                throw new SecurityError(`Header ${key} too large`);
            }
        });
        
        // Validate query parameters
        if (req.query) {
            Object.entries(req.query).forEach(([key, value]) => {
                this.validateParameter(key, value, 'query');
            });
        }
        
        // Validate body
        if (req.body) {
            this.validateBody(req.body);
        }
    }
    
    /**
     * Validate parameter
     */
    validateParameter(key, value, source) {
        // Check key length
        if (key.length > 100) {
            throw new SecurityError(`Parameter key too long in ${source}`);
        }
        
        // Check value
        if (typeof value === 'string') {
            if (value.length > 10000) {
                throw new SecurityError(`Parameter value too long in ${source}`);
            }
            
            // Check for SQL injection patterns
            if (this.config.sqlInjection && this.detectSQLInjection(value)) {
                throw new SecurityError(`SQL injection detected in ${source}`);
            }
            
            // Check for XSS patterns
            if (this.config.xss && this.detectXSS(value)) {
                throw new SecurityError(`XSS detected in ${source}`);
            }
        }
    }
    
    /**
     * Validate request body
     */
    validateBody(body, depth = 0) {
        if (depth > 10) {
            throw new SecurityError('Body nesting too deep');
        }
        
        if (typeof body === 'object' && body !== null) {
            Object.entries(body).forEach(([key, value]) => {
                this.validateParameter(key, value, 'body');
                
                if (typeof value === 'object') {
                    this.validateBody(value, depth + 1);
                }
            });
        }
    }
    
    /**
     * Sanitize input
     */
    sanitizeInput(req) {
        // Sanitize query parameters
        if (req.query) {
            req.query = this.sanitizeObject(req.query);
        }
        
        // Sanitize body
        if (req.body) {
            req.body = this.sanitizeObject(req.body);
        }
        
        // Sanitize headers (be careful not to break functionality)
        const sanitizedHeaders = {};
        Object.entries(req.headers).forEach(([key, value]) => {
            if (typeof value === 'string') {
                sanitizedHeaders[key] = this.sanitizeString(value, true);
            } else {
                sanitizedHeaders[key] = value;
            }
        });
        req.headers = sanitizedHeaders;
    }
    
    /**
     * Sanitize object recursively
     */
    sanitizeObject(obj) {
        if (typeof obj === 'string') {
            return this.sanitizeString(obj);
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item));
        }
        
        if (typeof obj === 'object' && obj !== null) {
            const sanitized = {};
            Object.entries(obj).forEach(([key, value]) => {
                sanitized[key] = this.sanitizeObject(value);
            });
            return sanitized;
        }
        
        return obj;
    }
    
    /**
     * Sanitize string
     */
    sanitizeString(str, isHeader = false) {
        if (typeof str !== 'string') return str;
        
        // Basic sanitization
        let sanitized = str.trim();
        
        if (!isHeader) {
            // Remove HTML tags
            sanitized = sanitized.replace(/<[^>]*>/g, '');
            
            // Escape special characters
            sanitized = validator.escape(sanitized);
        }
        
        return sanitized;
    }
    
    /**
     * Detect security threats
     */
    detectSecurityThreats(req) {
        const threats = [];
        
        // Check URL path
        if (this.detectPathTraversal(req.path)) {
            threats.push('PATH_TRAVERSAL');
        }
        
        // Check all input for suspicious patterns
        const input = JSON.stringify({
            query: req.query,
            body: req.body,
            headers: req.headers
        });
        
        for (const pattern of this.config.suspiciousPatterns) {
            if (pattern.test(input)) {
                threats.push('SUSPICIOUS_PATTERN');
                break;
            }
        }
        
        if (threats.length > 0) {
            const clientIP = this.getClientIP(req);
            threats.forEach(threat => {
                this.recordViolation(clientIP, threat);
            });
            
            logger.warn('Security threats detected', {
                threats,
                requestId: req.requestId,
                ip: clientIP
            });
            
            return true;
        }
        
        return false;
    }
    
    /**
     * Detect SQL injection
     */
    detectSQLInjection(value) {
        const sqlPatterns = [
            /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/gi,
            /(--|#|\/\*|\*\/)/g,
            /(\bor\b\s*\d+\s*=\s*\d+|\band\b\s*\d+\s*=\s*\d+)/gi
        ];
        
        return sqlPatterns.some(pattern => pattern.test(value));
    }
    
    /**
     * Detect XSS
     */
    detectXSS(value) {
        const xssPatterns = [
            /<script[^>]*>[\s\S]*?<\/script>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi,
            /<iframe/gi,
            /<embed/gi,
            /<object/gi
        ];
        
        return xssPatterns.some(pattern => pattern.test(value));
    }
    
    /**
     * Detect path traversal
     */
    detectPathTraversal(path) {
        const traversalPatterns = [
            /\.\.\//g,
            /\.\.\\/g,
            /%2e%2e%2f/gi,
            /%252e%252e%252f/gi
        ];
        
        return traversalPatterns.some(pattern => pattern.test(path));
    }
    
    /**
     * Add security headers
     */
    addSecurityHeaders(res) {
        // These are in addition to helmet headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    }
    
    /**
     * Block request
     */
    blockRequest(req, res, reason) {
        const clientIP = this.getClientIP(req);
        
        logger.warn('Request blocked', {
            reason,
            ip: clientIP,
            requestId: req.requestId,
            path: req.path
        });
        
        res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied',
            requestId: req.requestId
        });
    }
    
    /**
     * Record security violation
     */
    recordViolation(ip, type) {
        if (!this.securityViolations.has(ip)) {
            this.securityViolations.set(ip, []);
        }
        
        const violations = this.securityViolations.get(ip);
        violations.push({
            type,
            timestamp: Date.now()
        });
        
        // Keep only last 100 violations per IP
        if (violations.length > 100) {
            violations.shift();
        }
        
        // Auto-blacklist if too many violations
        const recentViolations = violations.filter(v => 
            Date.now() - v.timestamp < 3600000 // Last hour
        );
        
        if (recentViolations.length > 10 && !this.config.blacklistedIPs.includes(ip)) {
            this.config.blacklistedIPs.push(ip);
            logger.warn('IP auto-blacklisted due to violations', { ip, violations: recentViolations.length });
        }
    }
    
    /**
     * Get client IP
     */
    getClientIP(req) {
        return req.headers['x-forwarded-for'] ||
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress ||
               req.socket.remoteAddress ||
               req.ip;
    }
    
    /**
     * Get security statistics
     */
    getStats() {
        const stats = {
            enabled: this.config.enabled,
            blacklistedIPs: this.config.blacklistedIPs.length,
            whitelistedIPs: this.config.whitelistedIPs.length,
            violations: {}
        };
        
        this.securityViolations.forEach((violations, ip) => {
            stats.violations[ip] = violations.length;
        });
        
        return stats;
    }
    
    /**
     * Cleanup
     */
    async cleanup() {
        this.securityViolations.clear();
        logger.info('Security manager cleaned up');
    }
}

/**
 * Security Error
 */
class SecurityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SecurityError';
        this.status = 403;
    }
}

module.exports = SecurityManager;
module.exports.SecurityError = SecurityError;
