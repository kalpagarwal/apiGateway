const logger = require('../utils/logger');

class ResponseTransformer {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            transformations: config.transformations || {},
            headerMappings: config.headerMappings || {},
            addHeaders: config.addHeaders || {},
            removeHeaders: config.removeHeaders || [],
            bodyTransformations: config.bodyTransformations || {}
        };
        
        this.transformationRules = new Map();
        this.initializeTransformations();
    }
    
    initializeTransformations() {
        Object.entries(this.config.transformations).forEach(([path, rules]) => {
            this.transformationRules.set(path, rules);
        });
    }
    
    middleware() {
        return (req, res, next) => {
            if (!this.config.enabled) {
                return next();
            }
            
            const originalSend = res.send;
            const originalJson = res.json;
            
            res.send = (body) => {
                try {
                    const transformedBody = this.transformResponse(req, res, body);
                    this.transformResponseHeaders(req, res);
                    return originalSend.call(res, transformedBody);
                } catch (error) {
                    logger.error('Response transformation error:', error);
                    return originalSend.call(res, body);
                }
            };
            
            res.json = (obj) => {
                try {
                    const transformedObj = this.transformJsonResponse(req, res, obj);
                    this.transformResponseHeaders(req, res);
                    return originalJson.call(res, transformedObj);
                } catch (error) {
                    logger.error('JSON response transformation error:', error);
                    return originalJson.call(res, obj);
                }
            };
            
            next();
        };
    }
    
    transformResponse(req, res, body) {
        if (!body) return body;
        
        try {
            let responseData = body;
            let isJson = false;
            
            if (typeof body === 'string') {
                try {
                    responseData = JSON.parse(body);
                    isJson = true;
                } catch (e) {
                    return this.transformTextResponse(req, res, body);
                }
            }
            
            const transformedData = this.transformJsonResponse(req, res, responseData);
            return isJson ? JSON.stringify(transformedData) : transformedData;
            
        } catch (error) {
            logger.error('Error transforming response:', error);
            return body;
        }
    }
    
    transformJsonResponse(req, res, obj) {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }
        
        let transformedObj = { ...obj };
        
        // Add gateway metadata
        transformedObj._gateway = {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
            service: req.targetService?.name || 'unknown',
            instance: req.targetInstance ? `${req.targetInstance.host}:${req.targetInstance.port}` : 'unknown',
            version: '1.0.0'
        };
        
        // Apply path-specific transformations
        for (const [path, rules] of this.transformationRules) {
            if (req.path.startsWith(path)) {
                transformedObj = this.applyResponseTransformations(transformedObj, rules);
            }
        }
        
        // Apply status-specific transformations
        if (res.statusCode >= 400) {
            transformedObj = this.transformErrorResponse(transformedObj);
        }
        
        return transformedObj;
    }
    
    transformErrorResponse(obj) {
        return {
            ...obj,
            timestamp: obj.timestamp || new Date().toISOString(),
            support: {
                contact: 'support@example.com',
                documentation: '/docs'
            }
        };
    }
    
    transformResponseHeaders(req, res) {
        // Add standard headers
        res.setHeader('X-Gateway-Version', '1.0.0');
        res.setHeader('X-Request-Id', req.requestId);
        res.setHeader('X-Response-Time', `${Date.now() - req.startTime}ms`);
        
        // Add configured headers
        Object.entries(this.config.addHeaders).forEach(([name, value]) => {
            res.setHeader(name, value);
        });
        
        // Remove configured headers
        this.config.removeHeaders.forEach(header => {
            res.removeHeader(header);
        });
        
        // Add service information
        if (req.targetService) {
            res.setHeader('X-Service-Name', req.targetService.name);
        }
    }
    
    applyResponseTransformations(obj, rules) {
        let result = { ...obj };
        
        if (rules.body) {
            rules.body.forEach(rule => {
                result = this.applyBodyTransformation(result, rule);
            });
        }
        
        return result;
    }
    
    applyBodyTransformation(obj, rule) {
        switch (rule.action) {
            case 'add':
                return this.setNestedProperty({ ...obj }, rule.path, rule.value);
            case 'remove':
                const result = { ...obj };
                this.deleteNestedProperty(result, rule.path);
                return result;
            default:
                return obj;
        }
    }
    
    // Utility methods
    getNestedProperty(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }
    
    setNestedProperty(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        const target = keys.reduce((current, key) => {
            if (current[key] === undefined) {
                current[key] = {};
            }
            return current[key];
        }, obj);
        
        target[lastKey] = value;
        return obj;
    }
    
    deleteNestedProperty(obj, path) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        const target = keys.reduce((current, key) => {
            return current && current[key];
        }, obj);
        
        if (target && target[lastKey] !== undefined) {
            delete target[lastKey];
        }
    }
}

module.exports = ResponseTransformer;
