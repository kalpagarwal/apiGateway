const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const logger = require('../utils/logger');

class RateLimiter {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            global: config.global || {
                windowMs: 15 * 60 * 1000,
                maxRequests: 1000,
                message: 'Too many requests from this IP'
            },
            perUser: config.perUser || {
                windowMs: 15 * 60 * 1000,
                maxRequests: 500
            },
            perApiKey: config.perApiKey || {
                windowMs: 15 * 60 * 1000,
                maxRequests: 2000
            },
            slowDown: config.slowDown || {
                windowMs: 15 * 60 * 1000,
                delayAfter: 100,
                delayMs: 500,
                maxDelayMs: 20000
            }
        };
        
        this.quotas = new Map();
        this.rateLimiters = new Map();
        this.initializeRateLimiters();
    }
    
    initializeRateLimiters() {
        this.globalLimiter = rateLimit({
            windowMs: this.config.global.windowMs,
            max: this.config.global.maxRequests,
            keyGenerator: (req) => this.getClientIP(req),
            handler: (req, res) => {
                logger.warn('Global rate limit exceeded', {
                    ip: this.getClientIP(req),
                    requestId: req.requestId
                });
                
                res.status(429).json({
                    error: 'Too Many Requests',
                    message: this.config.global.message,
                    requestId: req.requestId
                });
            }
        });
        
        this.slowDownLimiter = slowDown({
            windowMs: this.config.slowDown.windowMs,
            delayAfter: this.config.slowDown.delayAfter,
            delayMs: this.config.slowDown.delayMs,
            maxDelayMs: this.config.slowDown.maxDelayMs,
            keyGenerator: (req) => this.getClientIP(req)
        });
    }
    
    middleware() {
        return async (req, res, next) => {
            if (!this.config.enabled) {
                return next();
            }
            
            try {
                // Apply global rate limiting
                await new Promise((resolve, reject) => {
                    this.globalLimiter(req, res, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                
                // Apply slow down
                await new Promise((resolve, reject) => {
                    this.slowDownLimiter(req, res, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                
                // Check user quota
                const quotaResult = await this.checkQuota(req);
                
                if (!quotaResult.allowed) {
                    return res.status(429).json({
                        error: 'Quota Exceeded',
                        message: quotaResult.message,
                        quota: quotaResult.quota,
                        requestId: req.requestId
                    });
                }
                
                if (quotaResult.quota) {
                    res.setHeader('X-RateLimit-Limit', quotaResult.quota.limit);
                    res.setHeader('X-RateLimit-Remaining', quotaResult.quota.remaining);
                    res.setHeader('X-RateLimit-Reset', quotaResult.quota.reset);
                }
                
                next();
                
            } catch (error) {
                logger.error('Rate limiting error:', error);
                next();
            }
        };
    }
    
    async checkQuota(req) {
        if (!req.user) {
            return { allowed: true };
        }
        
        const quotaKey = req.user.authMethod === 'apikey' ? 
            `apikey:${req.user.apiKey.key}` : `user:${req.user.id}`;
        
        const quotaConfig = req.user.authMethod === 'apikey' && req.user.apiKey?.rateLimit ?
            {
                windowMs: this.parseTimeWindow(req.user.apiKey.rateLimit.window) || this.config.perApiKey.windowMs,
                maxRequests: req.user.apiKey.rateLimit.requests || this.config.perApiKey.maxRequests
            } : this.config.perUser;
        
        const now = Date.now();
        const windowStart = Math.floor(now / quotaConfig.windowMs) * quotaConfig.windowMs;
        
        let quota = this.quotas.get(quotaKey);
        
        if (!quota || quota.windowStart !== windowStart) {
            quota = {
                requests: 0,
                windowStart,
                resetTime: windowStart + quotaConfig.windowMs,
                limit: quotaConfig.maxRequests
            };
            this.quotas.set(quotaKey, quota);
        }
        
        quota.requests++;
        const allowed = quota.requests <= quota.limit;
        
        return {
            allowed,
            quota: {
                limit: quota.limit,
                remaining: Math.max(0, quota.limit - quota.requests),
                reset: quota.resetTime,
                window: quotaConfig.windowMs
            },
            message: allowed ? 'Request allowed' : 'Quota exceeded'
        };
    }
    
    parseTimeWindow(window) {
        if (typeof window === 'number') return window;
        if (typeof window !== 'string') return null;
        
        const matches = window.match(/(\\d+)([smhd]?)/);
        if (!matches) return null;
        
        const value = parseInt(matches[1]);
        const unit = matches[2] || 's';
        
        switch (unit) {
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return value * 1000;
        }
    }
    
    getClientIP(req) {
        return req.headers['x-forwarded-for'] ||
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress ||
               req.socket.remoteAddress ||
               req.ip;
    }
    
    getStats() {
        const quotaStats = {};
        const now = Date.now();
        
        for (const [key, quota] of this.quotas) {
            if (now < quota.resetTime) {
                quotaStats[key] = {
                    requests: quota.requests,
                    limit: quota.limit,
                    remaining: Math.max(0, quota.limit - quota.requests),
                    resetTime: quota.resetTime
                };
            }
        }
        
        return {
            enabled: this.config.enabled,
            activeQuotas: Object.keys(quotaStats).length,
            quotas: quotaStats
        };
    }
}

module.exports = RateLimiter;
