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

const app = express();

// Enhanced request logging for debugging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  console.log(`[${timestamp}] ${req.method} ${req.url} - IP: ${clientIP} - UA: ${userAgent}`);
  
  if (req.body && Object.keys(req.body).length > 0) {
    // Log body but mask sensitive data
    const sanitizedBody = { ...req.body };
    if (sanitizedBody.password) sanitizedBody.password = '[MASKED]';
    console.log(`Request body:`, sanitizedBody);
  }
  
  next();
});

// Import after app initialization
const routes = require('./routes');
const userRoutes = require('./routes/userRoutes'); // ✅ NEW: User management routes
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const databaseService = require('./services/databaseService');
const cacheService = require('./services/cacheService');
const authService = require('./services/authService'); // ✅ NEW: For default admin creation
const logger = require('./utils/logger');

// CRITICAL: Azure App Service port
const PORT = process.env.PORT || 8080;

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

// CRITICAL: Root health check for Azure
app.get('/', (req, res) => {
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
  res.status(200).json({
    status: 'OK',
    message: 'API is healthy',
    timestamp: new Date().toISOString()
  });
});

// API health check
app.get('/api/health', async (req, res) => {
  try {
    let dbHealthy = false;
    
    // Check database if initialized
    try {
      if (databaseService.client) {
        dbHealthy = await databaseService.testConnection();
      }
    } catch (dbError) {
      console.error('Database health check failed:', dbError.message);
    }
    
    res.status(200).json({
      status: dbHealthy ? 'OK' : 'DEGRADED',
      message: 'Amenity Reservation API Health Status',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: dbHealthy ? 'connected' : 'disconnected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// API routes
app.use('/api', routes);

// ✅ NEW: User management routes
app.use('/api/auth', userRoutes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// ✅ NEW: Initialize default users function
const initializeDefaultUsers = async () => {
  try {
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
    
    // Initialize database with error handling
    try {
      console.log('📊 Connecting to database...');
      await databaseService.initialize();
      await cacheService.initialize();
      console.log('✅ Database and Cache connected successfully');
      
      // ✅ NEW: Initialize default users after database connection
      await initializeDefaultUsers();
      
    } catch (dbError) {
      console.error('⚠️ Database or Cache connection failed:', dbError.message);
      console.log('⚠️ Server will run without database connection');
      // Don't exit - let the server run even if DB fails initially
    }

    // Start HTTP server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('=================================');
      console.log('🎉 Server successfully started!');
      console.log(`✅ Listening on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('📡 Server is ready');
      console.log('👤 User Management: Enabled');
      console.log('=================================');
    });

    // Handle server errors
    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
      }
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    return server;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Start the server
startServer().catch(error => {
  console.error('❌ Unhandled error during startup:', error);
  process.exit(1);
});

// Export for testing
module.exports = app;