const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const databaseService = require('./services/databaseService');
const reservationExpiryService = require('./services/reservationExpiryService');
const logger = require('./utils/logger');

// Add startup logging
console.log('🚀 Starting Amenity Reservation API...');
console.log('📦 Node.js version:', process.version);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port:', process.env.PORT || 8080);

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));

// CORS configuration for React Native
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (React Native)
    if (!origin) return callback(null, true);
    
    // Allow your existing origins
    const allowedOrigins = [
      'http://localhost:3000', 
      'http://localhost:19006', 
      'http://localhost:8081'
    ];
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

// Health check route (before other routes)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Amenity Reservation API is healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Amenity Reservation API is running!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    healthCheck: '/api/health'
  });
});

// API routes
app.use('/api', routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize services and start server
const PORT = process.env.PORT || 8080;

async function startServer() {
  try {
    console.log('🔄 Initializing database service...');
    
    // Initialize database service with error handling
    await databaseService.initialize();
    logger.info('✅ Database initialized successfully');

    // Test database connection
    console.log('🧪 Testing database connection...');
    const dbConnected = await databaseService.testConnection();
    if (!dbConnected) {
      throw new Error('Database connection test failed');
    }
    
    logger.info('✅ Database connection test passed');

    // Start reservation expiry service
    try {
      console.log('⏰ Starting reservation expiry service...');
      reservationExpiryService.startAutoExpiry();
      logger.info('✅ Reservation expiry service started');

      // Clean up any existing expired reservations on startup
      const cleanedCount = await reservationExpiryService.cleanupOldExpiredReservations();
      if (cleanedCount > 0) {
        logger.info(`🧹 Cleaned up ${cleanedCount} old expired reservations on startup`);
      }
    } catch (cleanupError) {
      logger.warn('⚠️ Error during startup cleanup:', cleanupError.message);
      // Don't fail startup for cleanup errors
    }

    // Start server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎉 Server successfully started!`);
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🏥 Health check: https://reservation-app-fhb8f7g7duanh7g2.centralus-01.azurewebsites.net/api/health`);
      console.log('📡 Server is ready to accept connections');
    });

    // Handle server errors
    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      logger.error('Server error:', error);
      process.exit(1);
    });

    return server;

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Enhanced error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📤 SIGTERM received, shutting down gracefully');
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    reservationExpiryService.stopAutoExpiry();
    logger.info('✅ Reservation expiry service stopped');
  } catch (error) {
    logger.error('Error stopping expiry service:', error);
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📤 SIGINT received, shutting down gracefully');
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    reservationExpiryService.stopAutoExpiry();
    logger.info('✅ Reservation expiry service stopped');
  } catch (error) {
    logger.error('Error stopping expiry service:', error);
  }
  
  process.exit(0);
});

// Add timeout for startup
const STARTUP_TIMEOUT = 45000; // 45 seconds (less than Azure's 48 second timeout)
setTimeout(() => {
  console.error('❌ Startup timeout reached');
  logger.error('Startup timeout reached');
  process.exit(1);
}, STARTUP_TIMEOUT);

// Start the server
console.log('🔧 Initializing server startup...');
startServer().catch((error) => {
  console.error('❌ Startup failed:', error);
  process.exit(1);
});

module.exports = app;