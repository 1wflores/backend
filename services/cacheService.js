// Updated cacheService.js for Azure AAD Redis authentication

const redis = require('redis');
const { DefaultAzureCredential } = require('@azure/identity');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000;
  }

  async connect() {
    try {
      if (this.client && this.isConnected) {
        return this.client;
      }

      logger.info('🔄 Redis client connecting...');

      // ✅ FIXED: Azure AAD Redis configuration
      const redisConfig = {
        socket: {
          connectTimeout: 10000,
          lazyConnect: true,
          reconnectStrategy: (retries) => {
            if (retries > this.maxRetries) {
              logger.error(`❌ Redis max retries (${this.maxRetries}) exceeded`);
              return false;
            }
            const delay = Math.min(retries * this.retryDelay, 30000);
            logger.warn(`⚠️ Redis retry attempt ${retries} in ${delay}ms`);
            return delay;
          }
        }
      };

      // ✅ Check if using Azure AAD authentication
      const useAAD = process.env.REDIS_USE_AAD === 'true' || process.env.REDIS_AAD_ENABLED === 'true';
      
      if (useAAD && process.env.REDIS_URL) {
        logger.info('🔐 Using Azure AAD authentication for Redis');
        
        // Parse Redis URL for AAD authentication
        const redisUrl = new URL(process.env.REDIS_URL);
        redisConfig.socket.host = redisUrl.hostname;
        redisConfig.socket.port = parseInt(redisUrl.port) || 6380;
        redisConfig.socket.tls = true; // Azure Redis always uses TLS
        
        // ✅ IMPORTANT: For Azure AAD, we need to get an access token
        try {
          const credential = new DefaultAzureCredential();
          const tokenResponse = await credential.getToken('https://redis.azure.com/.default');
          
          // Use the access token as password with a special username
          redisConfig.username = 'redisuser'; // Special username for AAD
          redisConfig.password = tokenResponse.token;
          
          logger.info('✅ Successfully obtained Azure AAD token for Redis');
        } catch (tokenError) {
          logger.error('❌ Failed to get Azure AAD token:', tokenError.message);
          throw new Error('Azure AAD authentication failed');
        }
        
      } else if (process.env.REDIS_URL) {
        logger.info('🔐 Using Redis URL connection');
        
        // Parse Redis URL for standard authentication
        const redisUrl = new URL(process.env.REDIS_URL);
        redisConfig.socket.host = redisUrl.hostname;
        redisConfig.socket.port = parseInt(redisUrl.port) || 6379;
        
        if (redisUrl.password) {
          redisConfig.password = redisUrl.password;
        }
        if (redisUrl.username) {
          redisConfig.username = redisUrl.username;
        }
        
        // Use TLS if port is 6380 (Azure default) or explicitly configured
        if (redisUrl.port === '6380' || process.env.REDIS_USE_TLS === 'true') {
          redisConfig.socket.tls = true;
        }
        
      } else {
        // Fallback to individual environment variables
        redisConfig.socket.host = process.env.REDIS_HOST || 'localhost';
        redisConfig.socket.port = parseInt(process.env.REDIS_PORT) || 6379;
        
        if (process.env.REDIS_PASSWORD) {
          redisConfig.password = process.env.REDIS_PASSWORD;
        }
        if (process.env.REDIS_USERNAME) {
          redisConfig.username = process.env.REDIS_USERNAME;
        }
        if (process.env.REDIS_USE_TLS === 'true') {
          redisConfig.socket.tls = true;
        }
      }

      this.client = redis.createClient(redisConfig);

      // Set up event handlers
      this.client.on('connect', () => {
        logger.info('🔄 Redis client connecting...');
      });

      this.client.on('ready', () => {
        logger.info('✅ Redis client connected and ready');
        this.isConnected = true;
        this.retryAttempts = 0;
      });

      this.client.on('error', (error) => {
        logger.error('❌ Redis client error:', error.message);
        this.isConnected = false;
        this.retryAttempts++;
        
        // ✅ Special handling for AAD token expiration
        if (error.message.includes('WRONGPASS') && useAAD) {
          logger.warn('⚠️ AAD token may have expired, will retry with new token');
        }
      });

      this.client.on('end', () => {
        logger.warn('⚠️ Redis client connection ended');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('🔄 Redis client reconnecting...');
        
        // ✅ For AAD, get a fresh token on reconnect
        if (useAAD) {
          this.refreshAADToken().catch(error => {
            logger.error('❌ Failed to refresh AAD token on reconnect:', error);
          });
        }
      });

      // Connect to Redis
      await this.client.connect();

      return this.client;

    } catch (error) {
      logger.error('❌ Redis connection failed:', error.message);
      this.isConnected = false;
      
      // ✅ IMPORTANT: Don't throw error, allow app to continue without cache
      logger.warn('⚠️ Continuing without Redis cache');
      return null;
    }
  }

  // ✅ NEW: Method to refresh AAD token
  async refreshAADToken() {
    try {
      const credential = new DefaultAzureCredential();
      const tokenResponse = await credential.getToken('https://redis.azure.com/.default');
      
      // Update the client's password with the new token
      if (this.client && this.client.options) {
        this.client.options.password = tokenResponse.token;
      }
      
      logger.info('✅ Azure AAD token refreshed successfully');
      return tokenResponse.token;
    } catch (error) {
      logger.error('❌ Failed to refresh Azure AAD token:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.disconnect();
        logger.info('✅ Redis client disconnected');
      }
    } catch (error) {
      logger.error('❌ Redis disconnect error:', error);
    } finally {
      this.client = null;
      this.isConnected = false;
    }
  }

  // ✅ Safe cache operations with fallback (unchanged)
  async get(key) {
    if (!this.isConnected) {
      logger.warn(`Cache GET skipped (not connected): ${key}`);
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error);
      
      // ✅ Retry with fresh token if AAD auth error
      if (error.message.includes('WRONGPASS') && (process.env.REDIS_USE_AAD === 'true' || process.env.REDIS_AAD_ENABLED === 'true')) {
        logger.info('🔄 Retrying cache operation with fresh AAD token...');
        try {
          await this.refreshAADToken();
          await this.client.connect();
          const value = await this.client.get(key);
          if (value) {
            return JSON.parse(value);
          }
        } catch (retryError) {
          logger.error(`Cache GET retry failed for key ${key}:`, retryError);
        }
      }
      
      return null;
    }
  }

  async set(key, value, ttl = 3600) {
    if (!this.isConnected) {
      logger.warn(`Cache SET skipped (not connected): ${key}`);
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.setEx(key, ttl, serialized);
      return true;
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error);
      
      // ✅ Retry with fresh token if AAD auth error
      if (error.message.includes('WRONGPASS') && (process.env.REDIS_USE_AAD === 'true' || process.env.REDIS_AAD_ENABLED === 'true')) {
        logger.info('🔄 Retrying cache operation with fresh AAD token...');
        try {
          await this.refreshAADToken();
          await this.client.connect();
          const serialized = JSON.stringify(value);
          await this.client.setEx(key, ttl, serialized);
          return true;
        } catch (retryError) {
          logger.error(`Cache SET retry failed for key ${key}:`, retryError);
        }
      }
      
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) {
      logger.warn(`Cache DEL skipped (not connected): ${key}`);
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Cache DEL error for key ${key}:`, error);
      return false;
    }
  }

  generateKey(...parts) {
    return parts.filter(p => p !== null && p !== undefined).join(':');
  }

  async healthCheck() {
    if (!this.isConnected) {
      return {
        status: 'disconnected',
        error: 'Not connected to Redis'
      };
    }

    try {
      const start = Date.now();
      await this.client.ping();
      const responseTime = Date.now() - start;
      
      return {
        status: 'connected',
        responseTime: `${responseTime}ms`,
        authMethod: (process.env.REDIS_USE_AAD === 'true' || process.env.REDIS_AAD_ENABLED === 'true') ? 'Azure AAD' : 'Standard'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }
}

const cacheService = new CacheService();

// Connect on startup but don't fail if it doesn't work
cacheService.connect().catch(error => {
  logger.warn('⚠️ Initial Redis connection failed, continuing without cache:', error.message);
});

module.exports = cacheService;