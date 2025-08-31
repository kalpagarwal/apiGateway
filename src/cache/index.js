const CacheManager = require('./cacheManager');
const CacheUtils = require('./cacheUtils');
const adminRoutes = require('./adminRoutes');
const logger = require('../utils/logger');

class CacheService {
    constructor() {
        this.manager = null;
        this.initialized = false;
    }
    
    /**
     * Initialize cache service
     */
    async initialize(config = {}) {
        try {
            this.manager = new CacheManager(config);
            await this.manager.initialize();
            this.initialized = true;
            
            logger.info('Cache service initialized');
            
        } catch (error) {
            logger.error('Failed to initialize cache service:', error);
            throw error;
        }
    }
    
    /**
     * Get cache middleware
     */
    middleware() {
        if (!this.initialized || !this.manager) {
            logger.warn('Cache service not initialized, caching disabled');
            return (req, res, next) => next();
        }
        
        return this.manager.middleware();
    }
    
    /**
     * Get cache statistics
     */
    getStats() {
        if (!this.initialized || !this.manager) {
            return { error: 'Cache service not initialized' };
        }
        
        return this.manager.getStats();
    }
    
    /**
     * Manually invalidate cache
     */
    async invalidate(pattern) {
        if (!this.initialized || !this.manager) {
            throw new Error('Cache service not initialized');
        }
        
        await this.manager.invalidate(pattern);
    }
    
    /**
     * Flush entire cache
     */
    async flush() {
        if (!this.initialized || !this.manager) {
            throw new Error('Cache service not initialized');
        }
        
        await this.manager.flush();
    }
    
    /**
     * Warm up cache
     */
    async warmUp(data) {
        if (!this.initialized || !this.manager) {
            throw new Error('Cache service not initialized');
        }
        
        await this.manager.warmUp(data);
    }
    
    /**
     * Handle cache invalidation for write operations
     */
    invalidationMiddleware() {
        return async (req, res, next) => {
            if (!this.initialized || !this.manager) {
                return next();
            }
            
            // Handle invalidation after response is sent
            res.on('finish', async () => {
                try {
                    await this.manager.handleInvalidation(req);
                } catch (error) {
                    logger.error('Error handling cache invalidation:', error);
                }
            });
            
            next();
        };
    }
    
    /**
     * Cleanup cache resources
     */
    async cleanup() {
        if (this.manager) {
            await this.manager.cleanup();
            this.initialized = false;
            logger.info('Cache service cleaned up');
        }
    }
}

// Export singleton instance
const cacheService = new CacheService();

module.exports = {
  cacheService,
  CacheService,
  CacheManager,
  CacheUtils,
  adminRoutes,
};
