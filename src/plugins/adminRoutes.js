const express = require('express');
const { pluginService } = require('./index');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const router = express.Router();

/**
 * Get all loaded plugins
 * GET /admin/plugins
 */
router.get('/', (req, res) => {
    try {
        const plugins = pluginService.getLoadedPlugins();
        const stats = pluginService.getStats();
        
        res.json({
            plugins,
            stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Error getting plugins:', error);
        res.status(500).json({ error: 'Failed to get plugins' });
    }
});

/**
 * Get plugin statistics
 * GET /admin/plugins/stats
 */
router.get('/stats', (req, res) => {
    try {
        const stats = pluginService.getStats();
        res.json(stats);
    } catch (error) {
        logger.error('Error getting plugin stats:', error);
        res.status(500).json({ error: 'Failed to get plugin statistics' });
    }
});

/**
 * Get specific plugin information
 * GET /admin/plugins/:name
 */
router.get('/:name', (req, res) => {
    try {
        const { name } = req.params;
        const plugin = pluginService.getPluginInfo(name);
        
        if (!plugin) {
            return res.status(404).json({ error: 'Plugin not found' });
        }
        
        // Get additional plugin-specific data
        const pluginInstance = pluginService.getPlugin(name);
        let additionalData = {};
        
        if (pluginInstance) {
            // Try to get stats from plugin if available
            if (typeof pluginInstance.getStats === 'function') {
                additionalData.stats = pluginInstance.getStats();
            }
            
            // Try to get analytics if it's the analytics plugin
            if (name === 'analyticsTracker' && typeof pluginInstance.getAnalytics === 'function') {
                additionalData.analytics = pluginInstance.getAnalytics();
            }
            
            // Get plugin configuration
            if (typeof pluginInstance.getConfig === 'function') {
                additionalData.config = pluginInstance.getConfig();
            }
        }
        
        res.json({
            ...plugin,
            ...additionalData
        });
        
    } catch (error) {
        logger.error('Error getting plugin info:', error);
        res.status(500).json({ error: 'Failed to get plugin information' });
    }
});

/**
 * Load a plugin
 * POST /admin/plugins/:name/load
 */
router.post('/:name/load', async (req, res) => {
    try {
        const { name } = req.params;
        const { filePath } = req.body;
        
        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required' });
        }
        
        const success = await pluginService.loadPlugin(name, filePath);
        
        if (success) {
            res.json({
                message: 'Plugin loaded successfully',
                plugin: name,
                filePath
            });
        } else {
            res.status(500).json({ error: 'Failed to load plugin' });
        }
        
    } catch (error) {
        logger.error('Error loading plugin:', error);
        res.status(500).json({ error: 'Failed to load plugin' });
    }
});

/**
 * Unload a plugin
 * POST /admin/plugins/:name/unload
 */
router.post('/:name/unload', async (req, res) => {
    try {
        const { name } = req.params;
        
        const success = await pluginService.unloadPlugin(name);
        
        if (success) {
            res.json({
                message: 'Plugin unloaded successfully',
                plugin: name
            });
        } else {
            res.status(404).json({ error: 'Plugin not found or already unloaded' });
        }
        
    } catch (error) {
        logger.error('Error unloading plugin:', error);
        res.status(500).json({ error: 'Failed to unload plugin' });
    }
});

/**
 * Reload a plugin
 * POST /admin/plugins/:name/reload
 */
router.post('/:name/reload', async (req, res) => {
    try {
        const { name } = req.params;
        
        const success = await pluginService.reloadPlugin(name);
        
        if (success) {
            res.json({
                message: 'Plugin reloaded successfully',
                plugin: name
            });
        } else {
            res.status(500).json({ error: 'Failed to reload plugin' });
        }
        
    } catch (error) {
        logger.error('Error reloading plugin:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get available plugin files
 * GET /admin/plugins/available
 */
router.get('/available/files', (req, res) => {
    try {
        const stats = pluginService.getStats();
        const pluginDir = stats.pluginDirectory;
        
        if (!fs.existsSync(pluginDir)) {
            return res.json({ files: [] });
        }
        
        const files = fs.readdirSync(pluginDir)
            .filter(file => file.endsWith('.js') && !file.startsWith('.'))
            .map(file => {
                const filePath = path.join(pluginDir, file);
                const stat = fs.statSync(filePath);
                const pluginName = path.basename(file, '.js');
                const isLoaded = stats.loadedPlugins.includes(pluginName);
                
                return {
                    name: pluginName,
                    fileName: file,
                    filePath: filePath,
                    size: stat.size,
                    modified: stat.mtime,
                    loaded: isLoaded
                };
            });
        
        res.json({ files });
        
    } catch (error) {
        logger.error('Error getting available plugins:', error);
        res.status(500).json({ error: 'Failed to get available plugins' });
    }
});

/**
 * Get plugin analytics (for analytics tracker plugin)
 * GET /admin/plugins/analyticsTracker/analytics
 */
router.get('/analyticsTracker/analytics', (req, res) => {
    try {
        const plugin = pluginService.getPlugin('analyticsTracker');
        
        if (!plugin) {
            return res.status(404).json({ error: 'Analytics tracker plugin not found' });
        }
        
        if (typeof plugin.getAnalytics !== 'function') {
            return res.status(400).json({ error: 'Plugin does not support analytics' });
        }
        
        const analytics = plugin.getAnalytics();
        res.json(analytics);
        
    } catch (error) {
        logger.error('Error getting analytics:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

/**
 * Reset analytics data
 * POST /admin/plugins/analyticsTracker/reset
 */
router.post('/analyticsTracker/reset', (req, res) => {
    try {
        const plugin = pluginService.getPlugin('analyticsTracker');
        
        if (!plugin) {
            return res.status(404).json({ error: 'Analytics tracker plugin not found' });
        }
        
        if (typeof plugin.resetAnalytics !== 'function') {
            return res.status(400).json({ error: 'Plugin does not support analytics reset' });
        }
        
        plugin.resetAnalytics();
        
        res.json({
            message: 'Analytics data reset successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('Error resetting analytics:', error);
        res.status(500).json({ error: 'Failed to reset analytics' });
    }
});

/**
 * Plugin health check
 * GET /admin/plugins/health
 */
router.get('/health', (req, res) => {
    try {
        const stats = pluginService.getStats();
        const plugins = pluginService.getLoadedPlugins();
        
        const health = {
            status: stats.enabled && stats.initialized ? 'healthy' : 'degraded',
            enabled: stats.enabled,
            initialized: stats.initialized,
            totalPlugins: stats.totalPlugins,
            timestamp: new Date().toISOString(),
            plugins: plugins.map(plugin => ({
                name: plugin.name,
                version: plugin.version,
                loaded: plugin.loaded
            }))
        };
        
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
        
    } catch (error) {
        logger.error('Error checking plugin health:', error);
        res.status(500).json({
            status: 'unhealthy',
            error: 'Failed to check plugin health'
        });
    }
});

module.exports = router;
