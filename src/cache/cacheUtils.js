const crypto = require('crypto');
const logger = require('../utils/logger');

class CacheUtils {
    /**
     * Generate cache key with consistent formatting
     */
    static generateKey(prefix, method, path, query = {}, headers = {}) {
        const baseKey = `${method}:${path}`;
        
        // Sort query parameters for consistent keys
        const sortedQuery = Object.keys(query)
            .sort()
            .reduce((acc, key) => {
                acc[key] = query[key];
                return acc;
            }, {});
        
        const queryString = Object.keys(sortedQuery).length > 0 ? 
            '?' + new URLSearchParams(sortedQuery).toString() : '';
        
        // Include relevant headers in cache key if specified
        const relevantHeaders = ['accept', 'accept-language', 'accept-encoding'];
        const headerString = relevantHeaders
            .filter(header => headers[header])
            .map(header => `${header}:${headers[header]}`)
            .join('|');
        
        const fullKey = baseKey + queryString + (headerString ? `|${headerString}` : '');
        
        return prefix + crypto.createHash('md5').update(fullKey).digest('hex');
    }
    
    /**
     * Check if response is cacheable based on headers
     */
    static isResponseCacheable(response, headers = {}) {
        // Check cache-control header
        const cacheControl = headers['cache-control'] || '';
        
        if (cacheControl.includes('no-cache') || 
            cacheControl.includes('no-store') || 
            cacheControl.includes('private')) {
            return false;
        }
        
        // Check for vary header that might make caching complex
        const vary = headers['vary'] || '';
        const problematicVaryHeaders = ['cookie', 'authorization', 'user-agent'];
        
        if (problematicVaryHeaders.some(header => 
            vary.toLowerCase().includes(header.toLowerCase()))) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Extract TTL from cache-control header
     */
    static extractTTLFromHeaders(headers = {}) {
        const cacheControl = headers['cache-control'] || '';
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        
        if (maxAgeMatch) {
            return parseInt(maxAgeMatch[1], 10);
        }
        
        // Check expires header
        const expires = headers['expires'];
        if (expires) {
            const expiresDate = new Date(expires);
            const now = new Date();
            const ttlSeconds = Math.max(0, Math.floor((expiresDate - now) / 1000));
            return ttlSeconds;
        }
        
        return null;
    }
    
    /**
     * Generate cache tags for better invalidation
     */
    static generateCacheTags(path, method, body = null) {
        const tags = [];
        
        // Add path-based tags
        const pathParts = path.split('/').filter(part => part);
        for (let i = 0; i < pathParts.length; i++) {
            tags.push('path:' + '/' + pathParts.slice(0, i + 1).join('/'));
        }
        
        // Add method tag
        tags.push('method:' + method);
        
        // Add resource-based tags if we can infer them
        if (pathParts.includes('users')) tags.push('resource:users');
        if (pathParts.includes('products')) tags.push('resource:products');
        if (pathParts.includes('orders')) tags.push('resource:orders');
        
        // Add entity ID tags if present
        const entityIdPattern = /\/(\d+)$/;
        const entityMatch = path.match(entityIdPattern);
        if (entityMatch) {
            tags.push('entity:' + entityMatch[1]);
        }
        
        return tags;
    }
    
    /**
     * Create cache warming data for common endpoints
     */
    static createWarmUpData(services = []) {
        const warmUpData = {};
        
        services.forEach(service => {
            // Create basic health check cache
            const healthKey = `warmup:${service.name}:health`;
            warmUpData[healthKey] = {
                status: 'healthy',
                service: service.name,
                timestamp: new Date().toISOString()
            };
            
            // Create basic service info cache
            const infoKey = `warmup:${service.name}:info`;
            warmUpData[infoKey] = {
                name: service.name,
                version: service.version || '1.0.0',
                endpoints: service.endpoints || []
            };
        });
        
        return warmUpData;
    }
    
    /**
     * Calculate optimal TTL based on request patterns
     */
    static calculateOptimalTTL(requestHistory = []) {
        if (requestHistory.length === 0) {
            return 300; // Default 5 minutes
        }
        
        // Calculate average time between requests
        const intervals = [];
        for (let i = 1; i < requestHistory.length; i++) {
            intervals.push(requestHistory[i].timestamp - requestHistory[i - 1].timestamp);
        }
        
        if (intervals.length === 0) {
            return 300;
        }
        
        const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
        
        // TTL should be a fraction of the average interval
        // If requests come every 2 minutes, cache for 1 minute
        const optimalTTL = Math.max(60, Math.min(3600, Math.floor(avgInterval / 2000))); // Convert to seconds
        
        return optimalTTL;
    }
    
    /**
     * Validate cache configuration
     */
    static validateConfig(config) {
        const errors = [];
        
        if (config.defaultTTL && (config.defaultTTL < 0 || config.defaultTTL > 86400)) {
            errors.push('defaultTTL must be between 0 and 86400 seconds');
        }
        
        if (config.keyPrefix && typeof config.keyPrefix !== 'string') {
            errors.push('keyPrefix must be a string');
        }
        
        if (config.strategies) {
            Object.entries(config.strategies).forEach(([path, strategy]) => {
                if (strategy.ttl && (strategy.ttl < 0 || strategy.ttl > 86400)) {
                    errors.push(`TTL for path ${path} must be between 0 and 86400 seconds`);
                }
                
                if (strategy.invalidateOn && !Array.isArray(strategy.invalidateOn)) {
                    errors.push(`invalidateOn for path ${path} must be an array`);
                }
            });
        }
        
        if (config.redis) {
            if (config.redis.port && (config.redis.port < 1 || config.redis.port > 65535)) {
                errors.push('Redis port must be between 1 and 65535');
            }
            
            if (config.redis.db && (config.redis.db < 0 || config.redis.db > 15)) {
                errors.push('Redis database number must be between 0 and 15');
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * Create cache-control header
     */
    static createCacheControlHeader(ttl, options = {}) {
        const directives = [];
        
        if (options.public) {
            directives.push('public');
        } else if (options.private) {
            directives.push('private');
        }
        
        if (ttl > 0) {
            directives.push(`max-age=${ttl}`);
        } else {
            directives.push('no-cache');
        }
        
        if (options.mustRevalidate) {
            directives.push('must-revalidate');
        }
        
        if (options.noStore) {
            directives.push('no-store');
        }
        
        return directives.join(', ');
    }
    
    /**
     * Parse cache control header
     */
    static parseCacheControl(cacheControlHeader) {
        if (!cacheControlHeader) {
            return {};
        }
        
        const directives = {};
        const parts = cacheControlHeader.split(',').map(part => part.trim());
        
        parts.forEach(part => {
            const [key, value] = part.split('=');
            directives[key.toLowerCase()] = value ? parseInt(value, 10) || value : true;
        });
        
        return directives;
    }
    
    /**
     * Get cache efficiency metrics
     */
    static calculateCacheEfficiency(stats) {
        const total = stats.hits + stats.misses;
        const hitRate = total > 0 ? (stats.hits / total) * 100 : 0;
        const missRate = total > 0 ? (stats.misses / total) * 100 : 0;
        
        let efficiency = 'poor';
        if (hitRate >= 90) efficiency = 'excellent';
        else if (hitRate >= 75) efficiency = 'good';
        else if (hitRate >= 50) efficiency = 'fair';
        
        return {
            hitRate: parseFloat(hitRate.toFixed(2)),
            missRate: parseFloat(missRate.toFixed(2)),
            totalRequests: total,
            efficiency,
            recommendations: CacheUtils.getCacheRecommendations(hitRate, stats)
        };
    }
    
    /**
     * Get cache optimization recommendations
     */
    static getCacheRecommendations(hitRate, stats) {
        const recommendations = [];
        
        if (hitRate < 50) {
            recommendations.push('Consider increasing TTL for frequently accessed resources');
            recommendations.push('Review caching strategies for better coverage');
        }
        
        if (stats.errors > stats.hits * 0.1) {
            recommendations.push('High error rate detected - check Redis connection and configuration');
        }
        
        if (stats.sets < stats.hits * 0.1) {
            recommendations.push('Low cache write rate - ensure responses are being cached properly');
        }
        
        return recommendations;
    }
}

module.exports = CacheUtils;
