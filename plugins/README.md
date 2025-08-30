# API Gateway Plugins

This directory contains plugins for the API Gateway. Plugins extend the functionality of the gateway by hooking into various stages of request processing.

## Available Plugins

### 1. Request Logger (`requestLogger.js`)
- **Purpose**: Logs detailed request and response information to files
- **Hooks**: `beforeRequest`, `afterResponse`, `onError`
- **Features**:
  - Logs requests with sanitized headers
  - Tracks response times
  - Error logging with stack traces
  - Daily log rotation
  - Request counting

### 2. Analytics Tracker (`analyticsTracker.js`)
- **Purpose**: Tracks API usage patterns and generates analytics
- **Hooks**: `beforeRequest`, `afterResponse`, `onError`
- **Features**:
  - Request/response metrics
  - Performance tracking
  - Error analytics
  - Top paths and user agents
  - Hourly usage patterns

### 3. Security Headers (`securityHeaders.js`)
- **Purpose**: Adds comprehensive security headers to responses
- **Hooks**: `beforeResponse`, `onError`
- **Features**:
  - Standard security headers (HSTS, CSP, etc.)
  - Custom headers support
  - Rate limit headers
  - Response time headers
  - CORS headers

## Plugin Development

### Creating a New Plugin

1. **Create Plugin File**: Create a new `.js` file in this directory
2. **Extend BasePlugin**: Your plugin class should extend the `BasePlugin` class
3. **Set Metadata**: Define name, version, description, and author
4. **Implement Hooks**: Add methods for the hooks you want to use

### Example Plugin Structure

```javascript
const BasePlugin = require('../src/plugins/basePlugin');

class MyPlugin extends BasePlugin {
    constructor() {
        super();
        
        this.name = 'MyPlugin';
        this.version = '1.0.0';
        this.description = 'My custom plugin';
        this.author = 'Your Name';
    }
    
    async initialize(config = {}) {
        await super.initialize(config);
        // Plugin initialization logic
    }
    
    async beforeRequest(context) {
        const { req, res, next, gateway } = context;
        // Your logic here
        return context;
    }
    
    async afterResponse(context) {
        const { req, res, next, gateway } = context;
        // Your logic here
        return context;
    }
}

module.exports = MyPlugin;
```

### Available Hooks

| Hook | Description | Context |
|------|-------------|---------|
| `beforeRequest` | Called before request processing | `{ req, res, next, gateway }` |
| `afterRequest` | Called after request processing | `{ req, res, next, gateway }` |
| `beforeAuth` | Called before authentication | `{ req, res, next, gateway }` |
| `afterAuth` | Called after authentication | `{ req, res, next, gateway }` |
| `beforeRouting` | Called before route matching | `{ req, res, next, gateway }` |
| `afterRouting` | Called after route matching | `{ req, res, next, gateway }` |
| `beforeCache` | Called before cache lookup | `{ req, res, next, gateway }` |
| `afterCache` | Called after cache operation | `{ req, res, next, gateway }` |
| `beforeResponse` | Called before response sent | `{ req, res, next, gateway }` |
| `afterResponse` | Called after response sent | `{ req, res, next, gateway }` |
| `onError` | Called when error occurs | `{ req, res, next, gateway, error }` |
| `onStartup` | Called on gateway startup | `{ gateway }` |
| `onShutdown` | Called on gateway shutdown | `{ gateway }` |

### Plugin Utilities

The `BasePlugin` class provides several utilities:

- `this.log(level, message, meta)` - Plugin logging
- `this.getConfig(key)` - Get configuration value
- `this.setConfig(key, value)` - Set configuration value
- `this.isInitialized()` - Check if plugin is initialized
- `this.getMetadata()` - Get plugin metadata

### Plugin Configuration

Plugins can be configured through the gateway configuration:

```javascript
{
  plugins: {
    enabled: true,
    autoLoad: true,
    pluginDir: './plugins',
    allowedPlugins: [], // Empty = all allowed
    disabledPlugins: ['somePlugin'],
    pluginConfigs: {
      requestLogger: {
        logDir: './logs/requests',
        enabled: true
      },
      analyticsTracker: {
        trackUserAgents: true,
        maxSlowRequests: 100
      }
    }
  }
}
```

## Plugin Management

### Admin API Endpoints

- `GET /admin/plugins` - List all loaded plugins
- `GET /admin/plugins/stats` - Get plugin statistics
- `GET /admin/plugins/:name` - Get specific plugin info
- `POST /admin/plugins/:name/load` - Load a plugin
- `POST /admin/plugins/:name/unload` - Unload a plugin
- `POST /admin/plugins/:name/reload` - Reload a plugin
- `GET /admin/plugins/health` - Plugin system health check

### Loading/Unloading Plugins

Plugins are automatically loaded from this directory on startup. You can also:

1. **Manual Loading**: Use the admin API to load plugins dynamically
2. **Hot Reloading**: Reload plugins without restarting the gateway
3. **Selective Loading**: Configure which plugins to load via configuration

## Best Practices

1. **Error Handling**: Always wrap plugin logic in try-catch blocks
2. **Performance**: Keep plugin logic lightweight to avoid performance impact
3. **Logging**: Use the plugin logging utilities for consistent log format
4. **Configuration**: Make plugins configurable for different environments
5. **Testing**: Test plugins thoroughly, especially error scenarios
6. **Documentation**: Document your plugin's purpose, configuration, and behavior

## Troubleshooting

### Common Issues

1. **Plugin Not Loading**:
   - Check file permissions
   - Verify plugin class structure
   - Check for syntax errors in plugin file

2. **Plugin Errors**:
   - Check gateway logs for plugin-specific errors
   - Verify hook method signatures
   - Test plugin in isolation

3. **Performance Issues**:
   - Profile plugin execution time
   - Optimize slow plugin operations
   - Consider async operations for heavy tasks

### Debug Mode

Enable debug logging to see detailed plugin execution:

```javascript
{
  logging: {
    level: 'debug'
  }
}
```

## Examples

Check the `examples/pluginExample.js` file for comprehensive examples and demonstrations of the plugin system.

## Contributing

When adding new plugins to this directory:

1. Follow the plugin structure guidelines
2. Add comprehensive error handling
3. Include configuration options
4. Update this README with plugin documentation
5. Add examples and usage instructions
