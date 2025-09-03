// services/cacheService.js - NEW FILE
const redis = require('redis');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.defaultTTL = 300; // 5 minutes
  }

  async initialize() {
    try {
      this.client = redis.createClient({
        url: process.env.REDIS_URL, // Azure Cache for Redis connection string
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
    } catch (error) {
      logger.error('❌ Redis connection failed:', error);
      this.isConnected = false;
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

  async set(key, value, ttlSeconds = this.defaultTTL) {
    if (!this.isConnected) return false;
    
    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.warn('Cache set error:', error);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.warn('Cache delete error:', error);
      return false;
    }
  }

  async delPattern(pattern) {
    if (!this.isConnected) return false;
    
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      logger.warn('Cache delete pattern error:', error);
      return false;
    }
  }

  generateKey(prefix, ...parts) {
    return `${prefix}:${parts.join(':')}`;
  }
}

module.exports = new CacheService();