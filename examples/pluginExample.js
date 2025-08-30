const { pluginService, BasePlugin } = require('../src/plugins');

/**
 * Example Custom Plugin
 * Demonstrates how to create a custom plugin for the API Gateway
 */
class ExampleCustomPlugin extends BasePlugin {
    constructor() {
        super();
        
        // Plugin metadata (required)
        this.name = 'ExampleCustom';
        this.version = '1.0.0';
        this.description = 'Example custom plugin demonstrating plugin development';
        this.author = 'Your Name';
    }
    
    async initialize(config = {}) {
        await super.initialize(config);
        
        this.log('info', 'Custom plugin initialized with config', { config });
    }
    
    // Hook: Before request processing
    async beforeRequest(context) {
        const { req } = context;
        
        // Add custom header to track plugin execution
        req.headers['x-custom-plugin'] = 'active';
        
        this.log('debug', 'Processing beforeRequest hook', {
            requestId: req.requestId,
            method: req.method,
            path: req.path
        });
        
        return context;
    }
    
    // Hook: After response
    async afterResponse(context) {
        const { req, res } = context;
        
        // Add custom response header
        if (!res.headersSent) {
            res.setHeader('X-Custom-Plugin-Version', this.version);
        }
        
        this.log('debug', 'Processing afterResponse hook', {
            requestId: req.requestId,
            statusCode: res.statusCode
        });
        
        return context;
    }
    
    // Custom method for plugin-specific functionality
    getCustomStats() {
        return {
            name: this.name,
            version: this.version,
            initialized: this.initialized,
            config: this.getConfig()
        };
    }
}

async function demonstratePluginSystem() {
    console.log('🔌 Plugin System Demo\n');
    
    try {
        // Initialize plugin service
        console.log('1. Initializing plugin service...');
        await pluginService.initialize({
            enabled: true,
            autoLoad: true,
            pluginDir: require('path').join(__dirname, '../plugins')
        });
        console.log('   ✅ Plugin service initialized\n');
        
        // Show loaded plugins
        const plugins = pluginService.getLoadedPlugins();
        console.log('2. Loaded plugins:');
        plugins.forEach(plugin => {
            console.log(`   📦 ${plugin.name} v${plugin.version} - ${plugin.description}`);
            console.log(`      Hooks: ${plugin.hooks.join(', ')}`);
        });
        console.log();
        
        // Demonstrate plugin hooks
        console.log('3. Testing plugin hooks...');
        
        // Mock request context
        const mockContext = {
            req: {
                requestId: 'demo-123',
                method: 'GET',
                path: '/api/test',
                headers: {}
            },
            res: {
                statusCode: 200,
                setHeader: (name, value) => console.log(`   📤 Response header set: ${name}=${value}`)
            }
        };
        
        // Execute hooks
        console.log('   🔄 Executing beforeRequest hooks...');
        await pluginService.executeHook('beforeRequest', mockContext);
        
        console.log('   🔄 Executing afterResponse hooks...');
        await pluginService.executeHook('afterResponse', mockContext);
        
        console.log();
        
        // Show plugin statistics
        const stats = pluginService.getStats();
        console.log('4. Plugin Statistics:');
        console.log('   📊 Total plugins:', stats.totalPlugins);
        console.log('   📂 Plugin directory:', stats.pluginDirectory);
        console.log('   🎯 Available hooks:');
        Object.entries(stats.hooks).forEach(([hook, count]) => {
            if (count > 0) {
                console.log(`      ${hook}: ${count} plugins`);
            }
        });
        console.log();
        
        // Demonstrate plugin-specific features
        console.log('5. Plugin-specific features:');
        
        // Analytics plugin
        const analyticsPlugin = pluginService.getPlugin('analyticsTracker');
        if (analyticsPlugin) {
            console.log('   📈 Analytics Plugin found');
            // Would show analytics here, but we need real requests
        }
        
        // Request logger plugin
        const loggerPlugin = pluginService.getPlugin('requestLogger');
        if (loggerPlugin && typeof loggerPlugin.getStats === 'function') {
            const loggerStats = loggerPlugin.getStats();
            console.log('   📝 Request Logger Stats:', loggerStats);
        }
        
        // Security headers plugin
        const securityPlugin = pluginService.getPlugin('securityHeaders');
        if (securityPlugin && typeof securityPlugin.getSecurityConfig === 'function') {
            const securityConfig = securityPlugin.getSecurityConfig();
            console.log('   🔒 Security Headers Count:', Object.keys(securityConfig.headers).length);
        }
        
        console.log();
        
        // Demonstrate plugin management
        console.log('6. Plugin Management:');
        
        // Get plugin info
        const pluginInfo = pluginService.getPluginInfo('requestLogger');
        if (pluginInfo) {
            console.log('   ℹ️  RequestLogger plugin info:');
            console.log(`      Version: ${pluginInfo.version}`);
            console.log(`      Author: ${pluginInfo.author}`);
            console.log(`      Hooks: ${pluginInfo.hooks.length}`);
        }
        
        console.log('\n✅ Plugin system demo completed!');
        
    } catch (error) {
        console.error('❌ Plugin demo failed:', error.message);
    } finally {
        // Cleanup
        await pluginService.cleanup();
    }
}

/**
 * Plugin Development Guide
 */
function showPluginDevelopmentGuide() {
    console.log(`
🔌 Plugin Development Guide
==========================

1. Create Plugin Class:
   - Extend BasePlugin class
   - Set name, version, description, author
   - Implement initialize() method

2. Available Hooks:
   - beforeRequest: Modify incoming requests
   - afterRequest: Process after request handling
   - beforeAuth: Before authentication
   - afterAuth: After authentication
   - beforeRouting: Before route matching
   - afterRouting: After route matching
   - beforeCache: Before cache lookup
   - afterCache: After cache operation
   - beforeResponse: Before response sent
   - afterResponse: After response sent
   - onError: On error occurrence
   - onStartup: On gateway startup
   - onShutdown: On gateway shutdown

3. Context Object:
   - req: Express request object
   - res: Express response object
   - next: Express next function
   - gateway: API Gateway instance
   - error: Error object (in error hooks)

4. Plugin Utilities:
   - this.log(level, message, meta): Logging
   - this.getConfig(key): Get configuration
   - this.setConfig(key, value): Set configuration
   - this.isInitialized(): Check initialization

5. Plugin File Structure:
   plugins/
   ├── yourPlugin.js          # Your plugin file
   └── anotherPlugin.js       # Another plugin

6. Example Plugin:
   \`\`\`javascript
   const BasePlugin = require('../src/plugins/basePlugin');
   
   class YourPlugin extends BasePlugin {
       constructor() {
           super();
           this.name = 'YourPlugin';
           this.version = '1.0.0';
           this.description = 'Your plugin description';
           this.author = 'Your Name';
       }
       
       async beforeRequest(context) {
           // Your logic here
           return context;
       }
   }
   
   module.exports = YourPlugin;
   \`\`\`

7. Plugin Administration:
   - GET /admin/plugins - List all plugins
   - GET /admin/plugins/:name - Get plugin info
   - POST /admin/plugins/:name/load - Load plugin
   - POST /admin/plugins/:name/unload - Unload plugin
   - POST /admin/plugins/:name/reload - Reload plugin
`);
}

// Run demo if this file is executed directly
if (require.main === module) {
    demonstratePluginSystem().catch(console.error);
}

module.exports = {
    ExampleCustomPlugin,
    demonstratePluginSystem,
    showPluginDevelopmentGuide
};
