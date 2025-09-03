const redis = require('redis');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    // Get TTL values from app settings (these stay in app settings)
    this.defaultTTL = parseInt(process.env.CACHE_DEFAULT_TTL) || 300; // 5 minutes
    this.amenitiesTTL = parseInt(process.env.CACHE_AMENITIES_TTL) || 3600; // 1 hour
    this.userTTL = parseInt(process.env.CACHE_USER_TTL) || 1800; // 30 minutes
    this.slotsTTL = parseInt(process.env.CACHE_SLOTS_TTL) || 600; // 10 minutes
  }

  async initialize() {
    try {
      // Get Redis URL from connection strings
      // In Azure, connection strings are available as CUSTOMCONNSTR_<name>
      const redisUrl = process.env.CUSTOMCONNSTR_REDIS_URL || process.env.REDIS_URL;
      
      if (!redisUrl) {
        logger.warn('⚠️ No Redis URL configured');
        this.isConnected = false;
        return;
      }

      logger.info('🔄 Connecting to Redis...');

      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          tls: true,  // Required for rediss:// protocol
          rejectUnauthorized: false
        },
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('Redis server connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Redis retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      await this.client.connect();
      this.isConnected = true;
      logger.info('✅ Redis cache connected successfully');
      
      // Log configuration
      logger.info(`📊 Cache TTL Config:
        - Default: ${this.defaultTTL}s
        - Amenities: ${this.amenitiesTTL}s  
        - Users: ${this.userTTL}s
        - Slots: ${this.slotsTTL}s`);
        
    } catch (error) {
      logger.error('❌ Redis connection failed:', error);
      this.isConnected = false;
    }
  }

  // Enhanced cache methods with TTL support
  async set(key, value, customTTL = null) {
    if (!this.isConnected) return false;
    
    try {
      const ttl = customTTL || this.defaultTTL;
      await this.client.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.warn('Cache set error:', error);
      return false;
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    
    try {
      const result = await this.client.get(key);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      logger.warn('Cache get error:', error);
      return null;
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

    async delete(key) {
      if (!this.isConnected) return false;
      
      try {
        await this.client.del(key);
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

    async clear() {
      if (!this.isConnected) return false;
      
      try {
        await this.client.flushAll();
        return true;
      } catch (error) {
        logger.warn('Cache clear error:', error);
        return false;
      }
    }

    async getTTL(key) {
      if (!this.isConnected) return -1;
      
      try {
        return await this.client.ttl(key);
      } catch (error) {
        logger.warn('Cache TTL error:', error);
        return -1;
      }
    }

    // Helper method to get cache statistics
    async getStats() {
      if (!this.isConnected) return null;
      
      try {
        const info = await this.client.info();
        return {
          connected: this.isConnected,
          used_memory: info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'unknown',
          connected_clients: info.match(/connected_clients:(\d+)/)?.[1] || 'unknown',
          total_connections_received: info.match(/total_connections_received:(\d+)/)?.[1] || 'unknown',
          keyspace_hits: info.match(/keyspace_hits:(\d+)/)?.[1] || '0',
          keyspace_misses: info.match(/keyspace_misses:(\d+)/)?.[1] || '0'
        };
      } catch (error) {
        logger.warn('Cache stats error:', error);
        return null;
      }
    }
}


module.exports = new CacheService();