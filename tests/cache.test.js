const { CacheManager, CacheUtils } = require('../src/cache');
const logger = require('../src/utils/logger');

// Mock logger to avoid console output during tests
jest.mock('../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

describe('CacheManager', () => {
    let cacheManager;
    
    beforeEach(() => {
        cacheManager = new CacheManager({
            enabled: true,
            redis: {
                host: 'localhost',
                port: 6379,
                db: 1 // Use test database
            },
            defaultTTL: 300,
            keyPrefix: 'test:',
            strategies: {
                '/api/users': { ttl: 600, invalidateOn: ['POST', 'PUT', 'DELETE'] }
            }
        });
    });
    
    afterEach(async () => {
        if (cacheManager) {
            await cacheManager.cleanup();
        }
    });
    
    describe('constructor', () => {
        it('should initialize with default config', () => {
            const manager = new CacheManager();
            expect(manager.config.enabled).toBe(true);
            expect(manager.config.defaultTTL).toBe(300);
            expect(manager.cacheStats.hits).toBe(0);
        });
        
        it('should use provided config', () => {
            expect(cacheManager.config.keyPrefix).toBe('test:');
            expect(cacheManager.config.defaultTTL).toBe(300);
        });
    });
    
    describe('generateCacheKey', () => {
        it('should generate consistent cache keys', () => {
            const req = {
                method: 'GET',
                path: '/api/users',
                query: { page: '1', limit: '10' }
            };
            
            const key1 = cacheManager.generateCacheKey(req);
            const key2 = cacheManager.generateCacheKey(req);
            
            expect(key1).toBe(key2);
            expect(key1).toContain(cacheManager.config.keyPrefix);
        });
        
        it('should generate different keys for different requests', () => {
            const req1 = { method: 'GET', path: '/api/users', query: {} };
            const req2 = { method: 'GET', path: '/api/products', query: {} };
            
            const key1 = cacheManager.generateCacheKey(req1);
            const key2 = cacheManager.generateCacheKey(req2);
            
            expect(key1).not.toBe(key2);
        });
    });
    
    describe('isCacheable', () => {
        it('should allow cacheable methods', () => {
            const req = { method: 'GET', headers: {} };
            expect(cacheManager.isCacheable(req)).toBe(true);
        });
        
        it('should reject non-cacheable methods', () => {
            const req = { method: 'POST', headers: {} };
            expect(cacheManager.isCacheable(req)).toBe(false);
        });
        
        it('should reject requests with sensitive headers', () => {
            const req = { 
                method: 'GET', 
                headers: { authorization: 'Bearer token' } 
            };
            expect(cacheManager.isCacheable(req)).toBe(false);
        });
    });
    
    describe('getCacheStrategy', () => {
        it('should return strategy for matching path', () => {
            const strategy = cacheManager.getCacheStrategy('/api/users');
            expect(strategy).toEqual({ 
                ttl: 600, 
                invalidateOn: ['POST', 'PUT', 'DELETE'] 
            });
        });
        
        it('should return null for non-matching path', () => {
            const strategy = cacheManager.getCacheStrategy('/api/unknown');
            expect(strategy).toBeNull();
        });
    });
    
    describe('memory cache fallback', () => {
        it('should store and retrieve from memory cache', () => {
            const key = 'test-key';
            const value = { data: 'test' };
            const ttl = 60;
            
            cacheManager.setInMemory(key, value, ttl);
            const retrieved = cacheManager.getFromMemory(key);
            
            expect(retrieved).toEqual(value);
        });
        
        it('should expire memory cache entries', (done) => {
            const key = 'test-key';
            const value = { data: 'test' };
            const ttl = 0.1; // 0.1 seconds
            
            cacheManager.setInMemory(key, value, ttl);
            
            setTimeout(() => {
                const retrieved = cacheManager.getFromMemory(key);
                expect(retrieved).toBeNull();
                done();
            }, 200);
        });
    });
    
    describe('getStats', () => {
        it('should return cache statistics', () => {
            const stats = cacheManager.getStats();
            
            expect(stats).toHaveProperty('enabled');
            expect(stats).toHaveProperty('connected');
            expect(stats).toHaveProperty('stats');
            expect(stats.stats).toHaveProperty('hits');
            expect(stats.stats).toHaveProperty('misses');
            expect(stats.stats).toHaveProperty('hitRate');
        });
    });
});

describe('CacheUtils', () => {
    describe('generateKey', () => {
        it('should generate MD5 hash-based keys', () => {
            const key = CacheUtils.generateKey('prefix:', 'GET', '/api/test');
            expect(key).toMatch(/^prefix:[a-f0-9]{32}$/);
        });
        
        it('should include query parameters in key generation', () => {
            const key1 = CacheUtils.generateKey('prefix:', 'GET', '/api/test', {});
            const key2 = CacheUtils.generateKey('prefix:', 'GET', '/api/test', { page: '1' });
            
            expect(key1).not.toBe(key2);
        });
    });
    
    describe('isResponseCacheable', () => {
        it('should allow cacheable responses', () => {
            const headers = { 'content-type': 'application/json' };
            expect(CacheUtils.isResponseCacheable({}, headers)).toBe(true);
        });
        
        it('should reject responses with no-cache', () => {
            const headers = { 'cache-control': 'no-cache' };
            expect(CacheUtils.isResponseCacheable({}, headers)).toBe(false);
        });
        
        it('should reject responses with no-store', () => {
            const headers = { 'cache-control': 'no-store' };
            expect(CacheUtils.isResponseCacheable({}, headers)).toBe(false);
        });
    });
    
    describe('extractTTLFromHeaders', () => {
        it('should extract TTL from max-age', () => {
            const headers = { 'cache-control': 'public, max-age=3600' };
            expect(CacheUtils.extractTTLFromHeaders(headers)).toBe(3600);
        });
        
        it('should return null for no cache headers', () => {
            const headers = {};
            expect(CacheUtils.extractTTLFromHeaders(headers)).toBeNull();
        });
    });
    
    describe('generateCacheTags', () => {
        it('should generate appropriate tags', () => {
            const tags = CacheUtils.generateCacheTags('/api/users/123', 'GET');
            
            expect(tags).toContain('path:/api');
            expect(tags).toContain('path:/api/users');
            expect(tags).toContain('path:/api/users/123');
            expect(tags).toContain('method:GET');
            expect(tags).toContain('resource:users');
            expect(tags).toContain('entity:123');
        });
    });
    
    describe('validateConfig', () => {
        it('should validate correct config', () => {
            const config = {
                defaultTTL: 300,
                keyPrefix: 'test:',
                redis: { port: 6379, db: 0 }
            };
            
            const result = CacheUtils.validateConfig(config);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });
        
        it('should detect invalid TTL', () => {
            const config = { defaultTTL: -1 };
            const result = CacheUtils.validateConfig(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('defaultTTL must be between 0 and 86400 seconds');
        });
    });
    
    describe('calculateCacheEfficiency', () => {
        it('should calculate efficiency metrics', () => {
            const stats = { hits: 80, misses: 20, errors: 1, sets: 25 };
            const efficiency = CacheUtils.calculateCacheEfficiency(stats);
            
            expect(efficiency.hitRate).toBe(80);
            expect(efficiency.missRate).toBe(20);
            expect(efficiency.efficiency).toBe('good');
            expect(efficiency.totalRequests).toBe(100);
        });
    });
});
