require('dotenv').config();
const ApiGateway = require('./apiGateway');
const ConfigManager = require('./utils/configManager');
const logger = require('./utils/logger');

async function main() {
    try {
        // Load configuration
        const config = await ConfigManager.loadConfig();
        
        // Initialize API Gateway
        const gateway = new ApiGateway(config);
        
        // Start the gateway
        await gateway.start();
        
        logger.info(`API Gateway started on port ${config.port}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        
        // Graceful shutdown handling
        const shutdown = async (signal) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            try {
                await gateway.stop();
                logger.info('API Gateway stopped successfully');
                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown:', error);
                process.exit(1);
            }
        };
        
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            shutdown('uncaughtException');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            shutdown('unhandledRejection');
        });
        
    } catch (error) {
        logger.error('Failed to start API Gateway:', error);
        process.exit(1);
    }
}

// Handle startup
if (require.main === module) {
    main();
}

module.exports = { main };
