const express = require('express');
const router = express.Router();
const databaseService = require('../services/databaseService');
const logger = require('../utils/logger');

router.get('/', async (req, res) => {
  try {
    // Initialize database service if not already done
    if (!databaseService.client) {
      await databaseService.initialize();
    }

    // Test database connection
    const dbConnected = await databaseService.testConnection();
    
    if (dbConnected) {
      // Get container information
      const containerInfo = {};
      for (const [name, container] of Object.entries(databaseService.containers)) {
        try {
          const { resource: containerResource } = await container.read();
          containerInfo[name] = {
            id: containerResource.id,
            partitionKey: containerResource.partitionKey
          };
        } catch (error) {
          containerInfo[name] = { error: error.message };
        }
      }

      res.status(200).json({
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
        cosmosDB: {
          endpoint: process.env.COSMOS_ENDPOINT,
          database: process.env.COSMOS_DATABASE_ID,
          containers: containerInfo
        }
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        database: 'disconnected',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test endpoint for database operations
router.get('/db-test', async (req, res) => {
  try {
    if (!databaseService.client) {
      await databaseService.initialize();
    }

    // Test creating a simple document
    const testDoc = {
      id: `health-check-${Date.now()}`,
      type: 'health-check',
      timestamp: new Date().toISOString(),
      message: 'Database connection test'
    };

    // Try to create in Users container (or any container you prefer)
    const created = await databaseService.createItem('Users', testDoc);
    
    // Try to read it back
    const retrieved = await databaseService.getItem('Users', testDoc.id);
    
    // Clean up - delete the test document
    await databaseService.deleteItem('Users', testDoc.id);

    res.json({
      status: 'success',
      operations: {
        create: 'success',
        read: 'success',
        delete: 'success'
      },
      testDocument: {
        created: created.id,
        retrieved: retrieved.id,
        timestamp: retrieved.timestamp
      }
    });
    
  } catch (error) {
    logger.error('Database test operation failed:', error);
    res.status(500).json({
      status: 'error',
      operation: 'database test',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;