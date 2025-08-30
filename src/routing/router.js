const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');
const logger = require('../utils/logger');

class Router {
    constructor(config = {}) {
        this.config = {
            services: config.services || {},
            loadBalancing: config.loadBalancing || 'roundRobin',
            healthCheckInterval: config.healthCheckInterval || 30000,
            retryAttempts: config.retryAttempts || 3,
            timeout: config.timeout || 30000
        };
        
        // Service registry
        this.services = new Map();
        this.routes = new Map();
        this.proxies = new Map();
        
        // Load balancing state
        this.roundRobinIndex = new Map();
        this.connectionCounts = new Map();
        
        // Health check state
        this.healthCheckInterval = null;
        this.serviceHealth = new Map();
        
        this.initializeServices();
    }
    
    initializeServices() {
        // Register services from config
        Object.entries(this.config.services).forEach(([name, serviceConfig]) => {
            this.registerService(name, serviceConfig);
        });
    }
    
    /**
     * Register a new service
     */
    registerService(name, serviceConfig) {
        const service = {
            name,
            instances: serviceConfig.instances || [],
            pathPrefix: serviceConfig.pathPrefix || `/${name}`,
            stripPrefix: serviceConfig.stripPrefix !== false,
            loadBalancing: serviceConfig.loadBalancing || this.config.loadBalancing,
            healthCheck: {
                enabled: serviceConfig.healthCheck?.enabled !== false,
                path: serviceConfig.healthCheck?.path || '/health',
                interval: serviceConfig.healthCheck?.interval || 30000,
                timeout: serviceConfig.healthCheck?.timeout || 5000
            },
            retries: serviceConfig.retries || 3,
            timeout: serviceConfig.timeout || 30000,
            circuitBreaker: serviceConfig.circuitBreaker || {},
            rateLimit: serviceConfig.rateLimit || {},
            cache: serviceConfig.cache || {},
            transformation: serviceConfig.transformation || {},
            authentication: serviceConfig.authentication || {},
            metadata: serviceConfig.metadata || {}
        };
        
        this.services.set(name, service);
        this.roundRobinIndex.set(name, 0);
        
        // Initialize health status for all instances
        service.instances.forEach(instance => {
            const instanceKey = `${instance.host}:${instance.port}`;
            this.serviceHealth.set(instanceKey, {
                isHealthy: true,
                lastCheck: null,
                consecutiveFailures: 0
            });
        });
        
        logger.info(`Service registered: ${name} with ${service.instances.length} instances`);
        
        // Create route mapping
        this.createRoute(service);
        
        return service;
    }
    
    /**
     * Create route for service
     */
    createRoute(service) {
        const routePath = service.pathPrefix.endsWith('*') ? 
            service.pathPrefix : service.pathPrefix + '/*';
        
        this.routes.set(routePath, service);
        
        // Create proxy middleware for each instance
        service.instances.forEach(instance => {
            const instanceKey = `${instance.host}:${instance.port}`;
            
            if (!this.proxies.has(instanceKey)) {
                const proxy = createProxyMiddleware({
                    target: `http://${instance.host}:${instance.port}`,
                    changeOrigin: true,
                    timeout: service.timeout,
                    
                    pathRewrite: service.stripPrefix ? {
                        [`^${service.pathPrefix}`]: ''
                    } : {},
                    
                    onError: (err, req, res) => {
                        logger.error(`Proxy error for ${instanceKey}:`, err.message);
                        this.recordInstanceFailure(instanceKey);
                        
                        if (!res.headersSent) {
                            res.status(502).json({
                                error: 'Bad Gateway',
                                message: 'Service temporarily unavailable',
                                service: service.name,
                                instance: instanceKey
                            });
                        }
                    },
                    
                    onProxyRes: (proxyRes, req, res) => {
                        // Add custom headers
                        proxyRes.headers['X-Gateway-Service'] = service.name;
                        proxyRes.headers['X-Gateway-Instance'] = instanceKey;
                        proxyRes.headers['X-Gateway-Version'] = '1.0.0';
                        
                        logger.debug(`Request proxied to ${service.name}@${instanceKey}`, {
                            requestId: req.requestId,
                            statusCode: proxyRes.statusCode
                        });
                    }
                });
                
                this.proxies.set(instanceKey, proxy);
            }
        });
    }
    
    /**
     * Router middleware
     */
    middleware() {
        return async (req, res, next) => {
            try {
                const service = this.findMatchingService(req.path);
                
                if (!service) {
                    return res.status(404).json({
                        error: 'Service Not Found',
                        message: `No service found for path: ${req.path}`,
                        requestId: req.requestId
                    });
                }
                
                // Select healthy instance
                const instance = this.selectInstance(service, req);
                
                if (!instance) {
                    return res.status(503).json({
                        error: 'Service Unavailable',
                        message: `No healthy instances available for service: ${service.name}`,
                        requestId: req.requestId
                    });
                }
                
                // Store service info in request
                req.targetService = service;
                req.targetInstance = instance;
                
                // Get proxy for this instance
                const instanceKey = `${instance.host}:${instance.port}`;
                const proxy = this.proxies.get(instanceKey);
                
                if (!proxy) {
                    throw new Error(`No proxy found for instance: ${instanceKey}`);
                }
                
                // Increment connection count
                this.incrementConnection(instanceKey);
                
                // Execute proxy
                proxy(req, res, (err) => {
                    this.decrementConnection(instanceKey);
                    
                    if (err) {
                        logger.error(`Proxy middleware error:`, err);
                        if (!res.headersSent) {
                            res.status(502).json({
                                error: 'Proxy Error',
                                message: 'Failed to proxy request to service'
                            });
                        }
                    }
                });
                
            } catch (error) {
                logger.error('Router error:', error);
                next(error);
            }
        };
    }
    
    /**
     * Find matching service for request path
     */
    findMatchingService(path) {
        for (const [routePath, service] of this.routes) {
            const pattern = routePath.replace('/*', '');
            if (path.startsWith(pattern)) {
                return service;
            }
        }
        return null;
    }
    
    /**
     * Select service instance using load balancing algorithm
     */
    selectInstance(service, req) {
        const healthyInstances = service.instances.filter(instance => {
            const instanceKey = `${instance.host}:${instance.port}`;
            const health = this.serviceHealth.get(instanceKey);
            return health && health.isHealthy;
        });
        
        if (healthyInstances.length === 0) {
            return null;
        }
        
        switch (service.loadBalancing) {
            case 'roundRobin':
                return this.roundRobinSelection(service.name, healthyInstances);
                
            case 'leastConnections':
                return this.leastConnectionsSelection(healthyInstances);
                
            case 'random':
                return this.randomSelection(healthyInstances);
                
            case 'ipHash':
                return this.ipHashSelection(healthyInstances, req);
                
            case 'weightedRoundRobin':
                return this.weightedRoundRobinSelection(service.name, healthyInstances);
                
            default:
                return this.roundRobinSelection(service.name, healthyInstances);
        }
    }
    
    /**
     * Round robin selection
     */
    roundRobinSelection(serviceName, instances) {
        const index = this.roundRobinIndex.get(serviceName) || 0;
        const selectedInstance = instances[index % instances.length];
        this.roundRobinIndex.set(serviceName, index + 1);
        return selectedInstance;
    }
    
    /**
     * Least connections selection
     */
    leastConnectionsSelection(instances) {
        let minConnections = Infinity;
        let selectedInstance = null;
        
        instances.forEach(instance => {
            const instanceKey = `${instance.host}:${instance.port}`;
            const connections = this.connectionCounts.get(instanceKey) || 0;
            
            if (connections < minConnections) {
                minConnections = connections;
                selectedInstance = instance;
            }
        });
        
        return selectedInstance;
    }
    
    /**
     * Random selection
     */
    randomSelection(instances) {
        const index = Math.floor(Math.random() * instances.length);
        return instances[index];
    }
    
    /**
     * IP hash selection
     */
    ipHashSelection(instances, req) {
        const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
        const hash = require('crypto').createHash('md5').update(clientIP).digest('hex');
        const index = parseInt(hash.substring(0, 8), 16) % instances.length;
        return instances[index];
    }
    
    /**
     * Weighted round robin selection
     */
    weightedRoundRobinSelection(serviceName, instances) {
        const weightedInstances = [];
        instances.forEach(instance => {
            const weight = instance.weight || 1;
            for (let i = 0; i < weight; i++) {
                weightedInstances.push(instance);
            }
        });
        
        if (weightedInstances.length === 0) return instances[0];
        
        const index = this.roundRobinIndex.get(serviceName) || 0;
        const selectedInstance = weightedInstances[index % weightedInstances.length];
        this.roundRobinIndex.set(serviceName, index + 1);
        return selectedInstance;
    }
    
    /**
     * Increment connection count
     */
    incrementConnection(instanceKey) {
        const current = this.connectionCounts.get(instanceKey) || 0;
        this.connectionCounts.set(instanceKey, current + 1);
    }
    
    /**
     * Decrement connection count
     */
    decrementConnection(instanceKey) {
        const current = this.connectionCounts.get(instanceKey) || 0;
        this.connectionCounts.set(instanceKey, Math.max(0, current - 1));
    }
    
    /**
     * Record instance failure
     */
    recordInstanceFailure(instanceKey) {
        const health = this.serviceHealth.get(instanceKey);
        if (health) {
            health.consecutiveFailures++;
            
            // Mark as unhealthy after 3 consecutive failures
            if (health.consecutiveFailures >= 3) {
                health.isHealthy = false;
                logger.warn(`Instance marked unhealthy: ${instanceKey}`);
            }
        }
    }
    
    /**
     * Start health checking
     */
    async initialize() {
        logger.info('Initializing router and starting health checks...');
        
        this.healthCheckInterval = setInterval(() => {
            this.performHealthChecks();
        }, this.config.healthCheckInterval);
        
        // Perform initial health check
        await this.performHealthChecks();
    }
    
    /**
     * Perform health checks on all service instances
     */
    async performHealthChecks() {
        const promises = [];
        
        for (const service of this.services.values()) {
            if (!service.healthCheck.enabled) continue;
            
            service.instances.forEach(instance => {
                promises.push(this.checkInstanceHealth(service, instance));
            });
        }
        
        await Promise.allSettled(promises);
    }
    
    /**
     * Check health of a specific instance
     */
    async checkInstanceHealth(service, instance) {
        const instanceKey = `${instance.host}:${instance.port}`;
        const healthUrl = `http://${instance.host}:${instance.port}${service.healthCheck.path}`;
        
        try {
            const response = await axios.get(healthUrl, {
                timeout: service.healthCheck.timeout,
                validateStatus: (status) => status < 500
            });
            
            // Instance is healthy
            const health = this.serviceHealth.get(instanceKey);
            if (health) {
                health.isHealthy = true;
                health.lastCheck = new Date();
                health.consecutiveFailures = 0;
            }
            
            logger.debug(`Health check passed for ${instanceKey}`, {
                service: service.name,
                responseTime: response.headers['x-response-time'] || 'N/A'
            });
            
        } catch (error) {
            // Instance is unhealthy
            const health = this.serviceHealth.get(instanceKey);
            if (health) {
                health.consecutiveFailures++;
                health.lastCheck = new Date();
                
                if (health.consecutiveFailures >= 3) {
                    health.isHealthy = false;
                    logger.warn(`Health check failed for ${instanceKey}:`, error.message);
                }
            }
        }
    }
    
    /**
     * Add new service instance
     */
    addServiceInstance(serviceName, instance) {
        const service = this.services.get(serviceName);
        
        if (!service) {
            throw new Error(`Service not found: ${serviceName}`);
        }
        
        const instanceKey = `${instance.host}:${instance.port}`;
        
        // Check if instance already exists
        const exists = service.instances.some(inst => 
            `${inst.host}:${inst.port}` === instanceKey
        );
        
        if (exists) {
            throw new Error(`Instance already exists: ${instanceKey}`);
        }
        
        service.instances.push(instance);
        
        // Initialize health status
        this.serviceHealth.set(instanceKey, {
            isHealthy: true,
            lastCheck: null,
            consecutiveFailures: 0
        });
        
        // Create proxy for new instance
        this.createProxyForInstance(service, instance);
        
        logger.info(`Service instance added: ${serviceName}@${instanceKey}`);
    }
    
    /**
     * Remove service instance
     */
    removeServiceInstance(serviceName, instanceKey) {
        const service = this.services.get(serviceName);
        
        if (!service) {
            throw new Error(`Service not found: ${serviceName}`);
        }
        
        service.instances = service.instances.filter(inst => 
            `${inst.host}:${inst.port}` !== instanceKey
        );
        
        this.serviceHealth.delete(instanceKey);
        this.connectionCounts.delete(instanceKey);
        this.proxies.delete(instanceKey);
        
        logger.info(`Service instance removed: ${serviceName}@${instanceKey}`);
    }
    
    /**
     * Create proxy for instance
     */
    createProxyForInstance(service, instance) {
        const instanceKey = `${instance.host}:${instance.port}`;
        
        const proxy = createProxyMiddleware({
            target: `http://${instance.host}:${instance.port}`,
            changeOrigin: true,
            timeout: service.timeout,
            
            pathRewrite: service.stripPrefix ? {
                [`^${service.pathPrefix}`]: ''
            } : {},
            
            onError: (err, req, res) => {
                logger.error(`Proxy error for ${instanceKey}:`, err.message);
                this.recordInstanceFailure(instanceKey);
            },
            
            onProxyRes: (proxyRes, req, res) => {
                proxyRes.headers['X-Gateway-Service'] = service.name;
                proxyRes.headers['X-Gateway-Instance'] = instanceKey;
            }
        });
        
        this.proxies.set(instanceKey, proxy);
    }
    
    /**
     * Get service health status
     */
    getServiceHealth() {
        const health = {};
        
        for (const [name, service] of this.services) {
            health[name] = {
                totalInstances: service.instances.length,
                healthyInstances: 0,
                instances: {}
            };
            
            service.instances.forEach(instance => {
                const instanceKey = `${instance.host}:${instance.port}`;
                const instanceHealth = this.serviceHealth.get(instanceKey);
                
                health[name].instances[instanceKey] = {
                    ...instance,
                    health: instanceHealth || { isHealthy: false },
                    connections: this.connectionCounts.get(instanceKey) || 0
                };
                
                if (instanceHealth && instanceHealth.isHealthy) {
                    health[name].healthyInstances++;
                }
            });
        }
        
        return health;
    }
    
    /**
     * Get registered services
     */
    getRegisteredServices() {
        const services = {};
        
        for (const [name, service] of this.services) {
            services[name] = {
                name: service.name,
                pathPrefix: service.pathPrefix,
                instances: service.instances.length,
                loadBalancing: service.loadBalancing,
                healthCheck: service.healthCheck,
                metadata: service.metadata
            };
        }
        
        return services;
    }
    
    /**
     * Get routes configuration
     */
    getRoutes() {
        const routes = {};
        
        for (const [routePath, service] of this.routes) {
            routes[routePath] = {
                service: service.name,
                pathPrefix: service.pathPrefix,
                stripPrefix: service.stripPrefix,
                instances: service.instances.length
            };
        }
        
        return routes;
    }
    
    /**
     * Update service configuration
     */
    updateServiceConfig(serviceName, newConfig) {
        const service = this.services.get(serviceName);
        
        if (!service) {
            throw new Error(`Service not found: ${serviceName}`);
        }
        
        // Update service configuration
        Object.assign(service, newConfig);
        
        // Recreate route if path changed
        if (newConfig.pathPrefix) {
            this.createRoute(service);
        }
        
        logger.info(`Service configuration updated: ${serviceName}`);
    }
    
    /**
     * Get service statistics
     */
    getServiceStats() {
        const stats = {};
        
        for (const [name, service] of this.services) {
            stats[name] = {
                instances: service.instances.length,
                healthyInstances: service.instances.filter(instance => {
                    const instanceKey = `${instance.host}:${instance.port}`;
                    const health = this.serviceHealth.get(instanceKey);
                    return health && health.isHealthy;
                }).length,
                totalConnections: service.instances.reduce((total, instance) => {
                    const instanceKey = `${instance.host}:${instance.port}`;
                    return total + (this.connectionCounts.get(instanceKey) || 0);
                }, 0),
                loadBalancing: service.loadBalancing
            };
        }
        
        return stats;
    }
    
    /**
     * Cleanup resources
     */
    async cleanup() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        this.proxies.clear();
        this.connectionCounts.clear();
        
        logger.info('Router cleanup completed');
    }
}

module.exports = Router;
