const redis = require('redis');
const logger = require('../utils/logger');

class CacheManager {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            redis: config.redis || {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD || null,
                db: process.env.REDIS_DB || 0
            },
            defaultTTL: config.defaultTTL || 300, // 5 minutes
            keyPrefix: config.keyPrefix || 'gateway:',
            strategies: config.strategies || {
                '/api/users': { ttl: 600, invalidateOn: ['POST', 'PUT', 'DELETE'] },
                '/api/products': { ttl: 1800, invalidateOn: ['POST', 'PUT', 'DELETE'] }
            },
            cacheableStatusCodes: config.cacheableStatusCodes || [200, 201, 203, 300, 301, 302, 304],
            cacheableMethods: config.cacheableMethods || ['GET', 'HEAD']
        };
        
        this.client = null;
        this.isConnected = false;
        this.cacheStats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            errors: 0
        };
        
        // In-memory fallback cache
        this.memoryCache = new Map();
        this.memoryTTL = new Map();
    }
    
    /**
     * Initialize Redis connection
     */
    async initialize() {
        if (!this.config.enabled) {
            logger.info('Cache disabled');
            return;
        }
        
        try {
            this.client = redis.createClient({
                socket: {
                    host: this.config.redis.host,
                    port: this.config.redis.port
                },
                password: this.config.redis.password,
                database: this.config.redis.db
            });
            
            this.client.on('error', (err) => {
                logger.error('Redis connection error:', err);
                this.isConnected = false;
            });
            
            this.client.on('connect', () => {
                logger.info('Connected to Redis');
                this.isConnected = true;
            });
            
            this.client.on('disconnect', () => {
                logger.warn('Disconnected from Redis');
                this.isConnected = false;
            });
            
            await this.client.connect();
            
            // Start memory cache cleanup
            this.startMemoryCacheCleanup();
            
        } catch (error) {
            logger.error('Failed to initialize Redis cache:', error);
            logger.info('Falling back to in-memory cache');
            this.isConnected = false;
        }
    }
    
    /**
     * Cache middleware
     */
    middleware() {
        return async (req, res, next) => {
            if (!this.config.enabled || !this.isCacheable(req)) {
                return next();
            }
            
            const cacheKey = this.generateCacheKey(req);
            
            try {
                // Try to get from cache
                const cachedResponse = await this.get(cacheKey);
                
                if (cachedResponse) {
                    this.cacheStats.hits++;
                    
                    logger.debug('Cache hit', {
                        cacheKey,
                        requestId: req.requestId
                    });
                    
                    // Set cache headers
                    res.setHeader('X-Cache', 'HIT');
                    res.setHeader('X-Cache-Key', cacheKey);
                    
                    // Send cached response
                    if (cachedResponse.headers) {
                        Object.entries(cachedResponse.headers).forEach(([key, value]) => {
                            res.setHeader(key, value);
                        });
                    }
                    
                    return res.status(cachedResponse.status || 200).send(cachedResponse.body);
                }
                
                // Cache miss - continue to backend
                this.cacheStats.misses++;
                
                // Override response methods to cache the response
                const originalSend = res.send;
                const originalJson = res.json;
                
                res.send = (body) => {
                    this.cacheResponse(req, res, body, cacheKey);
                    return originalSend.call(res, body);
                };
                
                res.json = (obj) => {
                    this.cacheResponse(req, res, JSON.stringify(obj), cacheKey);
                    return originalJson.call(res, obj);
                };
                
                res.setHeader('X-Cache', 'MISS');
                res.setHeader('X-Cache-Key', cacheKey);
                
                next();
                
            } catch (error) {
                logger.error('Cache middleware error:', error);
                this.cacheStats.errors++;
                next();
            }
        };
    }
    
    /**
     * Check if request is cacheable
     */
    isCacheable(req) {
        // Only cache certain HTTP methods
        if (!this.config.cacheableMethods.includes(req.method)) {
            return false;
        }
        
        // Don't cache if user-specific or contains sensitive headers
        const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
        if (sensitiveHeaders.some(header => req.headers[header])) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Cache response if cacheable
     */
    async cacheResponse(req, res, body, cacheKey) {
        if (!this.config.cacheableStatusCodes.includes(res.statusCode)) {
            return;
        }
        
        const strategy = this.getCacheStrategy(req.path);
        const ttl = strategy?.ttl || this.config.defaultTTL;
        
        const cacheData = {
            status: res.statusCode,
            headers: this.getResponseHeaders(res),
            body,
            timestamp: Date.now(),
            path: req.path,
            method: req.method
        };
        
        try {
            await this.set(cacheKey, cacheData, ttl);
            this.cacheStats.sets++;
            
            logger.debug('Response cached', {
                cacheKey,
                ttl,
                statusCode: res.statusCode,
                requestId: req.requestId
            });
            
        } catch (error) {
            logger.error('Error caching response:', error);
            this.cacheStats.errors++;
        }
    }
    
    /**
     * Generate cache key for request
     */
    generateCacheKey(req) {
        const baseKey = `${req.method}:${req.path}`;
        const queryString = Object.keys(req.query).length > 0 ? 
            '?' + new URLSearchParams(req.query).toString() : '';
        
        return this.config.keyPrefix + Buffer.from(baseKey + queryString).toString('base64');
    }
    
    /**
     * Get cache strategy for path
     */
    getCacheStrategy(path) {
        for (const [pattern, strategy] of Object.entries(this.config.strategies)) {
            if (path.startsWith(pattern)) {
                return strategy;
            }
        }
        return null;
    }
    
    /**
     * Get response headers to cache
     */
    getResponseHeaders(res) {
        const headers = {};
        const headersToCache = [
            'content-type',
            'content-length',
            'etag',
            'last-modified',
            'cache-control'
        ];
        
        headersToCache.forEach(header => {
            const value = res.getHeader(header);
            if (value) {
                headers[header] = value;
            }
        });
        
        return headers;
    }
    
    /**
     * Get value from cache
     */
    async get(key) {
        try {
            if (this.isConnected && this.client) {
                const value = await this.client.get(key);
                return value ? JSON.parse(value) : null;
            } else {
                // Fallback to memory cache
                return this.getFromMemory(key);
            }
        } catch (error) {
            logger.error('Cache get error:', error);
            this.cacheStats.errors++;
            return null;
        }
    }
    
    /**
     * Set value in cache
     */
    async set(key, value, ttl = null) {
        const timeToLive = ttl || this.config.defaultTTL;
        
        try {
            if (this.isConnected && this.client) {
                await this.client.setEx(key, timeToLive, JSON.stringify(value));
            } else {
                // Fallback to memory cache
                this.setInMemory(key, value, timeToLive);
            }
        } catch (error) {
            logger.error('Cache set error:', error);
            this.cacheStats.errors++;
        }
    }
    
    /**
     * Delete key from cache
     */
    async delete(key) {
        try {
            if (this.isConnected && this.client) {
                await this.client.del(key);
            } else {
                this.memoryCache.delete(key);
                this.memoryTTL.delete(key);
            }
            
            this.cacheStats.deletes++;
            
        } catch (error) {
            logger.error('Cache delete error:', error);
            this.cacheStats.errors++;
        }
    }
    
    /**
     * Invalidate cache for specific patterns
     */
    async invalidate(pattern) {
        try {
            if (this.isConnected && this.client) {
                const keys = await this.client.keys(this.config.keyPrefix + '*');
                const matchingKeys = keys.filter(key => key.includes(pattern));
                
                if (matchingKeys.length > 0) {
                    await this.client.del(matchingKeys);
                    logger.info(`Invalidated ${matchingKeys.length} cache entries for pattern: ${pattern}`);
                }
            } else {
                // Invalidate memory cache
                for (const key of this.memoryCache.keys()) {
                    if (key.includes(pattern)) {
                        this.memoryCache.delete(key);
                        this.memoryTTL.delete(key);
                    }
                }
            }
        } catch (error) {
            logger.error('Cache invalidation error:', error);
        }
    }
    
    /**
     * Flush entire cache
     */
    async flush() {
        try {
            if (this.isConnected && this.client) {
                await this.client.flushDb();
            } else {
                this.memoryCache.clear();
                this.memoryTTL.clear();
            }
            
            logger.info('Cache flushed');
            
        } catch (error) {
            logger.error('Cache flush error:', error);
        }
    }
    
    /**
     * Memory cache fallback methods
     */
    getFromMemory(key) {
        const ttl = this.memoryTTL.get(key);
        if (ttl && Date.now() > ttl) {
            this.memoryCache.delete(key);
            this.memoryTTL.delete(key);
            return null;
        }
        
        return this.memoryCache.get(key) || null;
    }
    
    setInMemory(key, value, ttl) {
        this.memoryCache.set(key, value);
        this.memoryTTL.set(key, Date.now() + (ttl * 1000));
    }
    
    /**
     * Start memory cache cleanup
     */
    startMemoryCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;
            
            for (const [key, expiry] of this.memoryTTL) {
                if (now > expiry) {
                    this.memoryCache.delete(key);
                    this.memoryTTL.delete(key);
                    cleanedCount++;
                }
            }
            
            if (cleanedCount > 0) {
                logger.debug(`Cleaned up ${cleanedCount} expired memory cache entries`);
            }
        }, 60000); // Clean every minute
    }
    
    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0 ?
            (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100).toFixed(2) : 0;
        
        return {
            enabled: this.config.enabled,
            connected: this.isConnected,
            stats: {
                ...this.cacheStats,
                hitRate: `${hitRate}%`
            },
            memoryCache: {
                entries: this.memoryCache.size,
                ttlEntries: this.memoryTTL.size
            },
            config: {
                defaultTTL: this.config.defaultTTL,
                keyPrefix: this.config.keyPrefix,
                strategies: Object.keys(this.config.strategies)
            }
        };
    }
    
    /**
     * Handle cache invalidation based on request method and path
     */
    async handleInvalidation(req) {
        const strategy = this.getCacheStrategy(req.path);
        
        if (strategy && strategy.invalidateOn && strategy.invalidateOn.includes(req.method)) {
            await this.invalidate(req.path);
            logger.info(`Cache invalidated for path: ${req.path} due to ${req.method} request`);
        }
    }
    
    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.client && this.isConnected) {
            await this.client.quit();
            logger.info('Redis connection closed');
        }
        
        this.memoryCache.clear();
        this.memoryTTL.clear();
    }
    
    /**
     * Warm up cache with predefined data
     */
    async warmUp(data) {
        logger.info('Warming up cache...');
        
        for (const [key, value] of Object.entries(data)) {
            await this.set(key, value);
        }
        
        logger.info(`Cache warmed up with ${Object.keys(data).length} entries`);
    }
    
    /**
     * Get cache key information
     */
    async getKeyInfo(key) {
        try {
            if (this.isConnected && this.client) {
                const ttl = await this.client.ttl(key);
                const exists = await this.client.exists(key);
                
                return {
                    exists: exists === 1,
                    ttl: ttl,
                    key
                };
            } else {
                const exists = this.memoryCache.has(key);
                const expiry = this.memoryTTL.get(key);
                const ttl = expiry ? Math.max(0, Math.floor((expiry - Date.now()) / 1000)) : -1;
                
                return {
                    exists,
                    ttl,
                    key
                };
            }
        } catch (error) {
            logger.error('Error getting key info:', error);
            return null;
        }
    }
}

module.exports = CacheManager;
