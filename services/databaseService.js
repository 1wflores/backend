const { CosmosClient } = require('@azure/cosmos');
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.client = null;
    this.database = null;
    this.containers = {};
    this.connectionPool = new Map();
    this.queryCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async initialize() {
    try {
      // Initialize Cosmos DB client with connection pooling
      this.client = new CosmosClient({
        endpoint: process.env.COSMOS_ENDPOINT,
        key: process.env.COSMOS_KEY,
        userAgentSuffix: 'AmenityReservationAPI',
        connectionPolicy: {
          requestTimeout: 30000,
          enableEndpointDiscovery: true,
          preferredLocations: [process.env.COSMOS_REGION || 'Central US'],
          retryOptions: {
            maxRetryAttemptCount: 3,
            fixedRetryIntervalInMilliseconds: 1000,
            maxWaitTimeInSeconds: 60
          }
        }
      });

      const databaseId = process.env.COSMOS_DATABASE_ID || 'AmenityReservationDB';
      this.database = this.client.database(databaseId);

      await this.initializeContainers();
      await this.createIndexes();

      logger.info('Database service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  async initializeContainers() {
    const containerConfigs = [
      {
        id: 'Users',
        partitionKey: '/id',
        uniqueKeyPolicy: {
          uniqueKeys: [{ paths: ['/username'] }]
        }
      },
      {
        id: 'Amenities',
        partitionKey: '/id'
      },
      {
        id: 'Reservations',
        partitionKey: '/id',
        indexingPolicy: {
          includedPaths: [
            { path: '/*' },
            { path: '/userId/*' },
            { path: '/amenityId/*' },
            { path: '/startTime/*' },
            { path: '/status/*' }
          ]
        }
      }
    ];

    for (const config of containerConfigs) {
      try {
        const { container } = await this.database.containers.createIfNotExists(config);
        this.containers[config.id] = container;
        logger.info(`Container ${config.id} initialized`);
      } catch (error) {
        logger.error(`Failed to initialize container ${config.id}:`, error);
        throw error;
      }
    }
  }

  async createIndexes() {
    // Create composite indexes for better query performance
    const indexingPolicies = {
      Users: {
        compositeIndexes: [
          [{ path: '/username', order: 'ascending' }],
          [{ path: '/role', order: 'ascending' }, { path: '/isActive', order: 'ascending' }]
        ]
      },
      Reservations: {
        compositeIndexes: [
          [{ path: '/userId', order: 'ascending' }, { path: '/startTime', order: 'descending' }],
          [{ path: '/amenityId', order: 'ascending' }, { path: '/startTime', order: 'ascending' }],
          [{ path: '/status', order: 'ascending' }, { path: '/createdAt', order: 'descending' }]
        ]
      }
    };

    // Apply indexing policies
    for (const [containerName, policy] of Object.entries(indexingPolicies)) {
      try {
        const container = this.containers[containerName];
        if (container) {
          logger.info(`Creating indexes for ${containerName}`);
        }
      } catch (error) {
        logger.warn(`Could not create indexes for ${containerName}:`, error.message);
      }
    }
  }

  // ✅ FIXED: Added missing getAllItems method
  async getAllItems(containerName) {
    try {
      const cacheKey = `${containerName}:all`;
      
      // Check cache first
      if (this.queryCache.has(cacheKey)) {
        const cached = this.queryCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          logger.debug(`Cache hit for ${cacheKey}`);
          return cached.data;
        }
      }

      const container = this.getContainer(containerName);
      const { resources } = await container.items.readAll().fetchAll();
      
      // Update cache
      this.queryCache.set(cacheKey, {
        data: resources,
        timestamp: Date.now()
      });

      return resources;
    } catch (error) {
      logger.error(`Error getting all items from ${containerName}:`, error);
      throw error;
    }
  }

  async queryItems(containerName, query, parameters = []) {
    try {
      const cacheKey = `${containerName}:${query}:${JSON.stringify(parameters)}`;
      
      // Check cache
      if (this.queryCache.has(cacheKey)) {
        const cached = this.queryCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          logger.debug(`Cache hit for query`);
          return cached.data;
        }
      }

      const container = this.getContainer(containerName);
      const querySpec = {
        query,
        parameters
      };

      const { resources } = await container.items.query(querySpec).fetchAll();
      
      // Update cache
      this.queryCache.set(cacheKey, {
        data: resources,
        timestamp: Date.now()
      });

      return resources;
    } catch (error) {
      logger.error(`Query error in ${containerName}:`, error);
      throw error;
    }
  }

  invalidateCache(containerName = null) {
    if (containerName) {
      // Invalidate specific container cache
      for (const [key] of this.queryCache) {
        if (key.startsWith(`${containerName}:`)) {
          this.queryCache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.queryCache.clear();
    }
  }

  async createItem(containerName, item) {
    try {
      const container = this.getContainer(containerName);
      const { resource } = await container.items.create(item);
      
      // Invalidate cache for this container
      this.invalidateCache(containerName);
      
      return resource;
    } catch (error) {
      logger.error(`Error creating item in ${containerName}:`, error);
      throw error;
    }
  }

  async updateItem(containerName, item) {
    try {
      const container = this.getContainer(containerName);
      const { resource } = await container.item(item.id, item.id).replace(item);
      
      // Invalidate cache
      this.invalidateCache(containerName);
      
      return resource;
    } catch (error) {
      logger.error(`Error updating item in ${containerName}:`, error);
      throw error;
    }
  }

  async deleteItem(containerName, id, partitionKey) {
    try {
      const container = this.getContainer(containerName);
      await container.item(id, partitionKey || id).delete();
      
      // Invalidate cache
      this.invalidateCache(containerName);
      
      return true;
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
      logger.error(`Error deleting item from ${containerName}:`, error);
      throw error;
    }
  }

  async testConnection() {
    try {
      if (!this.client) {
        await this.initialize();
      }
      
      await this.database.read();
      logger.info('Database connection test successful');
      return true;
    } catch (error) {
      logger.error('Database connection test failed:', error);
      return false;
    }
  }

  getContainer(containerName) {
    if (!this.containers[containerName]) {
      throw new Error(`Container ${containerName} not initialized`);
    }
    return this.containers[containerName];
  }

  async getItem(containerName, id, partitionKey) {
    try {
      const container = this.getContainer(containerName);
      const { resource } = await container.item(id, partitionKey || id).read();
      return resource;
    } catch (error) {
      if (error.code === 404) {
        return null;
      }
      logger.error(`Error getting item from ${containerName}:`, error);
      throw error;
    }
  }

  // Cleanup method for graceful shutdown
  async cleanup() {
    try {
      this.queryCache.clear();
      this.connectionPool.clear();
      logger.info('Database service cleaned up');
    } catch (error) {
      logger.error('Error during database cleanup:', error);
    }
  }
}

module.exports = new DatabaseService();