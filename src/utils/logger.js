const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

// Define colors for each level
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue'
};

winston.addColors(colors);

// Console format for development
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} [${info.level}]: ${info.message}${info.meta ? ' ' + JSON.stringify(info.meta) : ''}`
    )
);

// File format for production
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.uncolorize(),
    winston.format.json()
);

// Create logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels,
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat
        }),
        
        // Error file transport
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 10485760, // 10MB
            maxFiles: 5
        }),
        
        // Combined file transport
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: fileFormat,
            maxsize: 10485760, // 10MB
            maxFiles: 5
        })
    ],
    
    // Handle exceptions
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log'),
            format: fileFormat
        })
    ],
    
    // Handle rejections
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'rejections.log'),
            format: fileFormat
        })
    ]
});

// Stream for Morgan HTTP logger
logger.stream = {
    write: (message) => {
        logger.http(message.trim());
    }
};

module.exports = logger;
