const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');

// Import custom modules
const logger = require('./utils/logger');
const AuthManager = require('./auth/authManager');
const Router = require('./routing/router');
const RateLimiter = require('./middleware/rateLimiter');
const { cacheService, adminRoutes: cacheAdminRoutes } = require('./cache');
const SecurityManager = require('./security/securityManager');
const MonitoringManager = require('./monitoring/monitoringManager');
const CircuitBreaker = require('./circuit-breaker/circuitBreaker');
const RequestTransformer = require('./middleware/requestTransformer');
const ResponseTransformer = require('./middleware/responseTransformer');

class ApiGateway {
    constructor(config) {
        this.config = config;
        this.app = express();
        this.server = null;
        
        // Initialize components
        this.authManager = new AuthManager(config.auth);
        this.router = new Router(config.routing);
        this.rateLimiter = new RateLimiter(config.rateLimit);
        this.cacheService = cacheService;
        this.securityManager = new SecurityManager(config.security);
        this.monitoringManager = new MonitoringManager(config.monitoring);
        this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
        this.requestTransformer = new RequestTransformer(config.transformation);
        this.responseTransformer = new ResponseTransformer(config.transformation);
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }
    
    setupMiddleware() {
        // Security headers
        this.app.use(helmet(this.config.security.helmet));
        
        // CORS
        this.app.use(cors(this.config.security.cors));
        
        // Compression
        this.app.use(compression());
        
        // Cookie parser
        this.app.use(cookieParser());
        
        // Body parsing
        this.app.use(express.json({ limit: this.config.limits.bodySize || '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: this.config.limits.bodySize || '10mb' }));
        
        // Request logging and monitoring
        this.app.use((req, res, next) => {
            req.startTime = Date.now();
            req.requestId = this.generateRequestId();
            
            logger.info(`Incoming request: ${req.method} ${req.url}`, {
                requestId: req.requestId,
                ip: this.getClientIP(req),
                userAgent: req.headers['user-agent']
            });
            
            this.monitoringManager.recordRequest(req);
            next();
        });
        
        // Rate limiting
        if (this.config.rateLimit.enabled) {
            this.app.use(this.rateLimiter.middleware());
        }
        
        // Security middleware
        this.app.use(this.securityManager.middleware());
        
        // Request transformation
        this.app.use(this.requestTransformer.middleware());
    }
    
    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            const healthStatus = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: require('../package.json').version,
                environment: process.env.NODE_ENV || 'development',
                services: this.router.getServiceHealth()
            };
            res.json(healthStatus);
        });
        
        // Metrics endpoint
        this.app.get('/metrics', this.authManager.requireAdmin(), (req, res) => {
            res.json(this.monitoringManager.getMetrics());
        });
        
        // Admin endpoints
        this.app.get('/admin/services', this.authManager.requireAdmin(), (req, res) => {
            res.json(this.router.getRegisteredServices());
        });
        
        this.app.get('/admin/routes', this.authManager.requireAdmin(), (req, res) => {
            res.json(this.router.getRoutes());
        });
        
        // Cache admin routes
        this.app.use('/admin/cache', this.authManager.requireAdmin(), cacheAdminRoutes);
        
        // API documentation (if enabled)
        if (this.config.documentation.enabled) {
            this.setupApiDocumentation();
        }
        
        // Authentication routes
        this.app.use('/auth', this.authManager.getAuthRoutes());
        
        // Main API routing (with authentication)
        this.app.use('/api', 
            this.authManager.authenticate(),
            this.cacheService.middleware(),
            this.cacheService.invalidationMiddleware(),
            this.circuitBreaker.middleware(),
            this.router.middleware(),
            this.responseTransformer.middleware()
        );
        
        // Catch-all route for undefined endpoints
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.method} ${req.originalUrl} not found`,
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
        });
    }
    
    setupApiDocumentation() {
        const swaggerJsdoc = require('swagger-jsdoc');
        const swaggerUi = require('swagger-ui-express');
        
        const options = {
            definition: {
                openapi: '3.0.0',
                info: {
                    title: 'API Gateway',
                    version: '1.0.0',
                    description: 'Comprehensive API Gateway with enterprise features'
                },
                servers: [
                    {
                        url: `http://localhost:${this.config.port}`,
                        description: 'Development server'
                    }
                ]
            },
            apis: ['./src/routing/*.js', './src/auth/*.js']
        };
        
        const specs = swaggerJsdoc(options);
        this.app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs));
    }
    
    setupErrorHandling() {
        // Response logging
        this.app.use((req, res, next) => {
            const originalSend = res.send;
            res.send = function(body) {
                const responseTime = Date.now() - req.startTime;
                
                logger.info(`Response sent: ${req.method} ${req.url}`, {
                    requestId: req.requestId,
                    statusCode: res.statusCode,
                    responseTime: `${responseTime}ms`,
                    contentLength: Buffer.byteLength(body || '')
                });
                
                // Record response metrics
                req.apiGateway?.monitoringManager?.recordResponse(req, res, responseTime);
                
                return originalSend.call(this, body);
            };
            
            req.apiGateway = this;
            next();
        });
        
        // Global error handler
        this.app.use((error, req, res, next) => {
            const responseTime = Date.now() - req.startTime;
            
            logger.error(`Request failed: ${req.method} ${req.url}`, {
                requestId: req.requestId,
                error: error.message,
                stack: error.stack,
                responseTime: `${responseTime}ms`
            });
            
            // Record error metrics
            this.monitoringManager.recordError(req, error);
            
            // Don't send error details in production
            const isProduction = process.env.NODE_ENV === 'production';
            
            res.status(error.status || 500).json({
                error: error.name || 'Internal Server Error',
                message: isProduction ? 'An error occurred' : error.message,
                timestamp: new Date().toISOString(),
                requestId: req.requestId,
                ...(isProduction ? {} : { stack: error.stack })
            });
        });
    }
    
    async start() {
        try {
            // Initialize all components
            await this.cacheService.initialize(this.config.cache);
            await this.router.initialize();
            await this.monitoringManager.initialize();
            
            // Start HTTP server
            this.server = this.app.listen(this.config.port, this.config.host, () => {
                logger.info(`API Gateway listening on ${this.config.host}:${this.config.port}`);
            });
            
            // Configure server timeouts
            this.server.timeout = this.config.server.timeout || 30000;
            this.server.keepAliveTimeout = this.config.server.keepAliveTimeout || 5000;
            this.server.headersTimeout = this.config.server.headersTimeout || 60000;
            
        } catch (error) {
            logger.error('Failed to start API Gateway:', error);
            throw error;
        }
    }
    
    async stop() {
        logger.info('Stopping API Gateway...');
        
        try {
            // Stop accepting new connections
            if (this.server) {
                await new Promise((resolve, reject) => {
                    this.server.close((error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
            }
            
            // Cleanup components
            await this.cacheService.cleanup();
            await this.monitoringManager.cleanup();
            await this.router.cleanup();
            
            logger.info('API Gateway stopped successfully');
            
        } catch (error) {
            logger.error('Error stopping API Gateway:', error);
            throw error;
        }
    }
    
    generateRequestId() {
        return require('uuid').v4();
    }
    
    getClientIP(req) {
        return req.headers['x-forwarded-for'] ||
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress ||
               req.socket.remoteAddress ||
               req.ip;
    }
}

module.exports = ApiGateway;
