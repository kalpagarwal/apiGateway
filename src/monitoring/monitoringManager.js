const logger = require('../utils/logger');
const os = require('os');

class MonitoringManager {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            metricsInterval: config.metricsInterval || 60000, // 1 minute
            retentionPeriod: config.retentionPeriod || 86400000, // 24 hours
            alertThresholds: config.alertThresholds || {
                errorRate: 10, // 10%
                responseTime: 1000, // 1 second
                cpuUsage: 80, // 80%
                memoryUsage: 80 // 80%
            }
        };
        
        this.metrics = {
            requests: {
                total: 0,
                byMethod: {},
                byPath: {},
                byStatusCode: {},
                byMinute: []
            },
            responses: {
                total: 0,
                times: [],
                averageTime: 0,
                minTime: Infinity,
                maxTime: 0
            },
            errors: {
                total: 0,
                byType: {},
                byPath: {},
                rate: 0
            },
            system: {
                cpuUsage: [],
                memoryUsage: [],
                uptime: 0,
                startTime: Date.now()
            }
        };
        
        this.alerts = [];
        this.metricsTimer = null;
    }
    
    /**
     * Initialize monitoring
     */
    async initialize() {
        if (!this.config.enabled) {
            logger.info('Monitoring disabled');
            return;
        }
        
        // Start system metrics collection
        this.startSystemMetrics();
        
        // Start metrics cleanup
        this.startMetricsCleanup();
        
        logger.info('Monitoring initialized');
    }
    
    /**
     * Record incoming request
     */
    recordRequest(req) {
        if (!this.config.enabled) return;
        
        this.metrics.requests.total++;
        
        // By method
        const method = req.method;
        this.metrics.requests.byMethod[method] = 
            (this.metrics.requests.byMethod[method] || 0) + 1;
        
        // By path
        const path = req.path;
        this.metrics.requests.byPath[path] = 
            (this.metrics.requests.byPath[path] || 0) + 1;
        
        // By minute
        const minute = new Date().toISOString().slice(0, 16);
        const minuteMetric = this.metrics.requests.byMinute.find(m => m.minute === minute);
        
        if (minuteMetric) {
            minuteMetric.count++;
        } else {
            this.metrics.requests.byMinute.push({
                minute,
                count: 1,
                timestamp: Date.now()
            });
        }
    }
    
    /**
     * Record response
     */
    recordResponse(req, res, responseTime) {
        if (!this.config.enabled) return;
        
        this.metrics.responses.total++;
        
        // Response time
        this.metrics.responses.times.push({
            time: responseTime,
            timestamp: Date.now()
        });
        
        // Keep only last 1000 response times
        if (this.metrics.responses.times.length > 1000) {
            this.metrics.responses.times.shift();
        }
        
        // Update min/max/average
        this.metrics.responses.minTime = Math.min(this.metrics.responses.minTime, responseTime);
        this.metrics.responses.maxTime = Math.max(this.metrics.responses.maxTime, responseTime);
        
        const totalTime = this.metrics.responses.times.reduce((sum, r) => sum + r.time, 0);
        this.metrics.responses.averageTime = totalTime / this.metrics.responses.times.length;
        
        // By status code
        const statusCode = res.statusCode;
        this.metrics.requests.byStatusCode[statusCode] = 
            (this.metrics.requests.byStatusCode[statusCode] || 0) + 1;
        
        // Check for alerts
        this.checkResponseTimeAlert(responseTime);
    }
    
    /**
     * Record error
     */
    recordError(req, error) {
        if (!this.config.enabled) return;
        
        this.metrics.errors.total++;
        
        // By type
        const errorType = error.name || 'UnknownError';
        this.metrics.errors.byType[errorType] = 
            (this.metrics.errors.byType[errorType] || 0) + 1;
        
        // By path
        const path = req.path;
        this.metrics.errors.byPath[path] = 
            (this.metrics.errors.byPath[path] || 0) + 1;
        
        // Calculate error rate
        if (this.metrics.requests.total > 0) {
            this.metrics.errors.rate = 
                (this.metrics.errors.total / this.metrics.requests.total) * 100;
        }
        
        // Check for alerts
        this.checkErrorRateAlert();
        
        logger.error('Error recorded in monitoring', {
            errorType,
            path,
            requestId: req.requestId
        });
    }
    
    /**
     * Start system metrics collection
     */
    startSystemMetrics() {
        this.metricsTimer = setInterval(() => {
            const cpuUsage = this.getCPUUsage();
            const memoryUsage = this.getMemoryUsage();
            
            // Store metrics
            this.metrics.system.cpuUsage.push({
                value: cpuUsage,
                timestamp: Date.now()
            });
            
            this.metrics.system.memoryUsage.push({
                value: memoryUsage,
                timestamp: Date.now()
            });
            
            // Keep only last 100 metrics
            if (this.metrics.system.cpuUsage.length > 100) {
                this.metrics.system.cpuUsage.shift();
            }
            if (this.metrics.system.memoryUsage.length > 100) {
                this.metrics.system.memoryUsage.shift();
            }
            
            // Update uptime
            this.metrics.system.uptime = Date.now() - this.metrics.system.startTime;
            
            // Check for system alerts
            this.checkSystemAlerts(cpuUsage, memoryUsage);
            
        }, this.config.metricsInterval);
    }
    
    /**
     * Start metrics cleanup
     */
    startMetricsCleanup() {
        setInterval(() => {
            const cutoff = Date.now() - this.config.retentionPeriod;
            
            // Clean up old minute metrics
            this.metrics.requests.byMinute = this.metrics.requests.byMinute.filter(
                m => m.timestamp > cutoff
            );
            
            // Clean up old response times
            this.metrics.responses.times = this.metrics.responses.times.filter(
                r => r.timestamp > cutoff
            );
            
            // Clean up old system metrics
            this.metrics.system.cpuUsage = this.metrics.system.cpuUsage.filter(
                m => m.timestamp > cutoff
            );
            this.metrics.system.memoryUsage = this.metrics.system.memoryUsage.filter(
                m => m.timestamp > cutoff
            );
            
            // Clean up old alerts
            this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
            
        }, 3600000); // Every hour
    }
    
    /**
     * Get CPU usage percentage
     */
    getCPUUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        
        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });
        
        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);
        
        return usage;
    }
    
    /**
     * Get memory usage percentage
     */
    getMemoryUsage() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const usage = (usedMem / totalMem) * 100;
        
        return Math.round(usage);
    }
    
    /**
     * Check error rate alert
     */
    checkErrorRateAlert() {
        if (this.metrics.errors.rate > this.config.alertThresholds.errorRate) {
            this.createAlert('ERROR_RATE_HIGH', {
                rate: this.metrics.errors.rate,
                threshold: this.config.alertThresholds.errorRate
            });
        }
    }
    
    /**
     * Check response time alert
     */
    checkResponseTimeAlert(responseTime) {
        if (responseTime > this.config.alertThresholds.responseTime) {
            this.createAlert('RESPONSE_TIME_HIGH', {
                responseTime,
                threshold: this.config.alertThresholds.responseTime
            });
        }
    }
    
    /**
     * Check system alerts
     */
    checkSystemAlerts(cpuUsage, memoryUsage) {
        if (cpuUsage > this.config.alertThresholds.cpuUsage) {
            this.createAlert('CPU_USAGE_HIGH', {
                usage: cpuUsage,
                threshold: this.config.alertThresholds.cpuUsage
            });
        }
        
        if (memoryUsage > this.config.alertThresholds.memoryUsage) {
            this.createAlert('MEMORY_USAGE_HIGH', {
                usage: memoryUsage,
                threshold: this.config.alertThresholds.memoryUsage
            });
        }
    }
    
    /**
     * Create alert
     */
    createAlert(type, data) {
        const alert = {
            type,
            data,
            timestamp: Date.now(),
            time: new Date().toISOString()
        };
        
        this.alerts.push(alert);
        
        // Keep only last 100 alerts
        if (this.alerts.length > 100) {
            this.alerts.shift();
        }
        
        logger.warn('Monitoring alert triggered', alert);
    }
    
    /**
     * Get metrics
     */
    getMetrics() {
        return {
            requests: this.metrics.requests,
            responses: {
                ...this.metrics.responses,
                averageTime: Math.round(this.metrics.responses.averageTime)
            },
            errors: this.metrics.errors,
            system: {
                ...this.metrics.system,
                currentCPU: this.getCPUUsage(),
                currentMemory: this.getMemoryUsage(),
                uptime: Math.floor(this.metrics.system.uptime / 1000), // in seconds
                platform: os.platform(),
                nodeVersion: process.version
            },
            alerts: this.alerts.slice(-10), // Last 10 alerts
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * Get health status
     */
    getHealth() {
        const cpuUsage = this.getCPUUsage();
        const memoryUsage = this.getMemoryUsage();
        const errorRate = this.metrics.errors.rate;
        const avgResponseTime = this.metrics.responses.averageTime;
        
        let status = 'healthy';
        const issues = [];
        
        if (cpuUsage > this.config.alertThresholds.cpuUsage) {
            status = 'degraded';
            issues.push(`High CPU usage: ${cpuUsage}%`);
        }
        
        if (memoryUsage > this.config.alertThresholds.memoryUsage) {
            status = 'degraded';
            issues.push(`High memory usage: ${memoryUsage}%`);
        }
        
        if (errorRate > this.config.alertThresholds.errorRate) {
            status = 'degraded';
            issues.push(`High error rate: ${errorRate.toFixed(2)}%`);
        }
        
        if (avgResponseTime > this.config.alertThresholds.responseTime) {
            status = 'degraded';
            issues.push(`High response time: ${Math.round(avgResponseTime)}ms`);
        }
        
        return {
            status,
            issues,
            metrics: {
                cpuUsage: `${cpuUsage}%`,
                memoryUsage: `${memoryUsage}%`,
                errorRate: `${errorRate.toFixed(2)}%`,
                avgResponseTime: `${Math.round(avgResponseTime)}ms`,
                uptime: `${Math.floor(this.metrics.system.uptime / 1000)}s`,
                totalRequests: this.metrics.requests.total
            },
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * Cleanup
     */
    async cleanup() {
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
        }
        
        logger.info('Monitoring manager cleaned up');
    }
}

module.exports = MonitoringManager;
