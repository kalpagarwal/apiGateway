# Node.js API Gateway

A comprehensive, production-ready API Gateway built with Node.js and Express, featuring enterprise-grade functionality for managing microservices architecture.

## 🚀 Features

### Core Functionality
- **Request Routing**: Dynamic service discovery and intelligent load balancing
- **Authentication & Authorization**: JWT, API keys, OAuth2, and role-based access control
- **Rate Limiting**: Advanced throttling with multiple strategies and quota management
- **Caching**: Redis-based caching with TTL, invalidation strategies, and memory fallback
- **Circuit Breaker**: Fault tolerance with automatic service recovery
- **Request/Response Transformation**: Header manipulation and data transformation
- **Security**: Input validation, XSS/SQL injection protection, and security headers
- **Monitoring & Analytics**: Real-time metrics, performance tracking, and alerts
- **Plugin System**: Extensible architecture with hot-reloadable plugins

## 📁 Project Structure

```
apigateway/
├── config/                 # Configuration files
│   └── cache.js           # Cache configuration
├── examples/              # Usage examples
│   ├── cacheExample.js    # Cache demonstration
│   └── pluginExample.js   # Plugin development guide
├── logs/                  # Application logs
├── plugins/               # Plugin directory
│   ├── analyticsTracker.js  # Analytics plugin
│   ├── requestLogger.js     # Request logging plugin
│   ├── securityHeaders.js   # Security headers plugin
│   └── README.md            # Plugin documentation
├── src/                   # Source code
│   ├── auth/             # Authentication module
│   │   └── authManager.js
│   ├── cache/            # Caching module
│   │   ├── cacheManager.js
│   │   ├── cacheUtils.js
│   │   ├── adminRoutes.js
│   │   └── index.js
│   ├── circuit-breaker/  # Circuit breaker module
│   │   └── circuitBreaker.js
│   ├── middleware/       # Custom middleware
│   │   ├── rateLimiter.js
│   │   ├── requestTransformer.js
│   │   └── responseTransformer.js
│   ├── monitoring/       # Monitoring module
│   │   └── monitoringManager.js
│   ├── plugins/          # Plugin system
│   │   ├── pluginManager.js
│   │   ├── basePlugin.js
│   │   ├── adminRoutes.js
│   │   └── index.js
│   ├── routing/          # Routing module
│   │   └── router.js
│   ├── security/         # Security module
│   │   └── securityManager.js
│   ├── utils/            # Utilities
│   │   └── logger.js
│   ├── apiGateway.js    # Main gateway class
│   └── index.js          # Entry point
├── tests/                # Test files
│   └── cache.test.js
├── package.json          # Dependencies
└── README.md            # This file
```

## 🛠️ Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd apigateway
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start Redis (required for caching):
```bash
docker run -d -p 6379:6379 redis:alpine
```

5. Run the gateway:
```bash
npm start
```

## 🔧 Configuration

### Basic Configuration

```javascript
const config = {
    port: 3000,
    host: 'localhost',
    
    // Authentication
    auth: {
        jwt: {
            secret: 'your-secret-key',
            expiresIn: '1h'
        },
        apiKeys: {
            enabled: true
        }
    },
    
    // Rate Limiting
    rateLimit: {
        enabled: true,
        global: {
            windowMs: 60000,
            maxRequests: 100
        }
    },
    
    // Caching
    cache: {
        enabled: true,
        redis: {
            host: 'localhost',
            port: 6379
        },
        defaultTTL: 300
    },
    
    // Circuit Breaker
    circuitBreaker: {
        enabled: true,
        timeout: 5000,
        errorThreshold: 50,
        resetTimeout: 60000
    }
};
```

## 📚 API Documentation

### Health Check
```bash
GET /health
```

### Metrics
```bash
GET /metrics
Authorization: Bearer <admin-token>
```

### Admin Endpoints

#### Services Management
```bash
GET /admin/services        # List registered services
GET /admin/routes         # List all routes
```

#### Cache Management
```bash
GET /admin/cache/stats    # Cache statistics
DELETE /admin/cache       # Clear cache
POST /admin/cache/warmup  # Warm up cache
```

#### Plugin Management
```bash
GET /admin/plugins        # List loaded plugins
POST /admin/plugins/:name/load    # Load plugin
POST /admin/plugins/:name/unload  # Unload plugin
POST /admin/plugins/:name/reload  # Reload plugin
```

## 🔌 Plugin Development

Create custom plugins by extending the `BasePlugin` class:

```javascript
const BasePlugin = require('./src/plugins/basePlugin');

class MyPlugin extends BasePlugin {
    constructor() {
        super();
        this.name = 'MyPlugin';
        this.version = '1.0.0';
        this.description = 'My custom plugin';
    }
    
    async beforeRequest(context) {
        // Modify request before processing
        return context;
    }
    
    async afterResponse(context) {
        // Process after response
        return context;
    }
}

module.exports = MyPlugin;
```

## 🚦 Rate Limiting

The gateway supports multiple rate limiting strategies:

- **Global limits**: Apply to all requests
- **Per-user limits**: Based on authenticated user
- **Per-API key limits**: Custom limits for API keys
- **Path-specific limits**: Different limits for different endpoints

Example configuration:
```javascript
{
    rateLimit: {
        strategies: {
            '/api/public': { windowMs: 60000, maxRequests: 10 },
            '/api/private': { windowMs: 60000, maxRequests: 100 }
        }
    }
}
```

## 💾 Caching

Redis-based caching with automatic fallback to in-memory cache:

- **TTL Support**: Configure time-to-live per endpoint
- **Cache Invalidation**: Automatic invalidation on write operations
- **Cache Strategies**: Path-specific caching rules
- **Cache Headers**: Support for standard HTTP cache headers

## 🔒 Security Features

- **Input Validation**: Automatic request validation
- **XSS Protection**: Built-in XSS prevention
- **SQL Injection Protection**: Pattern detection and blocking
- **Security Headers**: Comprehensive security headers
- **IP Filtering**: Blacklist/whitelist support
- **CORS**: Configurable CORS policies

## 📊 Monitoring & Analytics

Real-time monitoring with:
- Request/response metrics
- Error tracking
- Performance analytics
- System resource monitoring
- Alert thresholds
- Custom metrics via plugins

## 🧪 Testing

Run tests:
```bash
npm test
```

Run with coverage:
```bash
npm run test:coverage
```

## 🚀 Deployment

### Docker

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### Environment Variables

```bash
NODE_ENV=production
PORT=3000
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=your-secret-key
LOG_LEVEL=info
```

## 📈 Performance

The gateway is optimized for high performance:
- Efficient middleware pipeline
- Connection pooling
- Response caching
- Circuit breaker for fault tolerance
- Load balancing across services

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

For issues and questions:
- Create an issue in the repository
- Check the documentation in `/docs`
- Review examples in `/examples`

## 🎯 Roadmap

- [ ] WebSocket support
- [ ] GraphQL gateway mode
- [ ] Service mesh integration
- [ ] Distributed tracing
- [ ] API versioning
- [ ] Request replay
- [ ] A/B testing support
- [ ] Custom scripting engine

## 👥 Authors

- API Gateway Team

## 🙏 Acknowledgments

- Express.js community
- Node.js ecosystem
- Open source contributors
