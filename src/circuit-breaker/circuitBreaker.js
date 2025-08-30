const logger = require('../utils/logger');

class CircuitBreaker {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            timeout: config.timeout || 5000, // 5 seconds
            errorThreshold: config.errorThreshold || 50, // 50% error rate
            errorCount: config.errorCount || 5, // Minimum errors before opening
            resetTimeout: config.resetTimeout || 60000, // 1 minute
            halfOpenRequests: config.halfOpenRequests || 3, // Requests in half-open state
            monitoringWindow: config.monitoringWindow || 10000, // 10 seconds
            services: config.services || {}
        };
        
        // Circuit state for each service
        this.circuits = new Map();
        this.stats = new Map();
    }
    
    /**
     * Initialize circuit breaker
     */
    async initialize() {
        if (!this.config.enabled) {
            logger.info('Circuit breaker disabled');
            return;
        }
        
        logger.info('Circuit breaker initialized', {
            timeout: this.config.timeout,
            errorThreshold: this.config.errorThreshold,
            resetTimeout: this.config.resetTimeout
        });
    }
    
    /**
     * Get or create circuit for a service
     */
    getCircuit(serviceName) {
        if (!this.circuits.has(serviceName)) {
            const serviceConfig = this.config.services[serviceName] || {};
            
            this.circuits.set(serviceName, {
                state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
                failures: 0,
                successes: 0,
                lastFailureTime: null,
                lastStateChange: Date.now(),
                halfOpenRequests: 0,
                config: {
                    timeout: serviceConfig.timeout || this.config.timeout,
                    errorThreshold: serviceConfig.errorThreshold || this.config.errorThreshold,
                    errorCount: serviceConfig.errorCount || this.config.errorCount,
                    resetTimeout: serviceConfig.resetTimeout || this.config.resetTimeout,
                    halfOpenRequests: serviceConfig.halfOpenRequests || this.config.halfOpenRequests
                }
            });
            
            this.stats.set(serviceName, {
                totalRequests: 0,
                totalFailures: 0,
                totalSuccesses: 0,
                totalTimeouts: 0,
                stateChanges: [],
                lastError: null
            });
        }
        
        return this.circuits.get(serviceName);
    }
    
    /**
     * Circuit breaker middleware
     */
    middleware() {
        return async (req, res, next) => {
            if (!this.config.enabled) {
                return next();
            }
            
            // Attach circuit breaker to request
            req.circuitBreaker = this;
            
            // Get service name from request
            const serviceName = this.getServiceName(req);
            if (!serviceName) {
                return next();
            }
            
            const circuit = this.getCircuit(serviceName);
            
            // Check circuit state
            if (circuit.state === 'OPEN') {
                // Check if enough time has passed to try again
                if (Date.now() - circuit.lastStateChange >= circuit.config.resetTimeout) {
                    this.transitionToHalfOpen(serviceName);
                } else {
                    // Circuit is open, reject request
                    return this.rejectRequest(req, res, serviceName);
                }
            }
            
            // Add circuit breaker context to request
            req.circuitBreakerContext = {
                serviceName,
                startTime: Date.now()
            };
            
            next();
        };
    }
    
    /**
     * Execute function with circuit breaker
     */
    async execute(serviceName, fn, fallback = null) {
        const circuit = this.getCircuit(serviceName);
        const stats = this.stats.get(serviceName);
        
        // Check circuit state
        if (circuit.state === 'OPEN') {
            // Check if enough time has passed to try again
            if (Date.now() - circuit.lastStateChange >= circuit.config.resetTimeout) {
                this.transitionToHalfOpen(serviceName);
            } else {
                // Circuit is open, use fallback or throw error
                if (fallback) {
                    return await fallback();
                }
                throw new CircuitBreakerError('Circuit breaker is OPEN', serviceName);
            }
        }
        
        // Check half-open state
        if (circuit.state === 'HALF_OPEN') {
            if (circuit.halfOpenRequests >= circuit.config.halfOpenRequests) {
                // Too many requests in half-open state
                if (fallback) {
                    return await fallback();
                }
                throw new CircuitBreakerError('Circuit breaker is HALF_OPEN - max requests reached', serviceName);
            }
            circuit.halfOpenRequests++;
        }
        
        // Execute the function with timeout
        try {
            stats.totalRequests++;
            
            const result = await this.executeWithTimeout(fn, circuit.config.timeout);
            
            // Record success
            this.recordSuccess(serviceName);
            
            return result;
            
        } catch (error) {
            // Record failure
            this.recordFailure(serviceName, error);
            
            // Use fallback if available
            if (fallback) {
                return await fallback();
            }
            
            throw error;
        }
    }
    
    /**
     * Execute function with timeout
     */
    async executeWithTimeout(fn, timeout) {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Circuit breaker timeout'));
            }, timeout);
            
            try {
                const result = await fn();
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }
    
    /**
     * Record successful request
     */
    recordSuccess(serviceName) {
        const circuit = this.getCircuit(serviceName);
        const stats = this.stats.get(serviceName);
        
        circuit.successes++;
        stats.totalSuccesses++;
        
        if (circuit.state === 'HALF_OPEN') {
            // Check if we can close the circuit
            if (circuit.successes >= circuit.config.halfOpenRequests) {
                this.transitionToClosed(serviceName);
            }
        }
        
        // Reset failure count in closed state
        if (circuit.state === 'CLOSED') {
            circuit.failures = 0;
        }
        
        logger.debug('Circuit breaker success recorded', {
            service: serviceName,
            state: circuit.state
        });
    }
    
    /**
     * Record failed request
     */
    recordFailure(serviceName, error) {
        const circuit = this.getCircuit(serviceName);
        const stats = this.stats.get(serviceName);
        
        circuit.failures++;
        stats.totalFailures++;
        stats.lastError = {
            message: error.message,
            timestamp: new Date().toISOString()
        };
        
        circuit.lastFailureTime = Date.now();
        
        if (error.message && error.message.includes('timeout')) {
            stats.totalTimeouts++;
        }
        
        // Check if we should open the circuit
        if (circuit.state === 'CLOSED') {
            const errorRate = (circuit.failures / (circuit.failures + circuit.successes)) * 100;
            
            if (circuit.failures >= circuit.config.errorCount && 
                errorRate >= circuit.config.errorThreshold) {
                this.transitionToOpen(serviceName);
            }
        } else if (circuit.state === 'HALF_OPEN') {
            // Single failure in half-open state opens the circuit
            this.transitionToOpen(serviceName);
        }
        
        logger.debug('Circuit breaker failure recorded', {
            service: serviceName,
            state: circuit.state,
            failures: circuit.failures,
            error: error.message
        });
    }
    
    /**
     * Transition to OPEN state
     */
    transitionToOpen(serviceName) {
        const circuit = this.getCircuit(serviceName);
        const stats = this.stats.get(serviceName);
        
        circuit.state = 'OPEN';
        circuit.lastStateChange = Date.now();
        circuit.halfOpenRequests = 0;
        
        stats.stateChanges.push({
            from: circuit.state,
            to: 'OPEN',
            timestamp: new Date().toISOString()
        });
        
        logger.warn('Circuit breaker opened', {
            service: serviceName,
            failures: circuit.failures
        });
    }
    
    /**
     * Transition to HALF_OPEN state
     */
    transitionToHalfOpen(serviceName) {
        const circuit = this.getCircuit(serviceName);
        const stats = this.stats.get(serviceName);
        
        const previousState = circuit.state;
        circuit.state = 'HALF_OPEN';
        circuit.lastStateChange = Date.now();
        circuit.failures = 0;
        circuit.successes = 0;
        circuit.halfOpenRequests = 0;
        
        stats.stateChanges.push({
            from: previousState,
            to: 'HALF_OPEN',
            timestamp: new Date().toISOString()
        });
        
        logger.info('Circuit breaker half-open', {
            service: serviceName
        });
    }
    
    /**
     * Transition to CLOSED state
     */
    transitionToClosed(serviceName) {
        const circuit = this.getCircuit(serviceName);
        const stats = this.stats.get(serviceName);
        
        const previousState = circuit.state;
        circuit.state = 'CLOSED';
        circuit.lastStateChange = Date.now();
        circuit.failures = 0;
        circuit.successes = 0;
        circuit.halfOpenRequests = 0;
        
        stats.stateChanges.push({
            from: previousState,
            to: 'CLOSED',
            timestamp: new Date().toISOString()
        });
        
        logger.info('Circuit breaker closed', {
            service: serviceName
        });
    }
    
    /**
     * Get service name from request
     */
    getServiceName(req) {
        // Extract service name from path or headers
        const pathSegments = req.path.split('/').filter(s => s);
        
        if (pathSegments[0] === 'api' && pathSegments[1]) {
            return pathSegments[1];
        }
        
        return req.headers['x-service-name'] || null;
    }
    
    /**
     * Reject request when circuit is open
     */
    rejectRequest(req, res, serviceName) {
        const circuit = this.getCircuit(serviceName);
        
        logger.warn('Request rejected by circuit breaker', {
            service: serviceName,
            requestId: req.requestId
        });
        
        res.status(503).json({
            error: 'Service Unavailable',
            message: `Service ${serviceName} is currently unavailable`,
            retryAfter: Math.ceil((circuit.config.resetTimeout - (Date.now() - circuit.lastStateChange)) / 1000),
            requestId: req.requestId
        });
    }
    
    /**
     * Get circuit status
     */
    getStatus(serviceName = null) {
        if (serviceName) {
            const circuit = this.circuits.get(serviceName);
            const stats = this.stats.get(serviceName);
            
            if (!circuit) {
                return null;
            }
            
            return {
                service: serviceName,
                state: circuit.state,
                failures: circuit.failures,
                successes: circuit.successes,
                lastFailureTime: circuit.lastFailureTime,
                lastStateChange: circuit.lastStateChange,
                stats: stats,
                config: circuit.config
            };
        }
        
        // Return all circuits status
        const status = {};
        
        this.circuits.forEach((circuit, name) => {
            status[name] = this.getStatus(name);
        });
        
        return status;
    }
    
    /**
     * Reset circuit breaker for a service
     */
    reset(serviceName) {
        if (this.circuits.has(serviceName)) {
            this.circuits.delete(serviceName);
            this.stats.delete(serviceName);
            
            logger.info('Circuit breaker reset', { service: serviceName });
        }
    }
    
    /**
     * Cleanup
     */
    async cleanup() {
        this.circuits.clear();
        this.stats.clear();
        logger.info('Circuit breaker cleaned up');
    }
}

/**
 * Circuit Breaker Error
 */
class CircuitBreakerError extends Error {
    constructor(message, serviceName) {
        super(message);
        this.name = 'CircuitBreakerError';
        this.serviceName = serviceName;
        this.status = 503;
    }
}

module.exports = CircuitBreaker;
module.exports.CircuitBreakerError = CircuitBreakerError;
