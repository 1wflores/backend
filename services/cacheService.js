// Enhanced cacheService.js with reduced logging but full functionality preserved

const redis = require('redis');
const { DefaultAzureCredential } = require('@azure/identity');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.retryAttempts = 0;
    this.maxRetries = 2; // Reduced from 3
    this.retryDelay = 10000; // Increased delay
    this.connectionAttempts = 0;
    this.lastError = null;
    this.lastLoggedError = null; // Track last logged error to prevent spam
    this.loggedErrorCount = 0;
    
    // TTL configurations for different data types
    this.defaultTTL = 3600; // 1 hour
    this.amenitiesTTL = 3600; // 1 hour
    this.userTTL = 1800; // 30 minutes
    this.slotsTTL = 900; // 15 minutes
    
    // Environment flags
    this.isProduction = process.env.NODE_ENV === 'production';
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  async connect() {
    try {
      if (this.client && this.isConnected) {
        return this.client;
      }

      this.connectionAttempts++;
      
      // Only log first few connection attempts
      if (this.connectionAttempts <= 2 || this.isDevelopment) {
        logger.info(`Redis connection attempt #${this.connectionAttempts}`);
      }

      // Enhanced Redis configuration with better error handling
      const redisConfig = {
        socket: {
          connectTimeout: 20000, // Increased timeout
          lazyConnect: true,
          keepAlive: 30000,
          reconnectStrategy: (retries) => {
            if (retries > this.maxRetries) {
              // Only log once when giving up
              if (this.loggedErrorCount < 3) {
                logger.error(`Redis max retries (${this.maxRetries}) exceeded. Running without cache.`);
                this.loggedErrorCount++;
              }
              return false; // Stop retrying
            }
            const delay = Math.min(retries * this.retryDelay, 30000);
            // Only log in development or first few retries
            if (this.isDevelopment || retries <= 2) {
              logger.warn(`Redis retry attempt ${retries} in ${delay}ms`);
            }
            return delay;
          }
        },
        // Add connection name for debugging
        name: `amenity-api-${process.env.NODE_ENV || 'dev'}-${Date.now()}`
      };

      // Environment variable checking (minimal logging)
      if (this.connectionAttempts === 1) {
        if (this.isDevelopment) {
          logger.info('Redis configuration check:');
          logger.info(`- REDIS_URL: ${process.env.REDIS_URL ? 'Present' : 'Missing'}`);
          logger.info(`- REDIS_USE_AAD: ${process.env.REDIS_USE_AAD}`);
          logger.info(`- REDIS_AAD_ENABLED: ${process.env.REDIS_AAD_ENABLED}`);
        }
      }

      const useAAD = process.env.REDIS_USE_AAD === 'true' || process.env.REDIS_AAD_ENABLED === 'true';
      
      if (useAAD && process.env.REDIS_URL) {
        if (this.connectionAttempts === 1) {
          logger.info('Configuring Azure AAD authentication for Redis');
        }
        
        try {
          // Parse and validate Redis URL
          const redisUrl = new URL(process.env.REDIS_URL);
          if (this.isDevelopment && this.connectionAttempts === 1) {
            logger.info(`Redis host: ${redisUrl.hostname}`);
            logger.info(`Redis port: ${redisUrl.port || 6380}`);
          }
          
          redisConfig.socket.host = redisUrl.hostname;
          redisConfig.socket.port = parseInt(redisUrl.port) || 6380;
          redisConfig.socket.tls = true; // Azure Redis always uses TLS
          
          // Get AAD token
          if (this.connectionAttempts === 1) {
            logger.info('Requesting Azure AAD token...');
          }
          const credential = new DefaultAzureCredential();
          const tokenResponse = await credential.getToken('https://redis.azure.com/.default');
          
          if (!tokenResponse || !tokenResponse.token) {
            throw new Error('AAD token response is invalid');
          }
          
          // Use hostname as username (correct for Azure Redis AAD)
          redisConfig.username = redisUrl.hostname;
          redisConfig.password = tokenResponse.token;
          
          if (this.connectionAttempts === 1) {
            logger.info('Azure AAD token obtained successfully');
            if (this.isDevelopment) {
              logger.info(`Token expires at: ${new Date(tokenResponse.expiresOnTimestamp).toISOString()}`);
            }
          }
          
        } catch (aadError) {
          logger.error('Azure AAD authentication failed:', aadError.message);
          if (this.isDevelopment) {
            logger.info('Falling back to connection string authentication');
          }
          
          // Fallback to standard authentication
          try {
            const redisUrl = new URL(process.env.REDIS_URL);
            redisConfig.socket.host = redisUrl.hostname;
            redisConfig.socket.port = parseInt(redisUrl.port) || 6380;
            
            if (redisUrl.password) {
              redisConfig.password = redisUrl.password;
              if (this.isDevelopment) {
                logger.info('Using password from Redis URL');
              }
            }
            if (redisUrl.username) {
              redisConfig.username = redisUrl.username;
              if (this.isDevelopment) {
                logger.info(`Using username: ${redisUrl.username}`);
              }
            }
            
            // Use TLS if port is 6380 (Azure default)
            if (redisUrl.port === '6380' || process.env.REDIS_USE_TLS === 'true') {
              redisConfig.socket.tls = true;
              if (this.isDevelopment) {
                logger.info('TLS enabled');
              }
            }
            
          } catch (urlError) {
            logger.error('Invalid REDIS_URL format:', urlError.message);
            throw new Error(`Invalid REDIS_URL: ${urlError.message}`);
          }
        }
        
      } else if (process.env.REDIS_URL) {
        // Standard authentication from URL
        try {
          const redisUrl = new URL(process.env.REDIS_URL);
          if (this.isDevelopment && this.connectionAttempts === 1) {
            logger.info(`Redis host: ${redisUrl.hostname}`);
            logger.info(`Redis port: ${redisUrl.port || 6380}`);
          }
          
          redisConfig.socket.host = redisUrl.hostname;
          redisConfig.socket.port = parseInt(redisUrl.port) || 6380;
          
          if (redisUrl.password) {
            redisConfig.password = redisUrl.password;
            if (this.isDevelopment && this.connectionAttempts === 1) {
              logger.info('Using password from Redis URL');
            }
          }
          if (redisUrl.username) {
            redisConfig.username = redisUrl.username;
            if (this.isDevelopment && this.connectionAttempts === 1) {
              logger.info(`Using username: ${redisUrl.username}`);
            }
          }
          
          // Use TLS if port is 6380 (Azure default)
          if (redisUrl.port === '6380' || process.env.REDIS_USE_TLS === 'true') {
            redisConfig.socket.tls = true;
            if (this.isDevelopment && this.connectionAttempts === 1) {
              logger.info('TLS enabled');
            }
          }
          
        } catch (urlError) {
          logger.error('Invalid REDIS_URL format:', urlError.message);
          throw new Error(`Invalid REDIS_URL: ${urlError.message}`);
        }
        
      } else {
        if (this.connectionAttempts === 1) {
          logger.warn('No Redis configuration found, using defaults');
        }
        redisConfig.socket.host = process.env.REDIS_HOST || 'localhost';
        redisConfig.socket.port = parseInt(process.env.REDIS_PORT) || 6379;
      }

      // Log final configuration only in development and only once
      if (this.isDevelopment && this.connectionAttempts === 1) {
        logger.info('Final Redis configuration:', {
          host: redisConfig.socket.host,
          port: redisConfig.socket.port,
          tls: !!redisConfig.socket.tls,
          username: redisConfig.username ? '[SET]' : '[NOT SET]',
          password: redisConfig.password ? '[SET]' : '[NOT SET]',
          connectTimeout: redisConfig.socket.connectTimeout,
          name: redisConfig.name
        });
      }

      // Create Redis client
      if (this.connectionAttempts === 1) {
        logger.info('Creating Redis client...');
      }
      this.client = redis.createClient(redisConfig);

      // Enhanced event handlers with reduced logging
      this.client.on('connect', () => {
        if (this.isDevelopment || this.connectionAttempts <= 2) {
          logger.info('Redis client connecting to server...');
        }
      });

      this.client.on('ready', () => {
        logger.info('Redis client connected and ready!');
        this.isConnected = true;
        this.retryAttempts = 0;
        this.lastError = null;
        this.lastLoggedError = null;
        this.loggedErrorCount = 0; // Reset error count on successful connection
      });

      this.client.on('error', (error) => {
        // Enhanced error logging with spam prevention
        this.lastError = error;
        this.isConnected = false;
        this.retryAttempts++;
        
        // Only log unique errors or first few occurrences
        const errorKey = `${error.message || ''}-${error.code || ''}`.substring(0, 100);
        const shouldLog = !this.lastLoggedError || 
                         this.lastLoggedError !== errorKey || 
                         this.loggedErrorCount < 3;
        
        if (shouldLog) {
          // Minimal error logging with solutions
          if (error.message && error.message.includes('WRONGPASS')) {
            logger.error('Redis authentication failed - incorrect password/token');
            if (this.loggedErrorCount === 0) {
              logger.info('Solutions: 1) Check Azure Redis AAD config 2) Set REDIS_USE_AAD=false 3) Verify REDIS_URL');
            }
          } else if (error.message && (error.message.includes('ENOTFOUND') || error.code === 'ENOTFOUND')) {
            logger.error('Redis DNS resolution failed - host not found');
          } else if (error.message && (error.message.includes('ECONNREFUSED') || error.code === 'ECONNREFUSED')) {
            logger.error('Redis connection refused - server not accepting connections');
          } else if (error.message && (error.message.includes('ETIMEDOUT') || error.code === 'ETIMEDOUT')) {
            logger.error('Redis connection timeout - server not responding');
          } else {
            logger.error('Redis client error:', error.message || 'Unknown error');
          }
          
          this.lastLoggedError = errorKey;
          this.loggedErrorCount++;
        }
      });

      this.client.on('end', () => {
        if (this.isConnected) {
          logger.warn('Redis client connection ended');
        }
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        if (this.isDevelopment || this.retryAttempts <= 2) {
          logger.info('Redis client attempting to reconnect...');
        }
        
        // For AAD, try to get a fresh token on reconnect
        if (useAAD) {
          this.refreshAADToken().catch(error => {
            if (this.isDevelopment || this.loggedErrorCount < 3) {
              logger.error('Failed to refresh AAD token on reconnect:', error.message);
            }
          });
        }
      });

      // Attempt connection with timeout
      if (this.connectionAttempts === 1) {
        logger.info('Attempting Redis connection...');
      }
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout after 20 seconds')), 20000)
        )
      ]);

      if (this.connectionAttempts === 1) {
        logger.info('Redis connection successful!');
      }

      return this.client;

    } catch (error) {
      this.lastError = error;
      this.isConnected = false;
      
      // Only log connection failures for first few attempts
      if (this.connectionAttempts <= 3 || this.isDevelopment) {
        logger.error('Redis connection failed:', error.message);
      }
      
      if (this.connectionAttempts === 1) {
        logger.warn('Continuing without Redis cache - functionality will be limited');
      }
      
      // Clean up failed client
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (disconnectError) {
          // Silent cleanup
        }
        this.client = null;
      }
      
      return null;
    }
  }

  // Enhanced AAD token refresh with reduced logging
  async refreshAADToken() {
    try {
      if (this.isDevelopment) {
        logger.info('Refreshing Azure AAD token...');
      }
      const credential = new DefaultAzureCredential();
      const tokenResponse = await credential.getToken('https://redis.azure.com/.default');
      
      if (!tokenResponse || !tokenResponse.token) {
        throw new Error('Invalid token response received');
      }
      
      // Update the client's password with the new token
      if (this.client && this.client.options) {
        this.client.options.password = tokenResponse.token;
        // Also update username if needed
        if (process.env.REDIS_URL) {
          const redisUrl = new URL(process.env.REDIS_URL);
          this.client.options.username = redisUrl.hostname;
        }
      }
      
      if (this.isDevelopment) {
        logger.info('Azure AAD token refreshed successfully');
        logger.info(`New token expires at: ${new Date(tokenResponse.expiresOnTimestamp).toISOString()}`);
      }
      return tokenResponse.token;
    } catch (error) {
      logger.error('Failed to refresh Azure AAD token:', error.message);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        if (this.isConnected) {
          await this.client.disconnect();
          logger.info('Redis client disconnected gracefully');
        }
      }
    } catch (error) {
      logger.error('Redis disconnect error:', error.message);
    } finally {
      this.client = null;
      this.isConnected = false;
    }
  }

  // Basic cache operations with minimal logging
  async get(key) {
    if (!this.isConnected) {
      return null; // Silent fail
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      // Only log in development
      if (this.isDevelopment) {
        logger.error(`Cache GET error for key ${key}:`, error.message);
      }
      return null;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    if (!this.isConnected) {
      return false; // Silent fail
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.setEx(key, ttl, serialized);
      return true;
    } catch (error) {
      // Only log in development
      if (this.isDevelopment) {
        logger.error(`Cache SET error for key ${key}:`, error.message);
      }
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) {
      return false; // Silent fail
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      // Only log in development
      if (this.isDevelopment) {
        logger.error(`Cache DEL error for key ${key}:`, error.message);
      }
      return false;
    }
  }

  // Pattern deletion for cache invalidation
  async delPattern(pattern) {
    if (!this.isConnected) {
      return false; // Silent fail
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        if (this.isDevelopment) {
          logger.debug(`Deleted ${keys.length} keys matching pattern: ${pattern}`);
        }
      }
      return true;
    } catch (error) {
      if (this.isDevelopment) {
        logger.error(`Cache DEL pattern error for ${pattern}:`, error.message);
      }
      return false;
    }
  }

  // Specialized cache methods for different data types (PRESERVED)
  async setAmenityData(key, data, ttl = this.amenitiesTTL) {
    return this.set(`amenity:${key}`, data, ttl);
  }

  async getAmenityData(key) {
    return this.get(`amenity:${key}`);
  }

  async setUserData(key, data, ttl = this.userTTL) {
    return this.set(`user:${key}`, data, ttl);
  }

  async getUserData(key) {
    return this.get(`user:${key}`);
  }

  async setSlotsData(key, data, ttl = this.slotsTTL) {
    return this.set(`slots:${key}`, data, ttl);
  }

  async getSlotsData(key) {
    return this.get(`slots:${key}`);
  }

  // Key generation utility (PRESERVED)
  generateKey(...parts) {
    return parts.filter(p => p !== null && p !== undefined).join(':');
  }

  // Enhanced health check (PRESERVED but with reduced logging)
  async healthCheck() {
    const status = {
      connected: this.isConnected,
      connectionAttempts: this.connectionAttempts,
      lastError: this.lastError ? {
        message: this.lastError.message,
        code: this.lastError.code,
        time: new Date().toISOString()
      } : null,
      configuration: {
        host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'unknown',
        useAAD: process.env.REDIS_USE_AAD === 'true' || process.env.REDIS_AAD_ENABLED === 'true',
        hasRedisUrl: !!process.env.REDIS_URL
      },
      ttlConfig: {
        default: this.defaultTTL,
        amenities: this.amenitiesTTL,
        users: this.userTTL,
        slots: this.slotsTTL
      }
    };

    if (!this.isConnected) {
      return {
        status: 'disconnected',
        error: 'Not connected to Redis',
        details: status
      };
    }

    try {
      const start = Date.now();
      await this.client.ping();
      const responseTime = Date.now() - start;
      
      return {
        status: 'connected',
        responseTime: `${responseTime}ms`,
        authMethod: status.configuration.useAAD ? 'Azure AAD' : 'Standard',
        details: status
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        details: status
      };
    }
  }

  // Connection testing utility (PRESERVED)
  async testConnection() {
    try {
      if (!this.isConnected) {
        throw new Error('Not connected to Redis');
      }
      
      const testKey = `test:${Date.now()}`;
      const testValue = { test: true, timestamp: new Date().toISOString() };
      
      // Test set
      const setResult = await this.set(testKey, testValue, 60);
      if (!setResult) {
        throw new Error('Failed to set test value');
      }
      
      // Test get
      const getValue = await this.get(testKey);
      if (!getValue || getValue.test !== true) {
        throw new Error('Failed to get test value');
      }
      
      // Test delete
      const delResult = await this.del(testKey);
      if (!delResult) {
        throw new Error('Failed to delete test value');
      }
      
      return {
        success: true,
        message: 'All cache operations working correctly',
        operations: ['SET', 'GET', 'DEL']
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        error: error
      };
    }
  }
}

const cacheService = new CacheService();

// Initial connection attempt with minimal logging
cacheService.connect().catch(error => {
  // Only log once on startup failure
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('Initial Redis connection failed during startup:', error.message);
  }
});

module.exports = cacheService;