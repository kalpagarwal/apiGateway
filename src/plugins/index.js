const PluginManager = require('./pluginManager');
const BasePlugin = require('./basePlugin');
const logger = require('../utils/logger');

class PluginService {
    constructor() {
        this.manager = null;
        this.initialized = false;
    }
    
    /**
     * Initialize plugin service
     */
    async initialize(config = {}) {
        try {
            this.manager = new PluginManager(config);
            await this.manager.initialize();
            this.initialized = true;
            
            logger.info('Plugin service initialized');
            
        } catch (error) {
            logger.error('Failed to initialize plugin service:', error);
            throw error;
        }
    }
    
    /**
     * Execute plugin hooks
     */
    async executeHook(hookName, context = {}) {
        if (!this.initialized || !this.manager) {
            return context;
        }
        
        return await this.manager.executeHook(hookName, context);
    }
    
    /**
     * Create middleware for specific hook
     */
    createMiddleware(hookName) {
        if (!this.initialized || !this.manager) {
            return (req, res, next) => next();
        }
        
        return this.manager.createMiddleware(hookName);
    }
    
    /**
     * Load a plugin
     */
    async loadPlugin(name, filePath) {
        if (!this.initialized || !this.manager) {
            throw new Error('Plugin service not initialized');
        }
        
        return await this.manager.loadPlugin(name, filePath);
    }
    
    /**
     * Unload a plugin
     */
    async unloadPlugin(name) {
        if (!this.initialized || !this.manager) {
            throw new Error('Plugin service not initialized');
        }
        
        return await this.manager.unloadPlugin(name);
    }
    
    /**
     * Reload a plugin
     */
    async reloadPlugin(name) {
        if (!this.initialized || !this.manager) {
            throw new Error('Plugin service not initialized');
        }
        
        return await this.manager.reloadPlugin(name);
    }
    
    /**
     * Get plugin information
     */
    getPluginInfo(name) {
        if (!this.initialized || !this.manager) {
            return null;
        }
        
        return this.manager.getPluginInfo(name);
    }
    
    /**
     * Get all loaded plugins
     */
    getLoadedPlugins() {
        if (!this.initialized || !this.manager) {
            return [];
        }
        
        return this.manager.getLoadedPlugins();
    }
    
    /**
     * Get plugin statistics
     */
    getStats() {
        if (!this.initialized || !this.manager) {
            return { error: 'Plugin service not initialized' };
        }
        
        return this.manager.getStats();
    }
    
    /**
     * Get specific plugin instance (for direct access)
     */
    getPlugin(name) {
        if (!this.initialized || !this.manager) {
            return null;
        }
        
        return this.manager.loadedPlugins.get(name);
    }
    
    /**
     * Cleanup plugin service
     */
    async cleanup() {
        if (this.manager) {
            await this.manager.cleanup();
            this.initialized = false;
            logger.info('Plugin service cleaned up');
        }
    }
}

// Export singleton instance
const pluginService = new PluginService();

module.exports = {
    PluginService,
    pluginService,
    PluginManager,
    BasePlugin
};
