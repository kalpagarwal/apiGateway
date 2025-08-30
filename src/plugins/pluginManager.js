const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class PluginManager {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            pluginDir: config.pluginDir || path.join(__dirname, '../../plugins'),
            autoLoad: config.autoLoad !== false,
            allowedPlugins: config.allowedPlugins || [], // Empty array means all plugins allowed
            disabledPlugins: config.disabledPlugins || []
        };
        
        this.plugins = new Map();
        this.loadedPlugins = new Map();
        this.pluginHooks = new Map();
        this.initialized = false;
    }
    
    /**
     * Initialize plugin manager and load plugins
     */
    async initialize() {
        if (!this.config.enabled) {
            logger.info('Plugin system disabled');
            return;
        }
        
        try {
            // Ensure plugin directory exists
            if (!fs.existsSync(this.config.pluginDir)) {
                fs.mkdirSync(this.config.pluginDir, { recursive: true });
                logger.info(`Created plugin directory: ${this.config.pluginDir}`);
            }
            
            // Initialize hook system
            this.initializeHooks();
            
            // Auto-load plugins if enabled
            if (this.config.autoLoad) {
                await this.loadAllPlugins();
            }
            
            this.initialized = true;
            logger.info('Plugin manager initialized');
            
        } catch (error) {
            logger.error('Failed to initialize plugin manager:', error);
            throw error;
        }
    }
    
    /**
     * Initialize plugin hook system
     */
    initializeHooks() {
        const hooks = [
            'beforeRequest',
            'afterRequest',
            'beforeAuth',
            'afterAuth',
            'beforeRouting',
            'afterRouting',
            'beforeCache',
            'afterCache',
            'beforeResponse',
            'afterResponse',
            'onError',
            'onStartup',
            'onShutdown'
        ];
        
        hooks.forEach(hook => {
            this.pluginHooks.set(hook, []);
        });
        
        logger.debug('Plugin hooks initialized:', hooks);
    }
    
    /**
     * Load all plugins from plugin directory
     */
    async loadAllPlugins() {
        try {
            const pluginFiles = fs.readdirSync(this.config.pluginDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('.'));
            
            logger.info(`Found ${pluginFiles.length} plugin files`);
            
            for (const file of pluginFiles) {
                const pluginName = path.basename(file, '.js');
                
                if (this.config.disabledPlugins.includes(pluginName)) {
                    logger.info(`Skipping disabled plugin: ${pluginName}`);
                    continue;
                }
                
                if (this.config.allowedPlugins.length > 0 && 
                    !this.config.allowedPlugins.includes(pluginName)) {
                    logger.info(`Skipping non-allowed plugin: ${pluginName}`);
                    continue;
                }
                
                await this.loadPlugin(pluginName, path.join(this.config.pluginDir, file));
            }
            
        } catch (error) {
            logger.error('Error loading plugins:', error);
        }
    }
    
    /**
     * Load a specific plugin
     */
    async loadPlugin(name, filePath) {
        try {
            // Clear require cache to allow hot reloading
            delete require.cache[require.resolve(filePath)];
            
            const PluginClass = require(filePath);
            
            // Validate plugin structure
            if (!this.validatePlugin(PluginClass)) {
                logger.error(`Invalid plugin structure: ${name}`);
                return false;
            }
            
            // Create plugin instance
            const plugin = new PluginClass();
            
            // Initialize plugin
            if (plugin.initialize) {
                await plugin.initialize();
            }
            
            // Register plugin hooks
            this.registerPluginHooks(name, plugin);
            
            // Store plugin
            this.plugins.set(name, PluginClass);
            this.loadedPlugins.set(name, plugin);
            
            logger.info(`Plugin loaded: ${name}`);
            
            // Call plugin's onLoad hook if it exists
            if (plugin.onLoad) {
                await plugin.onLoad();
            }
            
            return true;
            
        } catch (error) {
            logger.error(`Failed to load plugin ${name}:`, error);
            return false;
        }
    }
    
    /**
     * Validate plugin structure
     */
    validatePlugin(PluginClass) {
        if (typeof PluginClass !== 'function') {
            return false;
        }
        
        // Check if it's a valid class
        try {
            const instance = new PluginClass();
            
            // Must have name and version
            if (!instance.name || !instance.version) {
                return false;
            }
            
            return true;
            
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Register plugin hooks
     */
    registerPluginHooks(name, plugin) {
        this.pluginHooks.forEach((hooks, hookName) => {
            if (typeof plugin[hookName] === 'function') {
                hooks.push({
                    name,
                    plugin,
                    handler: plugin[hookName].bind(plugin)
                });
                
                logger.debug(`Registered hook ${hookName} for plugin ${name}`);
            }
        });
    }
    
    /**
     * Execute plugin hooks
     */
    async executeHook(hookName, context = {}) {
        if (!this.initialized || !this.pluginHooks.has(hookName)) {
            return context;
        }
        
        const hooks = this.pluginHooks.get(hookName);
        let modifiedContext = { ...context };
        
        for (const hook of hooks) {
            try {
                const result = await hook.handler(modifiedContext);
                
                // If hook returns a modified context, use it
                if (result && typeof result === 'object') {
                    modifiedContext = { ...modifiedContext, ...result };
                }
                
            } catch (error) {
                logger.error(`Error executing ${hookName} hook for plugin ${hook.name}:`, error);
                
                // Continue with other plugins
                continue;
            }
        }
        
        return modifiedContext;
    }
    
    /**
     * Unload a plugin
     */
    async unloadPlugin(name) {
        try {
            const plugin = this.loadedPlugins.get(name);
            
            if (plugin) {
                // Call plugin's cleanup hook if it exists
                if (plugin.cleanup) {
                    await plugin.cleanup();
                }
                
                // Remove from hooks
                this.pluginHooks.forEach((hooks, hookName) => {
                    const index = hooks.findIndex(h => h.name === name);
                    if (index !== -1) {
                        hooks.splice(index, 1);
                    }
                });
                
                // Remove from loaded plugins
                this.loadedPlugins.delete(name);
                this.plugins.delete(name);
                
                logger.info(`Plugin unloaded: ${name}`);
                return true;
            }
            
            return false;
            
        } catch (error) {
            logger.error(`Failed to unload plugin ${name}:`, error);
            return false;
        }
    }
    
    /**
     * Reload a plugin
     */
    async reloadPlugin(name) {
        const pluginPath = path.join(this.config.pluginDir, `${name}.js`);
        
        if (!fs.existsSync(pluginPath)) {
            throw new Error(`Plugin file not found: ${name}`);
        }
        
        await this.unloadPlugin(name);
        return await this.loadPlugin(name, pluginPath);
    }
    
    /**
     * Get plugin information
     */
    getPluginInfo(name) {
        const plugin = this.loadedPlugins.get(name);
        
        if (!plugin) {
            return null;
        }
        
        return {
            name: plugin.name,
            version: plugin.version,
            description: plugin.description || 'No description',
            author: plugin.author || 'Unknown',
            hooks: this.getPluginHooks(name),
            loaded: true
        };
    }
    
    /**
     * Get hooks registered by a plugin
     */
    getPluginHooks(name) {
        const hooks = [];
        
        this.pluginHooks.forEach((hookList, hookName) => {
            if (hookList.some(h => h.name === name)) {
                hooks.push(hookName);
            }
        });
        
        return hooks;
    }
    
    /**
     * List all loaded plugins
     */
    getLoadedPlugins() {
        const plugins = [];
        
        this.loadedPlugins.forEach((plugin, name) => {
            plugins.push(this.getPluginInfo(name));
        });
        
        return plugins;
    }
    
    /**
     * Get plugin statistics
     */
    getStats() {
        const hookStats = {};
        
        this.pluginHooks.forEach((hooks, hookName) => {
            hookStats[hookName] = hooks.length;
        });
        
        return {
            enabled: this.config.enabled,
            initialized: this.initialized,
            totalPlugins: this.loadedPlugins.size,
            pluginDirectory: this.config.pluginDir,
            hooks: hookStats,
            loadedPlugins: Array.from(this.loadedPlugins.keys())
        };
    }
    
    /**
     * Create plugin middleware
     */
    createMiddleware(hookName) {
        return async (req, res, next) => {
            try {
                const context = {
                    req,
                    res,
                    next,
                    gateway: req.apiGateway
                };
                
                await this.executeHook(hookName, context);
                next();
                
            } catch (error) {
                logger.error(`Plugin middleware error for ${hookName}:`, error);
                next(error);
            }
        };
    }
    
    /**
     * Cleanup plugin manager
     */
    async cleanup() {
        logger.info('Cleaning up plugin manager...');
        
        // Unload all plugins
        const pluginNames = Array.from(this.loadedPlugins.keys());
        
        for (const name of pluginNames) {
            await this.unloadPlugin(name);
        }
        
        this.initialized = false;
        logger.info('Plugin manager cleaned up');
    }
}

module.exports = PluginManager;
