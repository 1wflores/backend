const { CosmosClient } = require('@azure/cosmos');
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.client = null;
    this.database = null;
    this.containers = {};
  }

  async initialize() {
    try {
      // Initialize Cosmos DB client
      this.client = new CosmosClient({
        endpoint: process.env.COSMOS_ENDPOINT,
        key: process.env.COSMOS_KEY,
        userAgentSuffix: 'AmenityReservationAPI'
      });

      // Get database reference
      const databaseId = process.env.COSMOS_DATABASE_ID || 'AmenityReservationDB';
      this.database = this.client.database(databaseId);

      // Initialize containers
      await this.initializeContainers();

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
        partitionKey: '/id'
      },
      {
        id: 'Amenities',
        partitionKey: '/id'
      },
      {
        id: 'Reservations',
        partitionKey: '/id'
      }
    ];

    for (const config of containerConfigs) {
      try {
        const { container } = await this.database.containers.createIfNotExists({
          id: config.id,
          partitionKey: config.partitionKey
        });
        this.containers[config.id] = container;
        logger.info(`Container ${config.id} initialized`);
      } catch (error) {
        logger.error(`Failed to initialize container ${config.id}:`, error);
        throw error;
      }
    }
  }

  async testConnection() {
    try {
      if (!this.client) {
        await this.initialize();
      }
      
      // Test the connection by reading database info
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

  getUsersContainer() {
    return this.getContainer('Users');
  }

  getAmenitiesContainer() {
    return this.getContainer('Amenities');
  }

  getReservationsContainer() {
    return this.getContainer('Reservations');
  }

  async createItem(containerName, item) {
    try {
      const container = this.getContainer(containerName);
      const { resource } = await container.items.create(item);
      return resource;
    } catch (error) {
      logger.error(`Error creating item in ${containerName}:`, error);
      throw error;
    }
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

  async updateItem(containerName, item) {
    try {
      const container = this.getContainer(containerName);
      const { resource } = await container.item(item.id, item.id).replace(item);
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
      return true;
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
      logger.error(`Error deleting item from ${containerName}:`, error);
      throw error;
    }
  }

  async queryItems(containerName, query, parameters = []) {
    try {
      const container = this.getContainer(containerName);
      const { resources } = await container.items.query({
        query,
        parameters
      }).fetchAll();
      return resources;
    } catch (error) {
      logger.error(`Error querying items from ${containerName}:`, error);
      throw error;
    }
  }

  async getAllItems(containerName) {
    try {
      const container = this.getContainer(containerName);
      const { resources } = await container.items.readAll().fetchAll();
      return resources;
    } catch (error) {
      logger.error(`Error getting all items from ${containerName}:`, error);
      throw error;
    }
  }

  // Helper method for pagination
  async getItemsPaginated(containerName, query, parameters = [], maxItemCount = 50) {
    try {
      const container = this.getContainer(containerName);
      const queryIterator = container.items.query({
        query,
        parameters
      }, { maxItemCount });

      const results = [];
      while (queryIterator.hasMoreResults()) {
        const { resources } = await queryIterator.fetchNext();
        results.push(...resources);
      }
      return results;
    } catch (error) {
      logger.error(`Error getting paginated items from ${containerName}:`, error);
      throw error;
    }
  }

  // Utility method for batch operations
  async batchCreate(containerName, items) {
    try {
      const container = this.getContainer(containerName);
      const results = [];
      
      for (const item of items) {
        const { resource } = await container.items.create(item);
        results.push(resource);
      }
      
      return results;
    } catch (error) {
      logger.error(`Error in batch create for ${containerName}:`, error);
      throw error;
    }
  }
}

// Create and export singleton instance
const databaseService = new DatabaseService();
module.exports = databaseService;