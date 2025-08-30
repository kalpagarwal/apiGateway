const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

class AuthManager {
    constructor(config = {}) {
        this.config = {
            jwtSecret: config.jwtSecret || process.env.JWT_SECRET || 'your-secret-key',
            jwtExpiresIn: config.jwtExpiresIn || '24h',
            apiKeyHeader: config.apiKeyHeader || 'x-api-key',
            enableApiKeys: config.enableApiKeys !== false,
            enableJWT: config.enableJWT !== false,
            enableBasicAuth: config.enableBasicAuth || false,
            passwordSalt: config.passwordSalt || 10,
            adminRole: config.adminRole || 'admin'
        };
        
        // In-memory stores (use database in production)
        this.users = new Map();
        this.apiKeys = new Map();
        this.blacklistedTokens = new Set();
        
        // Initialize default users and API keys
        this.initializeDefaults();
    }
    
    initializeDefaults() {
        // Default admin user
        this.createUser({
            id: '1',
            username: 'admin',
            email: 'admin@example.com',
            password: 'admin123',
            role: 'admin',
            permissions: ['read', 'write', 'delete', 'admin']
        });
        
        // Default regular user
        this.createUser({
            id: '2',
            username: 'user',
            email: 'user@example.com',
            password: 'user123',
            role: 'user',
            permissions: ['read', 'write']
        });
        
        // Default API keys
        this.createApiKey({
            key: 'test-api-key-12345',
            name: 'Test API Key',
            userId: '1',
            permissions: ['read', 'write'],
            rateLimit: { requests: 1000, window: '1h' }
        });
        
        this.createApiKey({
            key: 'admin-api-key-67890',
            name: 'Admin API Key',
            userId: '1',
            permissions: ['read', 'write', 'delete', 'admin'],
            rateLimit: { requests: 10000, window: '1h' }
        });
    }
    
    /**
     * Create a new user
     */
    async createUser(userData) {
        try {
            const hashedPassword = await bcrypt.hash(userData.password, this.config.passwordSalt);
            
            const user = {
                id: userData.id || require('uuid').v4(),
                username: userData.username,
                email: userData.email,
                password: hashedPassword,
                role: userData.role || 'user',
                permissions: userData.permissions || ['read'],
                createdAt: new Date(),
                lastLogin: null,
                isActive: true
            };
            
            this.users.set(user.id, user);
            logger.info(`User created: ${user.username} (${user.role})`);
            
            return { ...user, password: undefined }; // Don't return password
        } catch (error) {
            logger.error('Error creating user:', error);
            throw error;
        }
    }
    
    /**
     * Create API key
     */
    createApiKey(keyData) {
        const apiKey = {
            key: keyData.key || this.generateApiKey(),
            name: keyData.name,
            userId: keyData.userId,
            permissions: keyData.permissions || ['read'],
            rateLimit: keyData.rateLimit,
            createdAt: new Date(),
            lastUsed: null,
            isActive: true,
            usage: { requests: 0, lastReset: new Date() }
        };
        
        this.apiKeys.set(apiKey.key, apiKey);
        logger.info(`API key created: ${apiKey.name}`);
        
        return apiKey;
    }
    
    /**
     * Authentication middleware
     */
    authenticate() {
        return async (req, res, next) => {
            try {
                let user = null;
                
                // Try API key authentication first
                if (this.config.enableApiKeys) {
                    user = await this.authenticateApiKey(req);
                }
                
                // Try JWT authentication if API key failed
                if (!user && this.config.enableJWT) {
                    user = await this.authenticateJWT(req);
                }
                
                // Try basic auth if others failed
                if (!user && this.config.enableBasicAuth) {
                    user = await this.authenticateBasic(req);
                }
                
                if (!user) {
                    return res.status(401).json({
                        error: 'Unauthorized',
                        message: 'Authentication required',
                        requestId: req.requestId
                    });
                }
                
                req.user = user;
                req.authMethod = user.authMethod;
                
                logger.debug(`User authenticated: ${user.username} via ${user.authMethod}`, {
                    requestId: req.requestId
                });
                
                next();
                
            } catch (error) {
                logger.error('Authentication error:', error);
                res.status(401).json({
                    error: 'Authentication Error',
                    message: 'Invalid credentials',
                    requestId: req.requestId
                });
            }
        };
    }
    
    /**
     * API Key authentication
     */
    async authenticateApiKey(req) {
        const apiKey = req.headers[this.config.apiKeyHeader];
        
        if (!apiKey) {
            return null;
        }
        
        const keyData = this.apiKeys.get(apiKey);
        
        if (!keyData || !keyData.isActive) {
            throw new Error('Invalid API key');
        }
        
        // Update usage statistics
        keyData.lastUsed = new Date();
        keyData.usage.requests++;
        
        // Get associated user
        const user = this.users.get(keyData.userId);
        
        if (!user || !user.isActive) {
            throw new Error('Associated user not found or inactive');
        }
        
        return {
            ...user,
            password: undefined,
            authMethod: 'apikey',
            apiKey: keyData,
            permissions: keyData.permissions
        };
    }
    
    /**
     * JWT authentication
     */
    async authenticateJWT(req) {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        
        const token = authHeader.substring(7);
        
        if (this.blacklistedTokens.has(token)) {
            throw new Error('Token has been blacklisted');
        }
        
        try {
            const decoded = jwt.verify(token, this.config.jwtSecret);
            const user = this.users.get(decoded.userId);
            
            if (!user || !user.isActive) {
                throw new Error('User not found or inactive');
            }
            
            // Update last login
            user.lastLogin = new Date();
            
            return {
                ...user,
                password: undefined,
                authMethod: 'jwt',
                token: token,
                tokenData: decoded
            };
            
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                throw new Error('Token has expired');
            } else if (error.name === 'JsonWebTokenError') {
                throw new Error('Invalid token');
            }
            throw error;
        }
    }
    
    /**
     * Basic authentication
     */
    async authenticateBasic(req) {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return null;
        }
        
        const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();
        const [username, password] = credentials.split(':');
        
        // Find user by username
        const user = Array.from(this.users.values()).find(u => u.username === username);
        
        if (!user || !user.isActive) {
            throw new Error('User not found or inactive');
        }
        
        // Verify password
        const isValid = await bcrypt.compare(password, user.password);
        
        if (!isValid) {
            throw new Error('Invalid password');
        }
        
        // Update last login
        user.lastLogin = new Date();
        
        return {
            ...user,
            password: undefined,
            authMethod: 'basic'
        };
    }
    
    /**
     * Authorization middleware for specific permissions
     */
    authorize(requiredPermissions = []) {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required',
                    requestId: req.requestId
                });
            }
            
            const userPermissions = req.user.permissions || [];
            const hasPermission = requiredPermissions.every(permission =>
                userPermissions.includes(permission) || userPermissions.includes('admin')
            );
            
            if (!hasPermission) {
                logger.warn(`Authorization failed for user ${req.user.username}`, {
                    requestId: req.requestId,
                    requiredPermissions,
                    userPermissions
                });
                
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Insufficient permissions',
                    requestId: req.requestId,
                    requiredPermissions
                });
            }
            
            next();
        };
    }
    
    /**
     * Admin role requirement
     */
    requireAdmin() {
        return this.authorize(['admin']);
    }
    
    /**
     * Generate JWT token
     */
    generateToken(user) {
        const payload = {
            userId: user.id,
            username: user.username,
            role: user.role,
            permissions: user.permissions,
            iat: Math.floor(Date.now() / 1000)
        };
        
        return jwt.sign(payload, this.config.jwtSecret, {
            expiresIn: this.config.jwtExpiresIn
        });
    }
    
    /**
     * Generate API key
     */
    generateApiKey() {
        return require('uuid').v4().replace(/-/g, '') + Date.now().toString(36);
    }
    
    /**
     * Blacklist JWT token
     */
    blacklistToken(token) {
        this.blacklistedTokens.add(token);
        logger.info('Token blacklisted');
    }
    
    /**
     * Authentication routes
     */
    getAuthRoutes() {
        const router = express.Router();
        
        // Login endpoint
        router.post('/login',
            body('username').notEmpty().withMessage('Username is required'),
            body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
            async (req, res) => {
                try {
                    const errors = validationResult(req);
                    if (!errors.isEmpty()) {
                        return res.status(400).json({
                            error: 'Validation Error',
                            details: errors.array()
                        });
                    }
                    
                    const { username, password } = req.body;
                    
                    // Find user
                    const user = Array.from(this.users.values()).find(u => u.username === username);
                    
                    if (!user || !user.isActive) {
                        return res.status(401).json({
                            error: 'Authentication Failed',
                            message: 'Invalid credentials'
                        });
                    }
                    
                    // Verify password
                    const isValid = await bcrypt.compare(password, user.password);
                    
                    if (!isValid) {
                        return res.status(401).json({
                            error: 'Authentication Failed',
                            message: 'Invalid credentials'
                        });
                    }
                    
                    // Generate token
                    const token = this.generateToken(user);
                    
                    // Update last login
                    user.lastLogin = new Date();
                    
                    logger.info(`User logged in: ${user.username}`, {
                        userId: user.id,
                        role: user.role
                    });
                    
                    res.json({
                        message: 'Login successful',
                        token,
                        user: {
                            id: user.id,
                            username: user.username,
                            email: user.email,
                            role: user.role,
                            permissions: user.permissions
                        }
                    });
                    
                } catch (error) {
                    logger.error('Login error:', error);
                    res.status(500).json({
                        error: 'Internal Server Error',
                        message: 'Login failed'
                    });
                }
            }
        );
        
        // Logout endpoint
        router.post('/logout', this.authenticate(), (req, res) => {
            if (req.authMethod === 'jwt' && req.user.token) {
                this.blacklistToken(req.user.token);
            }
            
            logger.info(`User logged out: ${req.user.username}`, {
                userId: req.user.id
            });
            
            res.json({
                message: 'Logout successful'
            });
        });
        
        // Refresh token endpoint
        router.post('/refresh', this.authenticate(), (req, res) => {
            if (req.authMethod !== 'jwt') {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Token refresh only available for JWT authentication'
                });
            }
            
            const newToken = this.generateToken(req.user);
            
            // Blacklist old token
            if (req.user.token) {
                this.blacklistToken(req.user.token);
            }
            
            res.json({
                message: 'Token refreshed',
                token: newToken
            });
        });
        
        // User profile endpoint
        router.get('/profile', this.authenticate(), (req, res) => {
            res.json({
                user: {
                    id: req.user.id,
                    username: req.user.username,
                    email: req.user.email,
                    role: req.user.role,
                    permissions: req.user.permissions,
                    lastLogin: req.user.lastLogin
                },
                authMethod: req.authMethod
            });
        });
        
        // Create API key endpoint (admin only)
        router.post('/api-keys', 
            this.authenticate(),
            this.requireAdmin(),
            body('name').notEmpty().withMessage('API key name is required'),
            body('permissions').isArray().withMessage('Permissions must be an array'),
            (req, res) => {
                try {
                    const errors = validationResult(req);
                    if (!errors.isEmpty()) {
                        return res.status(400).json({
                            error: 'Validation Error',
                            details: errors.array()
                        });
                    }
                    
                    const apiKey = this.createApiKey({
                        name: req.body.name,
                        userId: req.user.id,
                        permissions: req.body.permissions,
                        rateLimit: req.body.rateLimit
                    });
                    
                    res.status(201).json({
                        message: 'API key created',
                        apiKey: {
                            key: apiKey.key,
                            name: apiKey.name,
                            permissions: apiKey.permissions,
                            createdAt: apiKey.createdAt
                        }
                    });
                    
                } catch (error) {
                    logger.error('Error creating API key:', error);
                    res.status(500).json({
                        error: 'Internal Server Error',
                        message: 'Failed to create API key'
                    });
                }
            }
        );
        
        return router;
    }
    
    /**
     * Validate user permissions
     */
    hasPermission(user, permission) {
        if (!user || !user.permissions) return false;
        return user.permissions.includes(permission) || user.permissions.includes('admin');
    }
    
    /**
     * Get user by ID
     */
    getUserById(id) {
        const user = this.users.get(id);
        if (user) {
            return { ...user, password: undefined };
        }
        return null;
    }
    
    /**
     * Get API key statistics
     */
    getApiKeyStats() {
        const stats = {
            total: this.apiKeys.size,
            active: 0,
            inactive: 0,
            usage: {}
        };
        
        for (const [key, data] of this.apiKeys) {
            if (data.isActive) {
                stats.active++;
            } else {
                stats.inactive++;
            }
            
            stats.usage[key] = {
                name: data.name,
                requests: data.usage.requests,
                lastUsed: data.lastUsed
            };
        }
        
        return stats;
    }
    
    /**
     * Get authentication statistics
     */
    getAuthStats() {
        return {
            users: {
                total: this.users.size,
                active: Array.from(this.users.values()).filter(u => u.isActive).length
            },
            apiKeys: this.getApiKeyStats(),
            blacklistedTokens: this.blacklistedTokens.size,
            config: {
                enableJWT: this.config.enableJWT,
                enableApiKeys: this.config.enableApiKeys,
                enableBasicAuth: this.config.enableBasicAuth
            }
        };
    }
    
    /**
     * Validate API key and get associated user
     */
    async validateApiKey(key) {
        const keyData = this.apiKeys.get(key);
        
        if (!keyData || !keyData.isActive) {
            return null;
        }
        
        const user = this.users.get(keyData.userId);
        
        if (!user || !user.isActive) {
            return null;
        }
        
        return {
            ...user,
            password: undefined,
            apiKey: keyData
        };
    }
    
    /**
     * Revoke API key
     */
    revokeApiKey(key) {
        const keyData = this.apiKeys.get(key);
        if (keyData) {
            keyData.isActive = false;
            logger.info(`API key revoked: ${keyData.name}`);
            return true;
        }
        return false;
    }
    
    /**
     * Change user password
     */
    async changePassword(userId, oldPassword, newPassword) {
        const user = this.users.get(userId);
        
        if (!user) {
            throw new Error('User not found');
        }
        
        const isValid = await bcrypt.compare(oldPassword, user.password);
        
        if (!isValid) {
            throw new Error('Invalid current password');
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, this.config.passwordSalt);
        user.password = hashedPassword;
        
        logger.info(`Password changed for user: ${user.username}`);
    }
}

module.exports = AuthManager;
