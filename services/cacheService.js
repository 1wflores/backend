// Enhanced cacheService.js with comprehensive Azure AAD Redis authentication and diagnostics

const redis = require('redis');
const { DefaultAzureCredential } = require('@azure/identity');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.retryAttempts = 0;
    this.maxRetries = 3; // Reduced retries to avoid log spam
    this.retryDelay = 5000;
    this.connectionAttempts = 0;
    this.lastError = null;
    
    // TTL configurations for different data types
    this.defaultTTL = 3600; // 1 hour
    this.amenitiesTTL = 3600; // 1 hour
    this.userTTL = 1800; // 30 minutes
    this.slotsTTL = 900; // 15 minutes
  }

  async connect() {
    try {
      if (this.client && this.isConnected) {
        return this.client;
      }

      this.connectionAttempts++;
      logger.info(`🔄 Redis connection attempt #${this.connectionAttempts}`);

      // Enhanced Redis configuration with better error handling
      const redisConfig = {
        socket: {
          connectTimeout: 15000, // Increased timeout
          lazyConnect: true,
          keepAlive: 30000,
          reconnectStrategy: (retries) => {
            if (retries > this.maxRetries) {
              logger.error(`❌ Redis max retries (${this.maxRetries}) exceeded. Giving up.`);
              return false; // Stop retrying
            }
            const delay = Math.min(retries * this.retryDelay, 30000);
            logger.warn(`⚠️ Redis retry attempt ${retries} in ${delay}ms`);
            return delay;
          }
        },
        // Add connection name for debugging
        name: `amenity-api-${process.env.NODE_ENV || 'dev'}-${Date.now()}`
      };

      // Enhanced environment variable checking and logging
      logger.info('🔧 Redis configuration check:');
      logger.info(`- REDIS_URL: ${process.env.REDIS_URL ? 'Present' : 'Missing'}`);
      logger.info(`- REDIS_USE_AAD: ${process.env.REDIS_USE_AAD}`);
      logger.info(`- REDIS_AAD_ENABLED: ${process.env.REDIS_AAD_ENABLED}`);

      const useAAD = process.env.REDIS_USE_AAD === 'true' || process.env.REDIS_AAD_ENABLED === 'true';
      
      if (useAAD && process.env.REDIS_URL) {
        logger.info('🔐 Configuring Azure AAD authentication for Redis');
        
        try {
          // Parse and validate Redis URL
          const redisUrl = new URL(process.env.REDIS_URL);
          logger.info(`🔍 Redis host: ${redisUrl.hostname}`);
          logger.info(`🔍 Redis port: ${redisUrl.port || 6380}`);
          
          redisConfig.socket.host = redisUrl.hostname;
          redisConfig.socket.port = parseInt(redisUrl.port) || 6380;
          redisConfig.socket.tls = true; // Azure Redis always uses TLS
          
          // Get AAD token
          logger.info('🎫 Requesting Azure AAD token...');
          const credential = new DefaultAzureCredential();
          const tokenResponse = await credential.getToken('https://redis.azure.com/.default');
          
          if (!tokenResponse || !tokenResponse.token) {
            throw new Error('AAD token response is invalid');
          }
          
          // ✅ FIXED: Use hostname as username (correct for Azure Redis AAD)
          redisConfig.username = redisUrl.hostname;
          redisConfig.password = tokenResponse.token;
          
          logger.info('✅ Azure AAD token obtained successfully');
          logger.info(`🕒 Token expires at: ${new Date(tokenResponse.expiresOnTimestamp).toISOString()}`);
          logger.info(`🔑 Using hostname (${redisUrl.hostname}) as username for AAD auth`);
          
        } catch (tokenError) {
          logger.error('❌ Azure AAD token error:', {
            message: tokenError.message,
            code: tokenError.code,
            name: tokenError.name
          });
          
          // ✅ FALLBACK: Try using the connection string instead of AAD
          logger.warn('⚠️ AAD failed, falling back to connection string authentication');
          
          try {
            const redisUrl = new URL(process.env.REDIS_URL);
            redisConfig.socket.host = redisUrl.hostname;
            redisConfig.socket.port = parseInt(redisUrl.port) || 6380;
            redisConfig.socket.tls = true;
            
            if (redisUrl.password) {
              redisConfig.password = redisUrl.password;
              logger.info('🔑 Using password from Redis URL as fallback');
            }
            if (redisUrl.username) {
              redisConfig.username = redisUrl.username;
              logger.info(`👤 Using username from URL: ${redisUrl.username}`);
            }
          } catch (fallbackError) {
            throw new Error(`Both AAD and connection string authentication failed: ${fallbackError.message}`);
          }
        }
        
      } else if (process.env.REDIS_URL) {
        // Standard connection string authentication
        logger.info('🔐 Using standard Redis URL connection');
        
        try {
          const redisUrl = new URL(process.env.REDIS_URL);
          logger.info(`🔍 Redis host: ${redisUrl.hostname}`);
          logger.info(`🔍 Redis port: ${redisUrl.port || 6380}`);
          
          redisConfig.socket.host = redisUrl.hostname;
          redisConfig.socket.port = parseInt(redisUrl.port) || 6380;
          
          if (redisUrl.password) {
            redisConfig.password = redisUrl.password;
            logger.info('🔑 Using password from Redis URL');
          }
          if (redisUrl.username) {
            redisConfig.username = redisUrl.username;
            logger.info(`👤 Using username: ${redisUrl.username}`);
          }
          
          // Use TLS if port is 6380 (Azure default)
          if (redisUrl.port === '6380' || process.env.REDIS_USE_TLS === 'true') {
            redisConfig.socket.tls = true;
            logger.info('🔒 TLS enabled');
          }
          
        } catch (urlError) {
          logger.error('❌ Invalid REDIS_URL format:', urlError.message);
          throw new Error(`Invalid REDIS_URL: ${urlError.message}`);
        }
        
      } else {
        logger.warn('⚠️ No Redis configuration found, using defaults');
        redisConfig.socket.host = process.env.REDIS_HOST || 'localhost';
        redisConfig.socket.port = parseInt(process.env.REDIS_PORT) || 6379;
      }

      // Log final configuration (without sensitive data)
      logger.info('🎯 Final Redis configuration:', {
        host: redisConfig.socket.host,
        port: redisConfig.socket.port,
        tls: !!redisConfig.socket.tls,
        username: redisConfig.username ? '[SET]' : '[NOT SET]',
        password: redisConfig.password ? '[SET]' : '[NOT SET]',
        connectTimeout: redisConfig.socket.connectTimeout,
        name: redisConfig.name
      });

      // Create Redis client
      logger.info('⚡ Creating Redis client...');
      this.client = redis.createClient(redisConfig);

      // Enhanced event handlers with detailed logging
      this.client.on('connect', () => {
        logger.info('🔗 Redis client connecting to server...');
      });

      this.client.on('ready', () => {
        logger.info('✅ Redis client connected and ready!');
        this.isConnected = true;
        this.retryAttempts = 0;
        this.lastError = null;
      });

      this.client.on('error', (error) => {
        // Enhanced error logging with full error details
        this.lastError = error;
        this.isConnected = false;
        this.retryAttempts++;
        
        logger.error('❌ Redis client error - FULL DETAILS:', {
          message: error.message || 'No message',
          code: error.code || 'No code',
          errno: error.errno || 'No errno',
          syscall: error.syscall || 'No syscall',
          hostname: error.hostname || 'No hostname',
          address: error.address || 'No address',
          port: error.port || 'No port',
          name: error.name || 'No name',
          stack: error.stack || 'No stack',
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });
        
        // Specific error handling with solutions
        if (error.message.includes('WRONGPASS')) {
          logger.error('🔑 Authentication failed - incorrect password/token');
          logger.info('💡 SOLUTION SUGGESTIONS:');
          logger.info('   1. Check if your Azure Redis Cache has AAD authentication enabled');
          logger.info('   2. Try disabling AAD by setting REDIS_USE_AAD=false');
          logger.info('   3. Verify your REDIS_URL connection string is correct');
          logger.info('   4. Check if you need to add your App Service to Redis access policies');
        } else if (error.message.includes('ENOTFOUND') || error.code === 'ENOTFOUND') {
          logger.error('🌐 DNS resolution failed - Redis host not found');
          logger.info('💡 Check your REDIS_URL hostname is correct');
        } else if (error.message.includes('ECONNREFUSED') || error.code === 'ECONNREFUSED') {
          logger.error('🚫 Connection refused - Redis server not accepting connections');
          logger.info('💡 Check firewall rules and Redis instance status');
        } else if (error.message.includes('ETIMEDOUT') || error.code === 'ETIMEDOUT') {
          logger.error('⏱️ Connection timeout - Redis server not responding');
          logger.info('💡 Check network connectivity and Redis instance health');
        }
      });

      this.client.on('end', () => {
        logger.warn('⚠️ Redis client connection ended');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('🔄 Redis client attempting to reconnect...');
        
        // For AAD, try to get a fresh token on reconnect
        if (useAAD) {
          this.refreshAADToken().catch(error => {
            logger.error('❌ Failed to refresh AAD token on reconnect:', error.message);
          });
        }
      });

      // Attempt connection with timeout
      logger.info('🚀 Attempting Redis connection...');
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout after 20 seconds')), 20000)
        )
      ]);

      logger.info('🎉 Redis connection successful!');
      return this.client;

    } catch (error) {
      this.lastError = error;
      this.isConnected = false;
      
      logger.error('💥 Redis connection completely failed:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
        connectionAttempts: this.connectionAttempts
      });
      
      // Don't throw error, allow app to continue without cache
      logger.warn('⚠️ Continuing without Redis cache - functionality will be limited');
      
      // Clean up failed client
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (disconnectError) {
          logger.warn('⚠️ Error cleaning up failed Redis client:', disconnectError.message);
        }
        this.client = null;
      }
      
      return null;
    }
  }

  // Enhanced AAD token refresh with better error handling
  async refreshAADToken() {
    try {
      logger.info('🔄 Refreshing Azure AAD token...');
      const credential = new DefaultAzureCredential();
      const tokenResponse = await credential.getToken('https://redis.azure.com/.default');
      
      if (!tokenResponse || !tokenResponse.token) {
        throw new Error('Invalid token response received');
      }
      
      // Update the client's password with the new token
      if (this.client && this.client.options) {
        this.client.options.password = tokenResponse.token;
        // Also update username if needed (keep it as hostname for Azure Redis AAD)
        if (process.env.REDIS_URL) {
          const redisUrl = new URL(process.env.REDIS_URL);
          this.client.options.username = redisUrl.hostname;
        }
      }
      
      logger.info('✅ Azure AAD token refreshed successfully');
      logger.info(`🕒 New token expires at: ${new Date(tokenResponse.expiresOnTimestamp).toISOString()}`);
      return tokenResponse.token;
    } catch (error) {
      logger.error('❌ Failed to refresh Azure AAD token:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        if (this.isConnected) {
          await this.client.disconnect();
          logger.info('✅ Redis client disconnected gracefully');
        } else {
          logger.info('ℹ️ Redis client was not connected, cleaning up...');
        }
      }
    } catch (error) {
      logger.error('❌ Redis disconnect error:', error.message);
    } finally {
      this.client = null;
      this.isConnected = false;
    }
  }

  // Basic cache operations
  async get(key) {
    if (!this.isConnected) {
      logger.debug(`Cache GET skipped (not connected): ${key}`);
      return null;
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error.message);
      return null;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    if (!this.isConnected) {
      logger.debug(`Cache SET skipped (not connected): ${key}`);
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.setEx(key, ttl, serialized);
      return true;
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error.message);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) {
      logger.debug(`Cache DEL skipped (not connected): ${key}`);
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Cache DEL error for key ${key}:`, error.message);
      return false;
    }
  }

  // Pattern deletion for cache invalidation
  async delPattern(pattern) {
    if (!this.isConnected) {
      logger.debug(`Cache DEL pattern skipped (not connected): ${pattern}`);
      return false;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        logger.debug(`Deleted ${keys.length} keys matching pattern: ${pattern}`);
      }
      return true;
    } catch (error) {
      logger.error(`Cache DEL pattern error for ${pattern}:`, error.message);
      return false;
    }
  }

  // Specialized cache methods for different data types
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

  // Key generation utility
  generateKey(...parts) {
    return parts.filter(p => p !== null && p !== undefined).join(':');
  }

  // Enhanced health check with detailed information
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

  // Utility method for testing
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

// Initial connection attempt with detailed logging
cacheService.connect().catch(error => {
  logger.warn('⚠️ Initial Redis connection failed during startup:', error.message);
});

module.exports = cacheService;