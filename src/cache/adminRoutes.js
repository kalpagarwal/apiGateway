const express = require('express');
const { cacheService } = require('./index');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get cache statistics
 * GET /admin/cache/stats
 */
router.get('/stats', (req, res) => {
    try {
        const stats = cacheService.getStats();
        res.json(stats);
    } catch (error) {
        logger.error('Error getting cache stats:', error);
        res.status(500).json({ error: 'Failed to get cache statistics' });
    }
});

/**
 * Get cache key information
 * GET /admin/cache/keys/:key
 */
router.get('/keys/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const keyInfo = await cacheService.manager?.getKeyInfo(key);
        
        if (keyInfo) {
            res.json(keyInfo);
        } else {
            res.status(404).json({ error: 'Key not found or cache service unavailable' });
        }
    } catch (error) {
        logger.error('Error getting key info:', error);
        res.status(500).json({ error: 'Failed to get key information' });
    }
});

/**
 * Invalidate cache by pattern
 * DELETE /admin/cache/invalidate
 */
router.delete('/invalidate', async (req, res) => {
    try {
        const { pattern } = req.body;
        
        if (!pattern) {
            return res.status(400).json({ error: 'Pattern is required' });
        }
        
        await cacheService.invalidate(pattern);
        
        res.json({ 
            message: 'Cache invalidated successfully',
            pattern
        });
        
    } catch (error) {
        logger.error('Error invalidating cache:', error);
        res.status(500).json({ error: 'Failed to invalidate cache' });
    }
});

/**
 * Flush entire cache
 * DELETE /admin/cache
 */
router.delete('/', async (req, res) => {
    try {
        await cacheService.flush();
        
        res.json({ 
            message: 'Cache flushed successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('Error flushing cache:', error);
        res.status(500).json({ error: 'Failed to flush cache' });
    }
});

/**
 * Warm up cache
 * POST /admin/cache/warmup
 */
router.post('/warmup', async (req, res) => {
    try {
        const { data } = req.body;
        
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Valid data object is required' });
        }
        
        await cacheService.warmUp(data);
        
        res.json({ 
            message: 'Cache warmed up successfully',
            entries: Object.keys(data).length
        });
        
    } catch (error) {
        logger.error('Error warming up cache:', error);
        res.status(500).json({ error: 'Failed to warm up cache' });
    }
});

/**
 * Enable/disable cache
 * PATCH /admin/cache/toggle
 */
router.patch('/toggle', async (req, res) => {
    try {
        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled field must be a boolean' });
        }
        
        // This would require modifying the cache service to support runtime toggling
        // For now, we'll just return the current state
        const stats = cacheService.getStats();
        
        res.json({ 
            message: 'Cache toggle requested',
            currentState: stats.enabled,
            requestedState: enabled,
            note: 'Dynamic cache toggling requires restart in current implementation'
        });
        
    } catch (error) {
        logger.error('Error toggling cache:', error);
        res.status(500).json({ error: 'Failed to toggle cache' });
    }
});

/**
 * Get cache configuration
 * GET /admin/cache/config
 */
router.get('/config', (req, res) => {
    try {
        const stats = cacheService.getStats();
        
        res.json({
            enabled: stats.enabled,
            config: stats.config,
            connection: {
                connected: stats.connected
            }
        });
        
    } catch (error) {
        logger.error('Error getting cache config:', error);
        res.status(500).json({ error: 'Failed to get cache configuration' });
    }
});

/**
 * Health check for cache service
 * GET /admin/cache/health
 */
router.get('/health', async (req, res) => {
    try {
        const stats = cacheService.getStats();
        
        const health = {
            status: stats.enabled && stats.connected ? 'healthy' : 'degraded',
            enabled: stats.enabled,
            connected: stats.connected,
            timestamp: new Date().toISOString(),
            details: {
                memoryCache: stats.memoryCache,
                redisConnection: stats.connected
            }
        };
        
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
        
    } catch (error) {
        logger.error('Error checking cache health:', error);
        res.status(500).json({ 
            status: 'unhealthy',
            error: 'Failed to check cache health'
        });
    }
});

module.exports = router;
