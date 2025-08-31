const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class ConfigManager {
    /**
     * Load configuration from environment variables and config files
     */
    static async loadConfig() {
        const defaultConfig = {
            // Server configuration
            port: parseInt(process.env.PORT) || 3000,
            host: process.env.HOST || 'localhost',
            
            // Authentication configuration
            auth: {
                enabled: process.env.AUTH_ENABLED !== 'false',
                jwt: {
                    secret: process.env.JWT_SECRET || 'change-this-secret-in-production',
                    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
                    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
                },
                apiKey: {
                    enabled: process.env.API_KEY_AUTH_ENABLED !== 'false',
                    header: process.env.API_KEY_HEADER || 'x-api-key'
                }
            },
            
            // Routing configuration
            routing: {
                defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT) || 30000,
                retryAttempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
                services: []  // Will be loaded from config file if exists
            },
            
            // Rate limiting configuration
            rateLimit: {
                enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
                windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
                maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
                storage: process.env.RATE_LIMIT_STORAGE || 'memory',
                redis: {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: parseInt(process.env.REDIS_PORT) || 6379,
                    password: process.env.REDIS_PASSWORD
                }
            },
            
            // Cache configuration
            cache: {
                enabled: process.env.CACHE_ENABLED !== 'false',
                ttl: parseInt(process.env.CACHE_TTL) || 300,
                maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 100,
                storage: process.env.CACHE_STORAGE || 'memory',
                redis: {
                    host: process.env.CACHE_REDIS_HOST || process.env.REDIS_HOST || 'localhost',
                    port: parseInt(process.env.CACHE_REDIS_PORT || process.env.REDIS_PORT) || 6379,
                    password: process.env.CACHE_REDIS_PASSWORD || process.env.REDIS_PASSWORD
                }
            },
            
            // Security configuration
            security: {
                enabled: process.env.SECURITY_ENABLED !== 'false',
                helmet: {
                    contentSecurityPolicy: process.env.CSP_ENABLED !== 'false',
                    hsts: {
                        maxAge: parseInt(process.env.HSTS_MAX_AGE) || 31536000,
                        includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false',
                        preload: process.env.HSTS_PRELOAD === 'true'
                    }
                },
                cors: {
                    origin: process.env.CORS_ORIGIN || '*',
                    credentials: process.env.CORS_CREDENTIALS === 'true',
                    optionsSuccessStatus: 200
                },
                csrf: {
                    enabled: process.env.CSRF_ENABLED === 'true'
                }
            },
            
            // Monitoring configuration
            monitoring: {
                enabled: process.env.MONITORING_ENABLED !== 'false',
                metrics: {
                    enabled: process.env.METRICS_ENABLED !== 'false',
                    interval: parseInt(process.env.METRICS_INTERVAL) || 60000
                },
                health: {
                    enabled: process.env.HEALTH_ENABLED !== 'false',
                    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000
                },
                logging: {
                    level: process.env.LOG_LEVEL || 'info',
                    format: process.env.LOG_FORMAT || 'json'
                }
            },
            
            // Circuit breaker configuration
            circuitBreaker: {
                enabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
                threshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD) || 5,
                timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT) || 60000,
                resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT) || 30000
            },
            
            // Request/Response transformation
            transformation: {
                request: {
                    enabled: process.env.REQUEST_TRANSFORM_ENABLED !== 'false',
                    rules: []  // Will be loaded from config file
                },
                response: {
                    enabled: process.env.RESPONSE_TRANSFORM_ENABLED !== 'false',
                    rules: []  // Will be loaded from config file
                }
            },
            
            // Server limits
            limits: {
                bodySize: process.env.MAX_BODY_SIZE || '10mb',
                fileSize: process.env.MAX_FILE_SIZE || '50mb',
                requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 120000
            },
            
            // Server configuration
            server: {
                timeout: parseInt(process.env.SERVER_TIMEOUT) || 30000,
                keepAliveTimeout: parseInt(process.env.SERVER_KEEPALIVE_TIMEOUT) || 5000,
                headersTimeout: parseInt(process.env.SERVER_HEADERS_TIMEOUT) || 60000
            },
            
            // Documentation
            documentation: {
                enabled: process.env.DOCS_ENABLED !== 'false',
                path: process.env.DOCS_PATH || '/docs'
            },
            
            // Plugin configuration
            plugins: {
                enabled: process.env.PLUGINS_ENABLED !== 'false',
                directory: process.env.PLUGINS_DIR || path.join(process.cwd(), 'plugins'),
                autoLoad: process.env.PLUGINS_AUTOLOAD !== 'false'
            }
        };
        
        // Try to load additional config from file
        const configFile = process.env.CONFIG_FILE || 'config.json';
        const configPath = path.join(process.cwd(), configFile);
        
        try {
            const fileContent = await fs.readFile(configPath, 'utf8');
            const fileConfig = JSON.parse(fileContent);
            
            // Deep merge file config with default config
            const mergedConfig = this.deepMerge(defaultConfig, fileConfig);
            
            logger.info(`Configuration loaded from ${configFile}`);
            return mergedConfig;
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info(`No config file found at ${configPath}, using defaults and environment variables`);
            } else if (error instanceof SyntaxError) {
                logger.error(`Invalid JSON in config file: ${error.message}`);
            } else {
                logger.warn(`Could not load config file: ${error.message}`);
            }
            
            return defaultConfig;
        }
    }
    
    /**
     * Deep merge two objects
     */
    static deepMerge(target, source) {
        const output = { ...target };
        
        if (this.isObject(target) && this.isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this.isObject(source[key])) {
                    if (!(key in target)) {
                        Object.assign(output, { [key]: source[key] });
                    } else {
                        output[key] = this.deepMerge(target[key], source[key]);
                    }
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }
        
        return output;
    }
    
    /**
     * Check if value is an object
     */
    static isObject(item) {
        return item && typeof item === 'object' && !Array.isArray(item);
    }
    
    /**
     * Validate configuration
     */
    static validateConfig(config) {
        const errors = [];
        
        // Validate required fields
        if (!config.port || config.port < 1 || config.port > 65535) {
            errors.push('Invalid port number');
        }
        
        if (config.auth.enabled && !config.auth.jwt.secret) {
            errors.push('JWT secret is required when authentication is enabled');
        }
        
        if (config.cache.storage === 'redis' && !config.cache.redis.host) {
            errors.push('Redis host is required when using Redis for cache storage');
        }
        
        if (config.rateLimit.storage === 'redis' && !config.rateLimit.redis.host) {
            errors.push('Redis host is required when using Redis for rate limit storage');
        }
        
        return errors;
    }
    
    /**
     * Save configuration to file
     */
    static async saveConfig(config, filePath) {
        try {
            const configPath = filePath || path.join(process.cwd(), 'config.json');
            await fs.writeFile(configPath, JSON.stringify(config, null, 2));
            logger.info(`Configuration saved to ${configPath}`);
        } catch (error) {
            logger.error(`Failed to save configuration: ${error.message}`);
            throw error;
        }
    }
}

module.exports = ConfigManager;
