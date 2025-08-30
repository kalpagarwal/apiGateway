const BasePlugin = require('../src/plugins/basePlugin');
const fs = require('fs');
const path = require('path');

class RequestLoggerPlugin extends BasePlugin {
    constructor() {
        super();
        
        this.name = 'RequestLogger';
        this.version = '1.0.0';
        this.description = 'Logs detailed request information to files';
        this.author = 'API Gateway Team';
        
        this.logFile = null;
        this.requestCount = 0;
    }
    
    async initialize(config = {}) {
        await super.initialize(config);
        
        const logDir = this.getConfig('logDir') || path.join(__dirname, '../logs/requests');
        
        // Ensure log directory exists
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        // Create log file with timestamp
        const timestamp = new Date().toISOString().split('T')[0];
        this.logFile = path.join(logDir, `requests-${timestamp}.log`);
        
        this.log('info', 'Request logger initialized', { logFile: this.logFile });
    }
    
    async beforeRequest(context) {
        const { req } = context;
        
        this.requestCount++;
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
            method: req.method,
            url: req.url,
            path: req.path,
            query: req.query,
            headers: this.sanitizeHeaders(req.headers),
            ip: this.getClientIP(req),
            userAgent: req.headers['user-agent'],
            requestCount: this.requestCount
        };
        
        // Write to log file
        if (this.logFile) {
            const logLine = JSON.stringify(logEntry) + '\n';
            fs.appendFileSync(this.logFile, logLine);
        }
        
        // Add to request for later use
        req.pluginData = req.pluginData || {};
        req.pluginData.requestLogger = {
            startTime: Date.now(),
            logEntry
        };
        
        this.log('debug', 'Request logged', { requestId: req.requestId });
        
        return context;
    }
    
    async afterResponse(context) {
        const { req, res } = context;
        
        if (req.pluginData?.requestLogger) {
            const { startTime } = req.pluginData.requestLogger;
            const responseTime = Date.now() - startTime;
            
            const responseEntry = {
                timestamp: new Date().toISOString(),
                requestId: req.requestId,
                statusCode: res.statusCode,
                responseTime: responseTime,
                contentLength: res.getHeader('content-length') || 0,
                cacheStatus: res.getHeader('x-cache') || 'N/A'
            };
            
            // Write response log
            if (this.logFile) {
                const logLine = JSON.stringify({ ...responseEntry, type: 'response' }) + '\n';
                fs.appendFileSync(this.logFile, logLine);
            }
            
            this.log('debug', 'Response logged', { 
                requestId: req.requestId, 
                responseTime: `${responseTime}ms` 
            });
        }
        
        return context;
    }
    
    async onError(context) {
        const { req, error } = context;
        
        const errorEntry = {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
            type: 'error',
            errorName: error.name,
            errorMessage: error.message,
            statusCode: error.status || 500,
            stack: error.stack
        };
        
        // Write error log
        if (this.logFile) {
            const logLine = JSON.stringify(errorEntry) + '\n';
            fs.appendFileSync(this.logFile, logLine);
        }
        
        this.log('error', 'Error logged', { 
            requestId: req.requestId, 
            error: error.message 
        });
        
        return context;
    }
    
    /**
     * Sanitize headers for logging (remove sensitive information)
     */
    sanitizeHeaders(headers) {
        const sanitized = { ...headers };
        const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'password'];
        
        sensitiveHeaders.forEach(header => {
            if (sanitized[header]) {
                sanitized[header] = '[REDACTED]';
            }
        });
        
        return sanitized;
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
     * Get plugin statistics
     */
    getStats() {
        return {
            requestCount: this.requestCount,
            logFile: this.logFile,
            initialized: this.initialized
        };
    }
    
    async cleanup() {
        this.log('info', 'Request logger shutting down', {
            totalRequests: this.requestCount
        });
        
        await super.cleanup();
    }
}

module.exports = RequestLoggerPlugin;
