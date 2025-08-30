module.exports = {
    development: {
        enabled: true,
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD || null,
            db: process.env.REDIS_DB || 0
        },
        defaultTTL: 300, // 5 minutes
        keyPrefix: 'gateway:dev:',
        strategies: {
            // User data - medium TTL with invalidation on writes
            '/api/users': { 
                ttl: 600, // 10 minutes
                invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
            },
            
            // Product catalog - longer TTL since it changes less frequently
            '/api/products': { 
                ttl: 1800, // 30 minutes
                invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
            },
            
            // Configuration or static data - very long TTL
            '/api/config': { 
                ttl: 3600, // 1 hour
                invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
            },
            
            // Search results - short TTL due to dynamic nature
            '/api/search': { 
                ttl: 180, // 3 minutes
                invalidateOn: [] 
            },
            
            // Analytics - short TTL for real-time data
            '/api/analytics': { 
                ttl: 60, // 1 minute
                invalidateOn: [] 
            }
        },
        cacheableStatusCodes: [200, 201, 203, 300, 301, 302, 304],
        cacheableMethods: ['GET', 'HEAD'],
        
        // Cache warming configuration
        warmUp: {
            enabled: false,
            data: {
                // Pre-cache critical endpoints on startup
                // 'key': 'value'
            }
        }
    },
    
    test: {
        enabled: false, // Disable caching in tests by default
        redis: {
            host: 'localhost',
            port: 6379,
            password: null,
            db: 1 // Use different DB for tests
        },
        defaultTTL: 60,
        keyPrefix: 'gateway:test:',
        strategies: {},
        cacheableStatusCodes: [200],
        cacheableMethods: ['GET']
    },
    
    production: {
        enabled: true,
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            db: process.env.REDIS_DB || 0
        },
        defaultTTL: 600, // 10 minutes
        keyPrefix: 'gateway:prod:',
        strategies: {
            '/api/users': { 
                ttl: 1200, // 20 minutes
                invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
            },
            '/api/products': { 
                ttl: 3600, // 1 hour
                invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
            },
            '/api/config': { 
                ttl: 7200, // 2 hours
                invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
            },
            '/api/search': { 
                ttl: 300, // 5 minutes
                invalidateOn: [] 
            },
            '/api/analytics': { 
                ttl: 120, // 2 minutes
                invalidateOn: [] 
            }
        },
        cacheableStatusCodes: [200, 201, 203, 300, 301, 302, 304],
        cacheableMethods: ['GET', 'HEAD'],
        
        warmUp: {
            enabled: true,
            data: {
                // Add critical data to pre-cache
            }
        }
    }
};
