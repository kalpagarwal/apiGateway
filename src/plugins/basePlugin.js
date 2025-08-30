const logger = require('../utils/logger');

/**
 * Base Plugin Class
 * 
 * All plugins should extend this class to ensure consistent structure
 * and access to common functionality.
 */
class BasePlugin {
    constructor() {
        // Plugin metadata - must be overridden by child classes
        this.name = 'BasePlugin';
        this.version = '1.0.0';
        this.description = 'Base plugin class';
        this.author = 'API Gateway';
        
        // Plugin state
        this.initialized = false;
        this.config = {};
    }
    
    /**
     * Initialize plugin - override in child classes
     */
    async initialize(config = {}) {
        this.config = { ...this.config, ...config };
        this.initialized = true;
        
        logger.debug(`Plugin ${this.name} initialized`);
    }
    
    /**
     * Called when plugin is loaded - override in child classes
     */
    async onLoad() {
        logger.debug(`Plugin ${this.name} loaded`);
    }
    
    /**
     * Cleanup plugin resources - override in child classes
     */
    async cleanup() {
        this.initialized = false;
        logger.debug(`Plugin ${this.name} cleaned up`);
    }
    
    /**
     * Hook: Before request processing
     * @param {Object} context - { req, res, next, gateway }
     */
    async beforeRequest(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: After request processing
     * @param {Object} context - { req, res, next, gateway }
     */
    async afterRequest(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: Before authentication
     * @param {Object} context - { req, res, next, gateway }
     */
    async beforeAuth(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: After authentication
     * @param {Object} context - { req, res, next, gateway }
     */
    async afterAuth(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: Before routing
     * @param {Object} context - { req, res, next, gateway }
     */
    async beforeRouting(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: After routing
     * @param {Object} context - { req, res, next, gateway }
     */
    async afterRouting(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: Before cache lookup
     * @param {Object} context - { req, res, next, gateway }
     */
    async beforeCache(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: After cache lookup
     * @param {Object} context - { req, res, next, gateway }
     */
    async afterCache(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: Before response sent
     * @param {Object} context - { req, res, next, gateway }
     */
    async beforeResponse(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: After response sent
     * @param {Object} context - { req, res, next, gateway }
     */
    async afterResponse(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: On error
     * @param {Object} context - { req, res, next, gateway, error }
     */
    async onError(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: On gateway startup
     * @param {Object} context - { gateway }
     */
    async onStartup(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Hook: On gateway shutdown
     * @param {Object} context - { gateway }
     */
    async onShutdown(context) {
        // Override in child classes
        return context;
    }
    
    /**
     * Utility: Log plugin message
     */
    log(level, message, meta = {}) {
        logger[level](`[${this.name}] ${message}`, {
            plugin: this.name,
            version: this.version,
            ...meta
        });
    }
    
    /**
     * Utility: Get plugin configuration
     */
    getConfig(key = null) {
        if (key) {
            return this.config[key];
        }
        return this.config;
    }
    
    /**
     * Utility: Set plugin configuration
     */
    setConfig(key, value) {
        if (typeof key === 'object') {
            this.config = { ...this.config, ...key };
        } else {
            this.config[key] = value;
        }
    }
    
    /**
     * Utility: Check if plugin is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    
    /**
     * Utility: Get plugin metadata
     */
    getMetadata() {
        return {
            name: this.name,
            version: this.version,
            description: this.description,
            author: this.author,
            initialized: this.initialized
        };
    }
}

module.exports = BasePlugin;
