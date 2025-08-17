const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { sanitizeInput } = require('./middleware/validation');
const databaseService = require('./services/databaseService');
const reservationExpiryService = require('./services/reservationExpiryService');
const logger = require('./utils/logger');

// Startup logging
console.log('🚀 Starting Amenity Reservation API...');
console.log('📦 Node.js version:', process.version);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port:', process.env.PORT || 8080);

const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration - FIXED for production
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:19006',
      'http://localhost:8081',
      process.env.FRONTEND_URL, // Your production frontend URL
    ].filter(Boolean);

    // Allow requests with no origin (mobile apps)
    if (!origin) return callback(null, true);
    
    if (process.env.NODE_ENV === 'development') {
      // Allow all origins in development
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Global rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

// Request parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization
app.use(sanitizeInput);

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Health check route
app.get('/api/health', async (req, res) => {
  try {
    const dbHealthy = await databaseService.testConnection();
    
    res.status(dbHealthy ? 200 : 503).json({
      status: dbHealthy ? 'OK' : 'DEGRADED',
      message: 'Amenity Reservation API Health Status',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: dbHealthy ? 'healthy' : 'unhealthy',
        reservationExpiry: reservationExpiryService.isRunning() ? 'running' : 'stopped'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
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

// Server instance
let server;

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  console.log(`\n📴 ${signal} received, starting graceful shutdown...`);
  
  // Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed');
    });
  }

  try {
    // Stop background services
    reservationExpiryService.stop();
    console.log('✅ Background services stopped');

    // Cleanup database connections
    await databaseService.cleanup();
    console.log('✅ Database connections closed');

    // Exit process
    console.log('👋 Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
async function startServer() {
  try {
    console.log('🔄 Initializing database service...');
    
    await databaseService.initialize();
    logger.info('✅ Database initialized successfully');

    const dbConnected = await databaseService.testConnection();
    if (!dbConnected) {
      throw new Error('Database connection test failed');
    }
    
    logger.info('✅ Database connection test passed');

    // Start background services
    reservationExpiryService.startAutoExpiry();
    logger.info('✅ Reservation expiry service started');

    const cleanedCount = await reservationExpiryService.cleanupOldExpiredReservations();
    if (cleanedCount > 0) {
      logger.info(`🧹 Cleaned up ${cleanedCount} old expired reservations`);
    }

    // Start HTTP server
    const PORT = process.env.PORT || 8080;
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎉 Server successfully started!`);
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('📡 Server is ready to accept connections');
    });

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
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled Rejection:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
startServer();

module.exports = app; // For testing