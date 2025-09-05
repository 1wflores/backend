const winston = require('winston');

// Environment-based log levels
const getLogLevel = () => {
  const env = process.env.NODE_ENV || 'development';
  const customLevel = process.env.LOG_LEVEL;
  
  if (customLevel) return customLevel;
  
  switch (env) {
    case 'production': return 'warn';  // Only warn and error in production
    case 'staging': return 'info';     // Info level for staging
    case 'test': return 'error';       // Only errors in tests
    default: return 'info';            // Info level for development
  }
};

// Custom format for production - minimal and structured
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return JSON.stringify({
      time: timestamp,
      level,
      msg: message,
      ...meta
    });
  })
);

// Development format - readable with colors
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

// Create logger with environment-appropriate configuration
const logger = winston.createLogger({
  level: getLogLevel(),
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  defaultMeta: {
    service: 'amenity-reservation-api',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    new winston.transports.Console({
      silent: process.env.NODE_ENV === 'test'
    })
  ],
  // Don't exit on errors
  exitOnError: false
});

// Add convenience methods with appropriate log levels
logger.success = (message, meta = {}) => {
  logger.info(`✅ ${message}`, meta);
};

logger.warn = (message, meta = {}) => {
  logger.warning(message, meta);
};

// Critical error logging with additional context
logger.critical = (message, meta = {}) => {
  logger.error(`🚨 CRITICAL: ${message}`, {
    ...meta,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memory: process.memoryUsage()
  });
};

// Request logging helper
logger.request = (req, res, duration) => {
  const isError = res.statusCode >= 400;
  const level = isError ? 'error' : 'info';
  
  // Only log requests that are errors or take too long in production
  if (process.env.NODE_ENV === 'production') {
    if (isError || duration > 5000) { // Log errors or slow requests (>5s)
      logger[level]('Request completed', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    }
  } else {
    // Development: log all requests but only important ones
    if (!req.url.includes('health') && !req.url.includes('robots')) {
      logger[level]('Request', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`
      });
    }
  }
};

// Auth-specific logging
logger.auth = {
  login: (username, success, ip) => {
    if (success) {
      logger.info('Login successful', { username, ip });
    } else {
      logger.warn('Login failed', { username, ip });
    }
  },
  
  logout: (username, ip) => {
    logger.info('Logout', { username, ip });
  },
  
  tokenError: (error, ip) => {
    logger.warn('Token validation failed', { error: error.message, ip });
  }
};

// Service-specific logging
logger.service = {
  startup: (serviceName, success, duration) => {
    if (success) {
      logger.info(`Service started: ${serviceName}`, { duration: `${duration}ms` });
    } else {
      logger.error(`Service failed to start: ${serviceName}`);
    }
  },
  
  shutdown: (serviceName) => {
    logger.info(`Service shutdown: ${serviceName}`);
  },
  
  error: (serviceName, error) => {
    logger.error(`Service error: ${serviceName}`, { error: error.message });
  }
};

// Database operation logging
logger.db = {
  operation: (operation, collection, success, duration) => {
    if (process.env.NODE_ENV !== 'production' || !success) {
      const level = success ? 'info' : 'error';
      logger[level](`DB ${operation}`, { 
        collection, 
        success, 
        duration: `${duration}ms` 
      });
    }
  },
  
  connectionError: (error) => {
    logger.error('Database connection error', { error: error.message });
  }
};

// Cache operation logging (minimal)
logger.cache = {
  error: (operation, error) => {
    // Only log cache errors, not individual misses
    logger.error(`Cache ${operation} error`, { error: error.message });
  },
  
  status: (connected, attempts) => {
    if (connected) {
      logger.info('Cache connected');
    } else if (attempts === 1) {
      // Only log the first connection failure
      logger.warn('Cache unavailable - operating without cache');
    }
  }
};

module.exports = logger;