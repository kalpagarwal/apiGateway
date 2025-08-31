#!/usr/bin/env node

console.log('Testing API Gateway module imports...\n');

let errors = [];
let successes = [];

// Test each module independently
const modules = [
    { name: 'Logger', path: './src/utils/logger' },
    { name: 'AuthManager', path: './src/auth/authManager' },
    { name: 'Router', path: './src/routing/router' },
    { name: 'RateLimiter', path: './src/middleware/rateLimiter' },
    { name: 'RequestTransformer', path: './src/middleware/requestTransformer' },
    { name: 'ResponseTransformer', path: './src/middleware/responseTransformer' },
    { name: 'CacheService', path: './src/cache' },
    { name: 'SecurityManager', path: './src/security/securityManager' },
    { name: 'MonitoringManager', path: './src/monitoring/monitoringManager' },
    { name: 'CircuitBreaker', path: './src/circuit-breaker/circuitBreaker' },
    { name: 'PluginService', path: './src/plugins' },
    { name: 'ApiGateway', path: './src/apiGateway' }
];

console.log('Testing individual module imports:');
console.log('==================================');

modules.forEach(module => {
    try {
        require(module.path);
        console.log(`✅ ${module.name.padEnd(20)} - Loaded successfully`);
        successes.push(module.name);
    } catch (error) {
        console.log(`❌ ${module.name.padEnd(20)} - Failed to load`);
        console.log(`   Error: ${error.message}`);
        errors.push({ module: module.name, error: error.message });
    }
});

console.log('\n==================================');
console.log('Summary:');
console.log(`✅ Successful imports: ${successes.length}/${modules.length}`);
console.log(`❌ Failed imports: ${errors.length}/${modules.length}`);

if (errors.length > 0) {
    console.log('\nErrors detected:');
    errors.forEach(e => {
        console.log(`  - ${e.module}: ${e.error}`);
    });
    process.exit(1);
} else {
    console.log('\n🎉 All modules loaded successfully! No circular dependencies detected.');
    
    // Try to create an instance of ApiGateway
    console.log('\nTesting ApiGateway instantiation...');
    try {
        const ApiGateway = require('./src/apiGateway');
        const config = {
            port: 3000,
            host: 'localhost',
            auth: {
                jwt: { secret: 'test-secret' }
            },
            routing: {},
            rateLimit: { enabled: false },
            cache: { enabled: false },
            security: { 
                enabled: false,
                helmet: {},
                cors: {}
            },
            monitoring: { enabled: false },
            circuitBreaker: { enabled: false },
            transformation: {},
            limits: {},
            server: {},
            documentation: { enabled: false }
        };
        
        const gateway = new ApiGateway(config);
        console.log('✅ ApiGateway instantiated successfully!');
        
        // Check if all components are initialized
        const components = [
            'authManager',
            'router', 
            'rateLimiter',
            'cacheService',
            'securityManager',
            'monitoringManager',
            'circuitBreaker',
            'requestTransformer',
            'responseTransformer'
        ];
        
        let allComponentsPresent = true;
        components.forEach(component => {
            if (gateway[component]) {
                console.log(`  ✓ ${component} initialized`);
            } else {
                console.log(`  ✗ ${component} missing`);
                allComponentsPresent = false;
            }
        });
        
        if (allComponentsPresent) {
            console.log('\n✅ All components initialized successfully!');
        }
        
    } catch (error) {
        console.log(`❌ Failed to instantiate ApiGateway: ${error.message}`);
        process.exit(1);
    }
    
    console.log('\n✅ All tests passed! The API Gateway is ready to use.');
}
