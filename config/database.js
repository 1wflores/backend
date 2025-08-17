const { CosmosClient } = require('@azure/cosmos');
const logger = require('../utils/logger');

class DatabaseConfig {
  constructor() {
    this.client = null;
    this.database = null;
    this.containers = {};
    this.isInitialized = false;
  }

  // Configuration validation
  validateConfig() {
    const requiredEnvVars = [
      'COSMOS_ENDPOINT',
      'COSMOS_KEY'
    ];

    const missing = requiredEnvVars.filter(env => !process.env[env]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate endpoint format
    if (!process.env.COSMOS_ENDPOINT.startsWith('https://')) {
      throw new Error('COSMOS_ENDPOINT must be a valid HTTPS URL');
    }

    // Validate key format (basic check)
    if (process.env.COSMOS_KEY.length < 20) {
      throw new Error('COSMOS_KEY appears to be invalid (too short)');
    }
  }

  // Get database configuration
  getDatabaseConfig() {
    this.validateConfig();

    return {
      endpoint: process.env.COSMOS_ENDPOINT,
      key: process.env.COSMOS_KEY,
      databaseId: process.env.COSMOS_DATABASE_ID || 'AmenityReservationDB',
      options: {
        userAgentSuffix: 'AmenityReservationAPI/1.0.0',
        connectionPolicy: {
          requestTimeout: 30000,
          retryOptions: {
            maxRetryAttemptCount: 3,
            fixedRetryIntervalInMilliseconds: 1000,
            maxWaitTimeInSeconds: 60
          }
        }
      }
    };
  }

  // Container configurations
  getContainerConfigs() {
    return [
      {
        id: 'Users',
        partitionKey: '/id',
        uniqueKeyPolicy: {
          uniqueKeys: [
            { paths: ['/username'] }
          ]
        },
        indexingPolicy: {
          indexingMode: 'consistent',
          automatic: true,
          includedPaths: [
            { path: '/*' }
          ],
          excludedPaths: [
            { path: '/passwordHash/?' }
          ],
          compositeIndexes: [
            [
              { path: '/username', order: 'ascending' },
              { path: '/isActive', order: 'ascending' }
            ],
            [
              { path: '/role', order: 'ascending' },
              { path: '/createdAt', order: 'descending' }
            ]
          ]
        }
      },
      {
        id: 'Amenities',
        partitionKey: '/id',
        uniqueKeyPolicy: {
          uniqueKeys: [
            { paths: ['/name'] }
          ]
        },
        indexingPolicy: {
          indexingMode: 'consistent',
          automatic: true,
          includedPaths: [
            { path: '/*' }
          ],
          compositeIndexes: [
            [
              { path: '/type', order: 'ascending' },
              { path: '/isActive', order: 'ascending' }
            ],
            [
              { path: '/isActive', order: 'ascending' },
              { path: '/name', order: 'ascending' }
            ]
          ]
        }
      },
      {
        id: 'Reservations',
        partitionKey: '/id',
        indexingPolicy: {
          indexingMode: 'consistent',
          automatic: true,
          includedPaths: [
            { path: '/*' }
          ],
          compositeIndexes: [
            [
              { path: '/userId', order: 'ascending' },
              { path: '/startTime', order: 'descending' }
            ],
            [
              { path: '/amenityId', order: 'ascending' },
              { path: '/startTime', order: 'ascending' }
            ],
            [
              { path: '/status', order: 'ascending' },
              { path: '/createdAt', order: 'descending' }
            ],
            [
              { path: '/startTime', order: 'ascending' },
              { path: '/endTime', order: 'ascending' }
            ]
          ]
        }
      }
    ];
  }

  // Initialize Cosmos DB connection
  async initialize() {
    try {
      if (this.isInitialized) {
        return this.client;
      }

      logger.info('Initializing Cosmos DB connection...');

      const config = this.getDatabaseConfig();

      // Create Cosmos client
      this.client = new CosmosClient({
        endpoint: config.endpoint,
        key: config.key,
        ...config.options
      });

      // Create or get database
      const { database } = await this.client.databases.createIfNotExists({
        id: config.databaseId
      });
      this.database = database;

      logger.info(`Database '${config.databaseId}' ready`);

      // Initialize containers
      await this.initializeContainers();

      this.isInitialized = true;
      logger.success('Cosmos DB initialized successfully');

      return this.client;
    } catch (error) {
      logger.error('Failed to initialize Cosmos DB:', error);
      throw new Error(`Database initialization failed: ${error.message}`);
    }
  }

  // Initialize all containers
  async initializeContainers() {
    const containerConfigs = this.getContainerConfigs();

    for (const config of containerConfigs) {
      try {
        logger.info(`Initializing container: ${config.id}`);

        const containerDef = {
          id: config.id,
          partitionKey: config.partitionKey
        };

        // Add unique key policy if specified
        if (config.uniqueKeyPolicy) {
          containerDef.uniqueKeyPolicy = config.uniqueKeyPolicy;
        }

        // Add indexing policy if specified
        if (config.indexingPolicy) {
          containerDef.indexingPolicy = config.indexingPolicy;
        }

        const { container } = await this.database.containers.createIfNotExists(
          containerDef,
          { offerThroughput: 400 } // Minimum throughput
        );

        this.containers[config.id] = container;
        logger.info(`Container '${config.id}' ready`);

      } catch (error) {
        logger.error(`Failed to initialize container ${config.id}:`, error);
        throw error;
      }
    }
  }

  // Get container by name
  getContainer(containerName) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    if (!this.containers[containerName]) {
      throw new Error(`Container '${containerName}' not found. Available containers: ${Object.keys(this.containers).join(', ')}`);
    }

    return this.containers[containerName];
  }

  // Test database connection
  async testConnection() {
    try {
      if (!this.client) {
        await this.initialize();
      }

      // Test connection by reading database info
      await this.database.read();
      
      // Test container access
      for (const containerName of Object.keys(this.containers)) {
        await this.containers[containerName].read();
      }

      logger.info('Database connection test successful');
      return true;
    } catch (error) {
      logger.error('Database connection test failed:', error);
      return false;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const startTime = Date.now();
      
      if (!this.isInitialized) {
        return {
          status: 'unhealthy',
          message: 'Database not initialized',
          timestamp: new Date().toISOString()
        };
      }

      // Test database read
      await this.database.read();
      
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        responseTime: `${responseTime}ms`,
        database: this.database.id,
        containers: Object.keys(this.containers),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Cleanup connections
  async cleanup() {
    try {
      if (this.client) {
        // Cosmos client doesn't have an explicit close method
        // but we can reset our references
        this.client = null;
        this.database = null;
        this.containers = {};
        this.isInitialized = false;
        
        logger.info('Database connections cleaned up');
      }
    } catch (error) {
      logger.error('Error during database cleanup:', error);
    }
  }

  // Get database statistics
  async getStats() {
    try {
      if (!this.isInitialized) {
        throw new Error('Database not initialized');
      }

      const stats = {
        database: this.database.id,
        containers: {}
      };

      // Get stats for each container
      for (const [name, container] of Object.entries(this.containers)) {
        try {
          // Get container metadata
          const { resource: containerInfo } = await container.read();
          
          // Get approximate item count (this is not exact but gives an idea)
          const { resources: items } = await container.items.query(
            'SELECT VALUE COUNT(1) FROM c'
          ).fetchAll();
          
          stats.containers[name] = {
            id: containerInfo.id,
            itemCount: items[0] || 0,
            lastModified: containerInfo._ts ? new Date(containerInfo._ts * 1000).toISOString() : null
          };
        } catch (error) {
          stats.containers[name] = {
            error: error.message
          };
        }
      }

      return stats;
    } catch (error) {
      logger.error('Error getting database stats:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const databaseConfig = new DatabaseConfig();

module.exports = databaseConfig;