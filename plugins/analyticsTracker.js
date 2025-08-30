const BasePlugin = require('../src/plugins/basePlugin');

class AnalyticsTrackerPlugin extends BasePlugin {
    constructor() {
        super();
        
        this.name = 'AnalyticsTracker';
        this.version = '1.0.0';
        this.description = 'Tracks API usage patterns and generates analytics';
        this.author = 'API Gateway Team';
        
        this.analytics = {
            requests: {
                total: 0,
                byMethod: {},
                byPath: {},
                byStatusCode: {},
                byHour: {},
                byUserAgent: {}
            },
            performance: {
                responseTimes: [],
                averageResponseTime: 0,
                slowestRequests: []
            },
            errors: {
                total: 0,
                byType: {},
                byPath: {}
            }
        };
        
        this.startTime = Date.now();
    }
    
    async beforeRequest(context) {
        const { req } = context;
        
        // Track request start
        req.pluginData = req.pluginData || {};
        req.pluginData.analyticsTracker = {
            startTime: Date.now()
        };
        
        // Update analytics
        this.analytics.requests.total++;
        
        // Track by method
        const method = req.method;
        this.analytics.requests.byMethod[method] = 
            (this.analytics.requests.byMethod[method] || 0) + 1;
        
        // Track by path
        const path = req.path || req.url;
        this.analytics.requests.byPath[path] = 
            (this.analytics.requests.byPath[path] || 0) + 1;
        
        // Track by hour
        const hour = new Date().getHours();
        this.analytics.requests.byHour[hour] = 
            (this.analytics.requests.byHour[hour] || 0) + 1;
        
        // Track by user agent (simplified)
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const simplifiedUA = this.simplifyUserAgent(userAgent);
        this.analytics.requests.byUserAgent[simplifiedUA] = 
            (this.analytics.requests.byUserAgent[simplifiedUA] || 0) + 1;
        
        this.log('debug', 'Request analytics tracked', { 
            requestId: req.requestId,
            method,
            path
        });
        
        return context;
    }
    
    async afterResponse(context) {
        const { req, res } = context;
        
        if (req.pluginData?.analyticsTracker) {
            const { startTime } = req.pluginData.analyticsTracker;
            const responseTime = Date.now() - startTime;
            
            // Track response time
            this.analytics.performance.responseTimes.push(responseTime);
            
            // Keep only last 1000 response times for average calculation
            if (this.analytics.performance.responseTimes.length > 1000) {
                this.analytics.performance.responseTimes.shift();
            }
            
            // Update average response time
            this.analytics.performance.averageResponseTime = 
                this.analytics.performance.responseTimes.reduce((a, b) => a + b, 0) / 
                this.analytics.performance.responseTimes.length;
            
            // Track slowest requests (top 10)
            const requestData = {
                requestId: req.requestId,
                method: req.method,
                path: req.path,
                responseTime,
                timestamp: new Date().toISOString()
            };
            
            this.analytics.performance.slowestRequests.push(requestData);
            this.analytics.performance.slowestRequests.sort((a, b) => b.responseTime - a.responseTime);
            this.analytics.performance.slowestRequests = this.analytics.performance.slowestRequests.slice(0, 10);
            
            // Track by status code
            const statusCode = res.statusCode;
            this.analytics.requests.byStatusCode[statusCode] = 
                (this.analytics.requests.byStatusCode[statusCode] || 0) + 1;
            
            this.log('debug', 'Response analytics tracked', { 
                requestId: req.requestId,
                responseTime: `${responseTime}ms`,
                statusCode
            });
        }
        
        return context;
    }
    
    async onError(context) {
        const { req, error } = context;
        
        this.analytics.errors.total++;
        
        // Track by error type
        const errorType = error.name || 'UnknownError';
        this.analytics.errors.byType[errorType] = 
            (this.analytics.errors.byType[errorType] || 0) + 1;
        
        // Track by path
        const path = req.path || req.url;
        this.analytics.errors.byPath[path] = 
            (this.analytics.errors.byPath[path] || 0) + 1;
        
        this.log('debug', 'Error analytics tracked', { 
            requestId: req.requestId,
            errorType,
            path
        });
        
        return context;
    }
    
    /**
     * Simplify user agent for analytics
     */
    simplifyUserAgent(userAgent) {
        if (userAgent.includes('Chrome')) return 'Chrome';
        if (userAgent.includes('Firefox')) return 'Firefox';
        if (userAgent.includes('Safari')) return 'Safari';
        if (userAgent.includes('Edge')) return 'Edge';
        if (userAgent.includes('curl')) return 'curl';
        if (userAgent.includes('Postman')) return 'Postman';
        if (userAgent.includes('axios')) return 'axios';
        return 'Other';
    }
    
    /**
     * Get analytics data
     */
    getAnalytics() {
        const uptime = Date.now() - this.startTime;
        
        return {
            meta: {
                plugin: this.name,
                uptime: uptime,
                startTime: new Date(this.startTime).toISOString()
            },
            requests: {
                ...this.analytics.requests,
                requestsPerMinute: this.analytics.requests.total / (uptime / 60000),
                topPaths: this.getTopPaths(5),
                topUserAgents: this.getTopUserAgents(5)
            },
            performance: {
                ...this.analytics.performance,
                averageResponseTime: Math.round(this.analytics.performance.averageResponseTime * 100) / 100
            },
            errors: {
                ...this.analytics.errors,
                errorRate: this.analytics.requests.total > 0 ? 
                    (this.analytics.errors.total / this.analytics.requests.total * 100).toFixed(2) + '%' : '0%',
                topErrorPaths: this.getTopErrorPaths(5)
            }
        };
    }
    
    /**
     * Get top requested paths
     */
    getTopPaths(limit = 10) {
        return Object.entries(this.analytics.requests.byPath)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([path, count]) => ({ path, count }));
    }
    
    /**
     * Get top user agents
     */
    getTopUserAgents(limit = 10) {
        return Object.entries(this.analytics.requests.byUserAgent)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([userAgent, count]) => ({ userAgent, count }));
    }
    
    /**
     * Get top error paths
     */
    getTopErrorPaths(limit = 10) {
        return Object.entries(this.analytics.errors.byPath)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([path, count]) => ({ path, count }));
    }
    
    /**
     * Reset analytics data
     */
    resetAnalytics() {
        this.analytics = {
            requests: {
                total: 0,
                byMethod: {},
                byPath: {},
                byStatusCode: {},
                byHour: {},
                byUserAgent: {}
            },
            performance: {
                responseTimes: [],
                averageResponseTime: 0,
                slowestRequests: []
            },
            errors: {
                total: 0,
                byType: {},
                byPath: {}
            }
        };
        
        this.startTime = Date.now();
        this.log('info', 'Analytics data reset');
    }
}

module.exports = AnalyticsTrackerPlugin;
