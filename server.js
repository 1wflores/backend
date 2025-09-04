const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

// ==========================================
// STARTUP LOGGING & ENVIRONMENT VALIDATION
// ==========================================

const SERVER_CONFIG = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  version: '1.0.0',
  startTime: new Date().toISOString()
};

console.log('🚀 Starting Amenity Reservation API...');
console.log('📦 Node.js version:', process.version);
console.log('🌍 Environment:', SERVER_CONFIG.nodeEnv);
console.log('🔌 Port:', SERVER_CONFIG.port);
console.log('⏰ Started at:', SERVER_CONFIG.startTime);

// Enhanced environment validation
const validateEnvironment = () => {
  const criticalVars = {
    COSMOS_ENDPOINT: process.env.COSMOS_ENDPOINT,
    COSMOS_KEY: process.env.COSMOS_KEY
  };

  const optionalVars = {
    REDIS_URL: process.env.REDIS_URL,
    REDIS_USE_AAD: process.env.REDIS_USE_AAD,
    JWT_SECRET: process.env.JWT_SECRET
  };

  console.log('🔧 Environment validation:');
  
  const missing = [];
  Object.entries(criticalVars).forEach(([key, value]) => {
    const status = value ? '✅ Present' : '❌ Missing';
    console.log(`- ${key}: ${status}`);
    if (!value) missing.push(key);
  });

  Object.entries(optionalVars).forEach(([key, value]) => {
    const status = value ? '✅ Present' : '⚠️ Optional';
    console.log(`- ${key}: ${status}`);
  });

  if (missing.length > 0) {
    console.error('❌ Critical environment variables missing:', missing.join(', '));
    console.error('The server will start but some operations will fail.');
  } else {
    console.log('✅ All critical environment variables present');
  }

  return { missing, isValid: missing.length === 0 };
};

const envValidation = validateEnvironment();

// ==========================================
// EXPRESS APP SETUP
// ==========================================

const app = express();

// Enhanced request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  
  // Only log non-health check requests to reduce noise
  if (!req.url.includes('health') && !req.url.includes('robots')) {
    console.log(`[${timestamp}] ${req.method} ${req.url} - IP: ${clientIP} - UA: ${userAgent}`);
  }
  
  next();
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false
}));

// Enhanced CORS configuration
app.use(cors({
  origin: SERVER_CONFIG.nodeEnv === 'production' 
    ? [process.env.FRONTEND_URL, process.env.ADMIN_URL].filter(Boolean)
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Request parsing with limits
app.use(express.json({ 
  limit: '10mb',
  strict: true
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Compression
app.use(compression());

// Enhanced logging
if (SERVER_CONFIG.nodeEnv !== 'test') {
  app.use(morgan(SERVER_CONFIG.nodeEnv === 'production' ? 'combined' : 'dev'));
}

// ==========================================
// IMMEDIATE HEALTH CHECKS (for Azure)
// ==========================================

// Root health check - immediate response for Azure
app.get('/', (req, res) => {
  res.json({
    message: 'Amenity Reservation API is running!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: SERVER_CONFIG.version,
    environment: SERVER_CONFIG.nodeEnv,
    node: process.version,
    uptime: process.uptime()
  });
});

// Basic health endpoint - no dependencies
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'API is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: SERVER_CONFIG.nodeEnv
  });
});

// ==========================================
// SERVICE MANAGEMENT CLASS
// ==========================================

class ServiceManager {
  constructor() {
    this.services = new Map();
    this.initialized = false;
    this.initializationPromise = null;
  }

  // Register a service with initialization logic
  registerService(name, servicePath, initMethod = 'initialize') {
    try {
      const service = require(servicePath);
      this.services.set(name, {
        instance: service,
        initMethod,
        initialized: false,
        error: null
      });
      console.log(`✅ Service registered: ${name}`);
      return service;
    } catch (error) {
      console.error(`❌ Failed to register service ${name}:`, error.message);
      this.services.set(name, {
        instance: null,
        initMethod,
        initialized: false,
        error: error.message
      });
      return null;
    }
  }

  // Get a service instance
  getService(name) {
    const service = this.services.get(name);
    return service ? service.instance : null;
  }

  // Initialize all services
  async initializeServices() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialization();
    return this.initializationPromise;
  }

  async _doInitialization() {
    console.log('🔄 Initializing services...');
    
    const initPromises = [];
    
    for (const [name, serviceConfig] of this.services.entries()) {
      if (!serviceConfig.instance) {
        console.warn(`⚠️ Skipping ${name} - not available`);
        continue;
      }

      const initPromise = this._initializeService(name, serviceConfig);
      initPromises.push(initPromise);
    }

    const results = await Promise.allSettled(initPromises);
    
    // Log results
    results.forEach((result, index) => {
      const serviceName = Array.from(this.services.keys())[index];
      if (result.status === 'fulfilled') {
        console.log(`✅ ${serviceName} initialized successfully`);
      } else {
        console.error(`❌ ${serviceName} initialization failed:`, result.reason?.message);
      }
    });

    this.initialized = true;
    console.log('✅ Service initialization completed');
    
    return this.getServiceStatus();
  }

  async _initializeService(name, serviceConfig) {
    try {
      const { instance, initMethod } = serviceConfig;
      
      if (typeof instance[initMethod] === 'function') {
        await instance[initMethod]();
        serviceConfig.initialized = true;
        serviceConfig.error = null;
      } else {
        throw new Error(`Service ${name} does not have method ${initMethod}`);
      }
    } catch (error) {
      serviceConfig.error = error.message;
      throw error;
    }
  }

  // Get status of all services
  getServiceStatus() {
    const status = {};
    for (const [name, config] of this.services.entries()) {
      status[name] = {
        available: !!config.instance,
        initialized: config.initialized,
        error: config.error
      };
    }
    return status;
  }

  // Graceful shutdown of all services
  async shutdown() {
    console.log('🔄 Shutting down services...');
    
    for (const [name, config] of this.services.entries()) {
      try {
        if (config.instance && typeof config.instance.disconnect === 'function') {
          await config.instance.disconnect();
          console.log(`✅ ${name} disconnected`);
        }
      } catch (error) {
        console.error(`❌ Error disconnecting ${name}:`, error.message);
      }
    }
  }
}

// ==========================================
// SERVICE REGISTRATION & ROUTE SETUP
// ==========================================

const serviceManager = new ServiceManager();

// Register all services
const databaseService = serviceManager.registerService('database', './services/databaseService', 'initialize');
const cacheService = serviceManager.registerService('cache', './services/cacheService', 'connect'); // ✅ FIXED!
const authService = serviceManager.registerService('auth', './services/authService', 'initialize');

// Register routes and middleware
let routes, userRoutes, errorHandler, notFoundHandler, logger;

try {
  routes = require('./routes');
  userRoutes = require('./routes/userRoutes');
  const errorHandlers = require('./middleware/errorHandler');
  errorHandler = errorHandlers.errorHandler;
  notFoundHandler = errorHandlers.notFoundHandler;
  logger = require('./utils/logger');
  
  console.log('✅ All modules loaded successfully');
} catch (moduleError) {
  console.error('❌ Failed to load modules:', moduleError.message);
  console.error('Stack:', moduleError.stack);
}

// Enhanced service health endpoint
app.get('/api/health', async (req, res) => {
  const serviceStatus = serviceManager.getServiceStatus();
  const overallStatus = Object.values(serviceStatus).every(s => s.available && s.initialized);
  
  res.status(overallStatus ? 200 : 503).json({
    status: overallStatus ? 'OK' : 'DEGRADED',
    message: 'API health check',
    timestamp: new Date().toISOString(),
    services: serviceStatus,
    environment: {
      node_env: SERVER_CONFIG.nodeEnv,
      node_version: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  });
});

// Cache test endpoint (enhanced)
app.get('/api/cache-test', async (req, res) => {
  try {
    const cache = serviceManager.getService('cache');
    
    if (!cache) {
      return res.status(503).json({
        success: false,
        message: 'Cache service not available',
        timestamp: new Date().toISOString()
      });
    }

    if (!cache.isConnected) {
      return res.status(503).json({
        success: false,
        message: 'Cache not connected',
        redis_configured: !!(process.env.REDIS_URL),
        timestamp: new Date().toISOString()
      });
    }

    // Test cache operations
    const testKey = `cache-test-${Date.now()}`;
    const testData = { test: true, timestamp: new Date().toISOString() };

    const setResult = await cache.set(testKey, testData, 60);
    const getData = await cache.get(testKey);
    await cache.del(testKey);

    res.json({
      success: true,
      message: 'Cache is working!',
      test_results: {
        set: setResult,
        get: !!getData,
        data_integrity: JSON.stringify(getData) === JSON.stringify(testData)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Cache test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Cache test failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Register API routes
if (routes) {
  app.use('/api', routes);
  console.log('✅ Main API routes registered');
}

if (userRoutes) {
  app.use('/api/auth', userRoutes);
  console.log('✅ Auth routes registered');
}

// Error handlers
if (notFoundHandler && errorHandler) {
  app.use(notFoundHandler);
  app.use(errorHandler);
  console.log('✅ Error handlers registered');
}

// ==========================================
// DEFAULT USER INITIALIZATION
// ==========================================

const initializeDefaultUsers = async () => {
  try {
    const auth = serviceManager.getService('auth');
    if (!auth || typeof auth.createDefaultAdmin !== 'function') {
      console.warn('⚠️ Auth service not available - skipping default user creation');
      return;
    }
    
    console.log('👤 Initializing default users...');
    await auth.createDefaultAdmin();
    console.log('✅ Default users initialized');
  } catch (error) {
    console.error('⚠️ Default users initialization failed:', error.message);
  }
};

// ==========================================
// SERVER STARTUP & SHUTDOWN
// ==========================================

class Server {
  constructor() {
    this.httpServer = null;
    this.isShuttingDown = false;
  }

  async start() {
    try {
      console.log('🔄 Starting server...');
      
      // Start HTTP server first (for Azure health checks)
      this.httpServer = app.listen(SERVER_CONFIG.port, '0.0.0.0', () => {
        console.log('=================================');
        console.log('🎉 HTTP Server successfully started!');
        console.log(`✅ Listening on port ${SERVER_CONFIG.port}`);
        console.log(`🌍 Environment: ${SERVER_CONFIG.nodeEnv}`);
        console.log('📡 Server is ready for requests');
        console.log('=================================');
      });

      // Handle server errors
      this.httpServer.on('error', (error) => {
        console.error('❌ Server error:', error);
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${SERVER_CONFIG.port} is already in use`);
          process.exit(1);
        }
      });

      // Initialize services in the background
      this._initializeServicesAsync();

      // Setup graceful shutdown
      this._setupGracefulShutdown();

      return this.httpServer;
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      throw error;
    }
  }

  async _initializeServicesAsync() {
    try {
      // Small delay to ensure server is fully up
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Initialize services
      await serviceManager.initializeServices();
      
      // Initialize default users after database is ready
      if (serviceManager.getService('database')) {
        await initializeDefaultUsers();
      }
      
      console.log('🎯 Server fully initialized and ready');
    } catch (error) {
      console.error('⚠️ Service initialization failed:', error.message);
      console.log('⚠️ Server continues to run with limited functionality');
    }
  }

  _setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        console.log('⚠️ Force shutdown');
        process.exit(1);
      }

      console.log(`📱 ${signal} received, shutting down gracefully...`);
      this.isShuttingDown = true;

      try {
        // Stop accepting new connections
        if (this.httpServer) {
          this.httpServer.close(() => {
            console.log('✅ HTTP server closed');
          });
        }

        // Shutdown services
        await serviceManager.shutdown();
        
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Force close after timeout
    setTimeout(() => {
      if (this.isShuttingDown) {
        console.log('⚠️ Shutdown timeout, forcing exit');
        process.exit(1);
      }
    }, 15000);
  }
}

// ==========================================
// ERROR HANDLING & STARTUP
// ==========================================

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  
  if (SERVER_CONFIG.nodeEnv === 'production') {
    // In production, try to gracefully shutdown
    console.log('Attempting graceful shutdown...');
    process.exit(1);
  } else {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  
  if (SERVER_CONFIG.nodeEnv === 'production') {
    // Log but don't exit in production
    console.log('Continuing execution in production mode...');
  } else {
    process.exit(1);
  }
});

// Start the server
const server = new Server();
server.start().catch(error => {
  console.error('❌ Fatal error during startup:', error);
  process.exit(1);
});

// Export for testing
module.exports = app;