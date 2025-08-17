const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const databaseService = require('./services/databaseService');
const reservationExpiryService = require('./services/reservationExpiryService'); // ✅ NEW
const logger = require('./utils/logger');

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));

// CORS fixed for React Native
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (React Native)
    if (!origin) return callback(null, true);
    
    // Allow your existing origins
    const allowedOrigins = ['http://localhost:3000', 'http://localhost:19006', 'http://localhost:8081'];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow React Native and mobile apps
    return callback(null, true);
  },
  credentials: true
}));

// Request parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// API routes
app.use('/api', routes);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Amenity Reservation API is running!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize services and start server
const PORT = process.env.PORT || 8080;

async function startServer() {
  try {
    // Initialize database service properly
    await databaseService.initialize();
    logger.info('Database initialized successfully');

    // Test database connection
    const dbConnected = await databaseService.testConnection();
    if (!dbConnected) {
      throw new Error('Database connection test failed');
    }

    logger.info('Database connection test passed');

    // ✅ NEW: Start reservation expiry service
    reservationExpiryService.startAutoExpiry();

    // ✅ NEW: Clean up any existing expired reservations on startup
    try {
      const cleanedCount = await reservationExpiryService.cleanupOldExpiredReservations();
      if (cleanedCount > 0) {
        logger.info(`🧹 Cleaned up ${cleanedCount} old expired reservations on startup`);
      }
    } catch (cleanupError) {
      logger.warn('⚠️ Error during startup cleanup:', cleanupError.message);
    }

    // Start server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Health check: https://reservation-app-fhb8f7g7duanh7g2.centralus-01.azurewebsites.net/api/health`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // ✅ NEW: Stop expiry service on shutdown
  reservationExpiryService.stopAutoExpiry();
  
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  // ✅ NEW: Stop expiry service on shutdown
  reservationExpiryService.stopAutoExpiry();
  
  process.exit(0);
});

// Start the server
startServer();

module.exports = app;