const express = require('express');
const { cacheService, CacheUtils } = require('../src/cache');
const logger = require('../src/utils/logger');

// Example cache configuration
const cacheConfig = {
    enabled: true,
    redis: {
        host: 'localhost',
        port: 6379,
        password: null,
        db: 0
    },
    defaultTTL: 300,
    keyPrefix: 'example:',
    strategies: {
        '/api/products': { 
            ttl: 1800, // 30 minutes for product catalog
            invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
        },
        '/api/users': { 
            ttl: 600, // 10 minutes for user data
            invalidateOn: ['POST', 'PUT', 'DELETE', 'PATCH'] 
        },
        '/api/search': { 
            ttl: 180, // 3 minutes for search results
            invalidateOn: [] 
        }
    }
};

async function demonstrateCache() {
    console.log('🚀 Cache Example Demo\n');
    
    try {
        // Initialize cache service
        console.log('1. Initializing cache service...');
        await cacheService.initialize(cacheConfig);
        console.log('   ✅ Cache service initialized\n');
        
        // Create example Express app
        const app = express();
        app.use(express.json());
        
        // Add cache middleware to specific routes
        app.use('/api/products', cacheService.middleware());
        app.use('/api/users', cacheService.middleware());
        app.use('/api/search', cacheService.middleware());
        
        // Add cache invalidation middleware
        app.use(cacheService.invalidationMiddleware());
        
        // Example route with slow response (simulating database query)
        app.get('/api/products', async (req, res) => {
            console.log('   📦 Processing products request...');
            
            // Simulate slow database query
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const products = [
                { id: 1, name: 'Laptop', price: 999.99 },
                { id: 2, name: 'Phone', price: 699.99 },
                { id: 3, name: 'Tablet', price: 399.99 }
            ];
            
            res.setHeader('Content-Type', 'application/json');
            res.json({ products, timestamp: new Date().toISOString() });
        });
        
        // Example route that invalidates cache
        app.post('/api/products', async (req, res) => {
            console.log('   📝 Creating new product (will invalidate cache)...');
            
            // Simulate creating product
            const newProduct = { id: 4, ...req.body };
            
            res.status(201).json({ 
                message: 'Product created', 
                product: newProduct 
            });
        });
        
        // Start server
        const server = app.listen(3001, () => {
            console.log('   🌐 Example server listening on port 3001\n');
        });
        
        // Wait a moment for server to start
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Demonstrate cache functionality
        await demonstrateCacheFunctionality();
        
        // Demonstrate admin operations
        await demonstrateAdminOperations();
        
        // Cleanup
        server.close();
        await cacheService.cleanup();
        console.log('\n✅ Demo completed successfully!');
        
    } catch (error) {
        console.error('❌ Demo failed:', error.message);
    }
}

async function demonstrateCacheFunctionality() {
    console.log('2. Testing cache functionality...\n');
    
    try {
        const axios = require('axios');
        const baseURL = 'http://localhost:3001';
        
        // First request - should be a cache miss
        console.log('   📥 Making first request to /api/products...');
        const start1 = Date.now();
        const response1 = await axios.get(`${baseURL}/api/products`);
        const time1 = Date.now() - start1;
        
        console.log(`   ⏱️  Response time: ${time1}ms`);
        console.log(`   🏷️  Cache header: ${response1.headers['x-cache'] || 'not set'}\n`);
        
        // Second request - should be a cache hit
        console.log('   📥 Making second request to /api/products...');
        const start2 = Date.now();
        const response2 = await axios.get(`${baseURL}/api/products`);
        const time2 = Date.now() - start2;
        
        console.log(`   ⏱️  Response time: ${time2}ms`);
        console.log(`   🏷️  Cache header: ${response2.headers['x-cache'] || 'not set'}`);
        console.log(`   🚀 Speed improvement: ${((time1 - time2) / time1 * 100).toFixed(1)}%\n`);
        
        // Show cache stats
        const stats = cacheService.getStats();
        console.log('   📊 Cache Statistics:');
        console.log(`      Hits: ${stats.stats.hits}`);
        console.log(`      Misses: ${stats.stats.misses}`);
        console.log(`      Hit Rate: ${stats.stats.hitRate}\n`);
        
        // Test cache invalidation
        console.log('   🔄 Testing cache invalidation with POST request...');
        await axios.post(`${baseURL}/api/products`, {
            name: 'New Product',
            price: 299.99
        });
        
        // Request after invalidation - should be miss again
        console.log('   📥 Making request after cache invalidation...');
        const start3 = Date.now();
        const response3 = await axios.get(`${baseURL}/api/products`);
        const time3 = Date.now() - start3;
        
        console.log(`   ⏱️  Response time: ${time3}ms`);
        console.log(`   🏷️  Cache header: ${response3.headers['x-cache'] || 'not set'}\n`);
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.log('   ⚠️  Could not connect to example server (expected if not running)\n');
        } else {
            console.error('   ❌ Cache demonstration failed:', error.message);
        }
    }
}

async function demonstrateAdminOperations() {
    console.log('3. Demonstrating admin operations...\n');
    
    try {
        // Manual cache operations
        console.log('   🔧 Manual cache operations:');
        
        // Set cache manually
        if (cacheService.manager) {
            await cacheService.manager.set('manual:key', { data: 'manual value' }, 60);
            console.log('      ✅ Set manual cache entry');
            
            // Get cache manually
            const value = await cacheService.manager.get('manual:key');
            console.log('      📖 Retrieved:', value);
            
            // Get key info
            const keyInfo = await cacheService.manager.getKeyInfo('manual:key');
            console.log('      ℹ️  Key info:', keyInfo);
        }
        
        // Cache utilities demonstration
        console.log('\n   🛠️  Cache Utilities:');
        
        const cacheKey = CacheUtils.generateKey('demo:', 'GET', '/api/test', 
            { page: 1, limit: 10 }, { 'accept': 'application/json' });
        console.log('      🔑 Generated cache key:', cacheKey);
        
        const tags = CacheUtils.generateCacheTags('/api/users/123', 'GET');
        console.log('      🏷️  Generated tags:', tags);
        
        const cacheControl = CacheUtils.createCacheControlHeader(3600, { public: true });
        console.log('      📋 Cache-Control header:', cacheControl);
        
        // Config validation
        const validation = CacheUtils.validateConfig(cacheConfig);
        console.log('      ✅ Config validation:', validation.valid ? 'PASS' : 'FAIL');
        
        // Cache efficiency calculation
        const stats = cacheService.getStats();
        const efficiency = CacheUtils.calculateCacheEfficiency(stats.stats);
        console.log('      📈 Cache efficiency:', efficiency);
        
    } catch (error) {
        console.error('   ❌ Admin operations failed:', error.message);
    }
}

// Utility function to create warm-up data
function createWarmUpData() {
    return {
        'warmup:products:featured': {
            products: [
                { id: 1, name: 'Featured Product 1', featured: true },
                { id: 2, name: 'Featured Product 2', featured: true }
            ],
            timestamp: new Date().toISOString()
        },
        'warmup:config:settings': {
            maintenance: false,
            version: '1.0.0',
            features: ['caching', 'rate-limiting', 'auth']
        }
    };
}

// Run the demo if this file is executed directly
if (require.main === module) {
    demonstrateCache().catch(console.error);
}

module.exports = {
    demonstrateCache,
    createWarmUpData
};
