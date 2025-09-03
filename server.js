const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

// CRITICAL: Log startup immediately
console.log('🚀 Starting Amenity Reservation API...');
console.log('📦 Node.js version:', process.version);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
console.log('🔌 Port:', process.env.PORT || 8080);

// Validate critical environment variables early
const validateEnvironment = () => {
  const critical = ['COSMOS_ENDPOINT', 'COSMOS_KEY'];
  const missing = critical.filter(env => !process.env[env]);
  
  if (missing.length > 0) {
    console.error('❌ Missing critical environment variables:', missing.join(', '));
    console.error('The server will start but database operations will fail.');
    console.error('Please configure these variables in Azure App Service Configuration.');
  } else {
    console.log('✅ Critical environment variables present');
  }
  
  // Log available environment (masked for security)
  console.log('🔧 Environment check:');
  console.log('- COSMOS_ENDPOINT:', process.env.COSMOS_ENDPOINT ? '✅ Present' : '❌ Missing');
  console.log('- COSMOS_KEY:', process.env.COSMOS_KEY ? '✅ Present' : '❌ Missing');
  console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');
};

validateEnvironment();

const app = express();

// CRITICAL: Azure App Service port
const PORT = process.env.PORT || 8080;

// Enhanced request logging for debugging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  
  console.log(`[${timestamp}] ${req.method} ${req.url} - IP: ${clientIP} - UA: ${userAgent}`);
  
  if (req.body && Object.keys(req.body).length > 0) {
    const sanitizedBody = { ...req.body };
    if (sanitizedBody.password) sanitizedBody.password = '[MASKED]';
    console.log(`Request body:`, sanitizedBody);
  }
  
  next();
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
}));

// CORS - Fixed for Azure
app.use(cors({
  origin: true, // Allow all origins initially for testing
  credentials: true
}));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
app.use(morgan('combined'));

// CRITICAL: Root health check for Azure - MUST respond immediately
app.get('/', (req, res) => {
  console.log('🏠 Root health check accessed');
  res.json({
    message: 'Amenity Reservation API is running!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    node: process.version
  });
});

// Health check route
app.get('/health', (req, res) => {
  console.log('🏥 Health check accessed');
  res.status(200).json({
    status: 'OK',
    message: 'API is healthy',
    timestamp: new Date().toISOString()
  });
});

// Minimal API health check that doesn't depend on external services
app.get('/api/health', (req, res) => {
  console.log('🔍 API health check accessed');
  
  const healthStatus = {
    status: 'OK',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      api: 'healthy',
      database: 'checking...',
      cache: 'checking...'
    }
  };

  // Quick service checks (non-blocking)
  try {
    // Check if services are available without waiting
    const databaseService = require('./services/databaseService');
    const cacheService = require('./services/cacheService');
    
    healthStatus.services.database = databaseService?.client ? 'connected' : 'disconnected';
    healthStatus.services.cache = cacheService?.isConnected ? 'connected' : 'disconnected';
  } catch (error) {
    console.warn('Health check service status error:', error.message);
    healthStatus.services.database = 'unknown';
    healthStatus.services.cache = 'unknown';
  }

  res.status(200).json(healthStatus);
});

// Import services after basic routes are set up
let databaseService, cacheService, authService, routes, userRoutes, errorHandler, notFoundHandler, logger;

try {
  routes = require('./routes');
  userRoutes = require('./routes/userRoutes');
  const errorHandlers = require('./middleware/errorHandler');
  errorHandler = errorHandlers.errorHandler;
  notFoundHandler = errorHandlers.notFoundHandler;
  databaseService = require('./services/databaseService');
  cacheService = require('./services/cacheService');
  authService = require('./services/authService');
  logger = require('./utils/logger');
  
  console.log('✅ All modules loaded successfully');
} catch (moduleError) {
  console.error('❌ Failed to load modules:', moduleError.message);
  console.error('Stack:', moduleError.stack);
  // Continue without failing - basic health checks will still work
}

// API routes (only if modules loaded successfully)
if (routes) {
  app.use('/api', routes);
  console.log('✅ Main API routes registered');
} else {
  console.warn('⚠️ Main API routes not registered - module loading failed');
}

if (userRoutes) {
  app.use('/api/auth', userRoutes);
  console.log('✅ Auth routes registered');
} else {
  console.warn('⚠️ Auth routes not registered - module loading failed');
}

// Error handlers (only if available)
if (notFoundHandler && errorHandler) {
  app.use(notFoundHandler);
  app.use(errorHandler);
  console.log('✅ Error handlers registered');
}

// Initialize default users function
const initializeDefaultUsers = async () => {
  try {
    if (!authService) {
      console.warn('⚠️ Auth service not available - skipping default user creation');
      return;
    }
    
    console.log('👤 Initializing default users...');
    await authService.createDefaultAdmin();
    console.log('✅ Default users initialization completed');
  } catch (error) {
    console.error('⚠️ Default users initialization failed:', error.message);
    // Don't crash the server if this fails
  }
};

// Start server with better error handling
async function startServer() {
  try {
    console.log('🔄 Starting server initialization...');
    
    // First, start the HTTP server immediately for Azure health checks
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('=================================');
      console.log('🎉 HTTP Server successfully started!');
      console.log(`✅ Listening on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('📡 Server is ready for requests');
      console.log('=================================');
    });

    // Handle server errors
    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });

    // After server starts, initialize services asynchronously
    console.log('🔄 Starting background service initialization...');
    
    // Initialize database and cache in background (non-blocking)
    setTimeout(async () => {
      try {
        if (databaseService && cacheService) {
          console.log('📊 Connecting to database and cache...');
          await Promise.allSettled([
            databaseService.initialize(),
            cacheService.initialize()
          ]);
          console.log('✅ Database and Cache initialization completed');
          
          // Initialize default users after database connection
          await initializeDefaultUsers();
        } else {
          console.warn('⚠️ Database or Cache services not available');
        }
      } catch (serviceError) {
        console.error('⚠️ Background service initialization failed:', serviceError.message);
        console.log('⚠️ Server continues to run with limited functionality');
      }
    }, 1000); // Wait 1 second after server starts

    // Graceful shutdown handlers
    const gracefulShutdown = () => {
      console.log('📱 Shutdown signal received, closing server gracefully...');
      server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
      });
      
      // Force close after timeout
      setTimeout(() => {
        console.log('⚠️ Force closing server');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    return server;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit immediately in production
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit immediately in production
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Start the server
startServer().catch(error => {
  console.error('❌ Unhandled error during startup:', error);
  process.exit(1);
});

// Export for testing
module.exports = app;