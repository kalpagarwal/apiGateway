const logger = require('../utils/logger');
const Joi = require('joi');

class RequestTransformer {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            transformations: config.transformations || {},
            headerMappings: config.headerMappings || {},
            bodyTransformations: config.bodyTransformations || {},
            queryTransformations: config.queryTransformations || {}
        };
        
        // Predefined transformation rules
        this.transformationRules = new Map();
        this.initializeTransformations();
    }
    
    initializeTransformations() {
        // Add default transformations from config
        Object.entries(this.config.transformations).forEach(([path, rules]) => {
            this.transformationRules.set(path, rules);
        });
    }
    
    /**
     * Middleware function
     */
    middleware() {
        return (req, res, next) => {
            if (!this.config.enabled) {
                return next();
            }
            
            try {
                // Apply transformations
                this.transformHeaders(req);
                this.transformQuery(req);
                this.transformBody(req);
                this.applyPathSpecificTransformations(req);
                
                logger.debug('Request transformation completed', {
                    requestId: req.requestId,
                    path: req.path
                });
                
                next();
                
            } catch (error) {
                logger.error('Request transformation error:', error);
                res.status(400).json({
                    error: 'Request Transformation Error',
                    message: error.message,
                    requestId: req.requestId
                });
            }
        };
    }
    
    /**
     * Transform request headers
     */
    transformHeaders(req) {
        // Add standard headers
        req.headers['x-gateway-timestamp'] = new Date().toISOString();
        req.headers['x-request-id'] = req.requestId;
        
        // Apply header mappings
        Object.entries(this.config.headerMappings).forEach(([from, to]) => {
            if (req.headers[from]) {
                req.headers[to] = req.headers[from];
                if (from !== to) {
                    delete req.headers[from];
                }
            }
        });
        
        // Remove sensitive headers
        const sensitiveHeaders = [
            'authorization',
            'x-api-key',
            'cookie',
            'x-forwarded-for'
        ];
        
        // Don't actually remove these, but log them for security
        sensitiveHeaders.forEach(header => {
            if (req.headers[header]) {
                logger.debug(`Sensitive header detected: ${header}`, {
                    requestId: req.requestId
                });
            }
        });
        
        // Add user context if authenticated
        if (req.user) {
            req.headers['x-user-id'] = req.user.id;
            req.headers['x-user-role'] = req.user.role;
            req.headers['x-auth-method'] = req.authMethod;
        }
    }
    
    /**
     * Transform query parameters
     */
    transformQuery(req) {
        // Apply query transformations
        Object.entries(this.config.queryTransformations).forEach(([from, to]) => {
            if (req.query[from] !== undefined) {
                req.query[to] = req.query[from];
                if (from !== to) {
                    delete req.query[from];
                }
            }
        });
        
        // Add pagination defaults
        if (req.query.page && !req.query.limit) {
            req.query.limit = '10'; // Default page size
        }
        
        // Sanitize query parameters
        this.sanitizeQuery(req);
    }
    
    /**
     * Transform request body
     */
    transformBody(req) {
        if (!req.body || typeof req.body !== 'object') {
            return;
        }
        
        // Apply body transformations
        Object.entries(this.config.bodyTransformations).forEach(([path, transformations]) => {
            if (req.path.startsWith(path)) {
                this.applyBodyTransformations(req.body, transformations);
            }
        });
        
        // Add metadata
        if (req.body && typeof req.body === 'object') {
            req.body._gateway = {
                timestamp: new Date().toISOString(),
                requestId: req.requestId,
                version: '1.0.0'
            };
        }
    }
    
    /**
     * Apply body transformations
     */
    applyBodyTransformations(body, transformations) {
        transformations.forEach(transformation => {
            switch (transformation.type) {
                case 'rename':
                    if (body[transformation.from] !== undefined) {
                        body[transformation.to] = body[transformation.from];
                        delete body[transformation.from];
                    }
                    break;
                    
                case 'add':
                    body[transformation.field] = transformation.value;
                    break;
                    
                case 'remove':
                    delete body[transformation.field];
                    break;
                    
                case 'transform':
                    if (body[transformation.field] !== undefined) {
                        body[transformation.field] = this.applyTransformation(
                            body[transformation.field], 
                            transformation.function
                        );
                    }
                    break;
            }
        });
    }
    
    /**
     * Apply specific transformation function
     */
    applyTransformation(value, transformFunction) {
        switch (transformFunction) {
            case 'lowercase':
                return typeof value === 'string' ? value.toLowerCase() : value;
                
            case 'uppercase':
                return typeof value === 'string' ? value.toUpperCase() : value;
                
            case 'trim':
                return typeof value === 'string' ? value.trim() : value;
                
            case 'toNumber':
                return Number(value);
                
            case 'toString':
                return String(value);
                
            case 'toArray':
                return Array.isArray(value) ? value : [value];
                
            default:
                return value;
        }
    }
    
    /**
     * Apply path-specific transformations
     */
    applyPathSpecificTransformations(req) {
        for (const [path, rules] of this.transformationRules) {
            if (req.path.startsWith(path)) {
                this.applyTransformationRules(req, rules);
            }
        }
    }
    
    /**
     * Apply transformation rules
     */
    applyTransformationRules(req, rules) {
        // Header transformations
        if (rules.headers) {
            rules.headers.forEach(rule => {
                switch (rule.action) {
                    case 'add':
                        req.headers[rule.name] = rule.value;
                        break;
                    case 'remove':
                        delete req.headers[rule.name];
                        break;
                    case 'rename':
                        if (req.headers[rule.from]) {
                            req.headers[rule.to] = req.headers[rule.from];
                            delete req.headers[rule.from];
                        }
                        break;
                }
            });
        }
        
        // Query transformations
        if (rules.query) {
            rules.query.forEach(rule => {
                switch (rule.action) {
                    case 'add':
                        req.query[rule.name] = rule.value;
                        break;
                    case 'remove':
                        delete req.query[rule.name];
                        break;
                    case 'rename':
                        if (req.query[rule.from] !== undefined) {
                            req.query[rule.to] = req.query[rule.from];
                            delete req.query[rule.from];
                        }
                        break;
                }
            });
        }
        
        // Body transformations
        if (rules.body && req.body) {
            rules.body.forEach(rule => {
                this.applyBodyRule(req.body, rule);
            });
        }
    }
    
    /**
     * Apply body transformation rule
     */
    applyBodyRule(body, rule) {
        switch (rule.action) {
            case 'add':
                this.setNestedProperty(body, rule.path, rule.value);
                break;
                
            case 'remove':
                this.deleteNestedProperty(body, rule.path);
                break;
                
            case 'rename':
                const value = this.getNestedProperty(body, rule.from);
                if (value !== undefined) {
                    this.setNestedProperty(body, rule.to, value);
                    this.deleteNestedProperty(body, rule.from);
                }
                break;
                
            case 'transform':
                const currentValue = this.getNestedProperty(body, rule.path);
                if (currentValue !== undefined) {
                    const transformedValue = this.applyTransformation(currentValue, rule.function);
                    this.setNestedProperty(body, rule.path, transformedValue);
                }
                break;
        }
    }
    
    /**
     * Get nested property value
     */
    getNestedProperty(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }
    
    /**
     * Set nested property value
     */
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
    }
    
    /**
     * Delete nested property
     */
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
    
    /**
     * Sanitize query parameters
     */
    sanitizeQuery(req) {
        Object.keys(req.query).forEach(key => {
            if (typeof req.query[key] === 'string') {
                // Remove potentially dangerous characters
                req.query[key] = req.query[key]
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/javascript:/gi, '')
                    .replace(/on\w+\s*=/gi, '');
            }
        });
    }
    
    /**
     * Validate request schema
     */
    validateRequest(req, schema) {
        const { error, value } = schema.validate(req.body);
        
        if (error) {
            throw new Error(`Request validation failed: ${error.details[0].message}`);
        }
        
        req.body = value;
        return true;
    }
    
    /**
     * Add transformation rule
     */
    addTransformationRule(path, rules) {
        this.transformationRules.set(path, rules);
        logger.info(`Transformation rule added for path: ${path}`);
    }
    
    /**
     * Remove transformation rule
     */
    removeTransformationRule(path) {
        const removed = this.transformationRules.delete(path);
        if (removed) {
            logger.info(`Transformation rule removed for path: ${path}`);
        }
        return removed;
    }
    
    /**
     * Get all transformation rules
     */
    getTransformationRules() {
        return Object.fromEntries(this.transformationRules);
    }
}

module.exports = RequestTransformer;
