const redis = require('redis');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    // Get TTL values from app settings
    this.defaultTTL = parseInt(process.env.CACHE_DEFAULT_TTL) || 300; // 5 minutes
    this.amenitiesTTL = parseInt(process.env.CACHE_AMENITIES_TTL) || 3600; // 1 hour
    this.userTTL = parseInt(process.env.CACHE_USER_TTL) || 1800; // 30 minutes
    this.slotsTTL = parseInt(process.env.CACHE_SLOTS_TTL) || 600; // 10 minutes
  }

  async initialize() {
    try {
      // Get Redis URL from multiple possible environment variables
      const redisUrl = process.env.CUSTOMCONNSTR_REDIS_URL || 
                      process.env.REDIS_URL || 
                      process.env.REDISCLOUD_URL ||
                      process.env.REDIS_CONNECTION_STRING;
      
      if (!redisUrl) {
        logger.warn('⚠️ No Redis URL configured. Caching will be disabled.');
        this.isConnected = false;
        return;
      }

      logger.info('🔄 Connecting to Redis...');
      logger.info(`🔗 Redis URL pattern: ${redisUrl.replace(/:[^:@]*@/, ':***@')}`); // Mask password in logs

      // Parse Redis URL to get connection details
      const url = new URL(redisUrl);
      
      const clientOptions = {
        socket: {
          host: url.hostname,
          port: parseInt(url.port) || 6379,
          tls: url.protocol === 'rediss:' // Enable TLS for rediss:// protocol
        },
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis server connection refused');
            return new Error('Redis server connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Redis retry time exhausted');
            return new Error('Redis retry time exhausted');
          }
          if (options.attempt > 10) {
            logger.error('Max Redis retry attempts reached');
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      };

      // Handle authentication
      if (url.password) {
        if (url.username && url.username !== 'default') {
          // Username + Password authentication
          clientOptions.username = url.username;
          clientOptions.password = url.password;
          logger.info('🔐 Using username+password authentication');
        } else {
          // Password-only authentication (most common)
          clientOptions.password = url.password;
          logger.info('🔐 Using password-only authentication');
        }
      } else {
        logger.info('🔓 No authentication configured');
      }

      // Create Redis client
      this.client = redis.createClient(clientOptions);

      // Set up error handlers
      this.client.on('error', (error) => {
        logger.error('Redis client error:', error);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('🔄 Redis client connecting...');
      });

      this.client.on('ready', () => {
        logger.info('✅ Redis client ready');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        logger.warn('⚠️ Redis connection ended');
        this.isConnected = false;
      });

      // Connect to Redis
      await this.client.connect();
      
      // Test the connection
      await this.client.ping();
      
      this.isConnected = true;
      logger.info('✅ Redis cache connected successfully');
      
      // Log configuration
      logger.info(`📊 Cache TTL Config:
        - Default: ${this.defaultTTL}s
        - Amenities: ${this.amenitiesTTL}s  
        - Users: ${this.userTTL}s
        - Slots: ${this.slotsTTL}s`);
        
    } catch (error) {
      logger.error('❌ Redis connection failed:', error.message);
      logger.error('Full error:', error);
      this.isConnected = false;
      
      // Provide specific troubleshooting hints
      if (error.message.includes('WRONGPASS')) {
        logger.error('💡 Redis authentication failed. Check your password in the Redis URL.');
      } else if (error.message.includes('ECONNREFUSED')) {
        logger.error('💡 Redis server is not reachable. Check your hostname and port.');
      } else if (error.message.includes('ETIMEDOUT')) {
        logger.error('💡 Redis connection timed out. Check your network connectivity.');
      }
    }
  }

  // Enhanced cache methods with TTL support
  async set(key, value, customTTL = null) {
    if (!this.isConnected) {
      logger.warn(`Cache SET skipped (not connected): ${key}`);
      return false;
    }
    
    try {
      const ttl = customTTL || this.defaultTTL;
      await this.client.setEx(key, ttl, JSON.stringify(value));
      logger.debug(`Cache SET: ${key} (TTL: ${ttl}s)`);
      return true;
    } catch (error) {
      logger.warn('Cache set error:', error);
      return false;
    }
  }

  async get(key) {
    if (!this.isConnected) {
      logger.warn(`Cache GET skipped (not connected): ${key}`);
      return null;
    }
    
    try {
      const result = await this.client.get(key);
      if (result) {
        logger.debug(`Cache HIT: ${key}`);
        return JSON.parse(result);
      } else {
        logger.debug(`Cache MISS: ${key}`);
        return null;
      }
    } catch (error) {
      logger.warn('Cache get error:', error);
      return null;
    }
  }

  async delete(key) {
    if (!this.isConnected) return false;
    
    try {
      await this.client.del(key);
      logger.debug(`Cache DELETE: ${key}`);
      return true;
    } catch (error) {
      logger.warn('Cache delete error:', error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.warn('Cache exists error:', error);
      return false;
    }
  }

  // Specialized cache methods using your TTL values
  async setAmenityData(key, data) {
    return this.set(key, data, this.amenitiesTTL);
  }

  async setUserData(key, data) {
    return this.set(key, data, this.userTTL);
  }

  async setSlotsData(key, data) {
    return this.set(key, data, this.slotsTTL);
  }

  generateKey(prefix, ...parts) {
    return `${prefix}:${parts.join(':')}`;
  }

  // Get connection info for debugging
  getConnectionInfo() {
    return {
      connected: this.isConnected,
      client_ready: !!this.client,
      ttl_config: {
        default: this.defaultTTL,
        amenities: this.amenitiesTTL,
        users: this.userTTL,
        slots: this.slotsTTL
      }
    };
  }
}

module.exports = new CacheService();