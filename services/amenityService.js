const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const cacheService = require('./cacheService'); // +1 line for caching
const logger = require('../utils/logger');

class AmenityService {
  constructor() {
    this.collectionName = 'Amenities';
  }

  // ✅ NEW: Missing getAmenitiesByIds method
  async getAmenitiesByIds(amenityIds) {
    if (!Array.isArray(amenityIds) || amenityIds.length === 0) {
      return [];
    }

    try {
      logger.info(`🔍 Getting amenities by IDs: ${amenityIds.join(', ')}`);

      // Check cache first
      const cacheKey = cacheService.generateKey('amenities', 'byIds', amenityIds.sort().join(','));
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        logger.info(`📋 Returning cached amenities for IDs: ${amenityIds.join(', ')}`);
        return cached;
      }

      // Build query to get amenities by IDs
      const query = `SELECT * FROM c WHERE ARRAY_CONTAINS(@amenityIds, c.id)`;
      const parameters = [{ name: '@amenityIds', value: amenityIds }];

      const result = await databaseService.queryItems(this.collectionName, query, parameters);
      
      logger.info(`✅ Found ${result.length} amenities for ${amenityIds.length} requested IDs`);

      // Cache the result
      await cacheService.set(cacheKey, result, 3600); // 1 hour TTL

      return result;

    } catch (error) {
      logger.error('❌ Error getting amenities by IDs:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: getAllAmenities with caching
  async getAllAmenities() {
    const cacheKey = 'amenities:all';
    
    // Try cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.info('📋 Returning cached amenities');
      return cached;
    }

    try {
      // Your existing database logic unchanged
      const query = 'SELECT * FROM c WHERE c.isActive = true ORDER BY c.name';
      const amenities = await databaseService.queryItems(this.collectionName, query);
      
      // Cache the result
      await cacheService.set(cacheKey, amenities, 3600); // 1 hour TTL
      
      logger.info(`✅ Found ${amenities?.length || 0} amenities`);
      return amenities || [];
    } catch (error) {
      logger.error('Get all amenities error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: getAmenityById with caching
  async getAmenityById(id) {
    const cacheKey = cacheService.generateKey('amenity', id);
    
    // Try cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Your existing database logic unchanged
      const amenity = await databaseService.getItem(this.collectionName, id);
      const result = amenity && amenity.isActive ? amenity : null;
      
      // Cache the result
      if (result) {
        await cacheService.set(cacheKey, result, 3600); // 1 hour TTL
      }
      
      return result;
    } catch (error) {
      logger.error('Get amenity by ID error:', error);
      throw error;
    }
  }

  // ✅ PRESERVED: getAmenityByName (unchanged)
  async getAmenityByName(name) {
    try {
      const query = 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.isActive = true';
      const parameters = [{ name: '@name', value: name }];
      
      const amenities = await databaseService.queryItems(this.collectionName, query, parameters);
      return amenities && amenities.length > 0 ? amenities[0] : null;
    } catch (error) {
      logger.error('Get amenity by name error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: createAmenity with cache invalidation
  async createAmenity(amenityData) {
    try {
      // Check if amenity name already exists
      const existingAmenity = await this.getAmenityByName(amenityData.name);
      if (existingAmenity) {
        throw new Error('Amenity with this name already exists');
      }

      // Create amenity object
      const amenity = {
        id: uuidv4(),
        name: amenityData.name,
        type: amenityData.type,
        description: amenityData.description || '',
        capacity: amenityData.capacity,
        operatingHours: amenityData.operatingHours,
        autoApprovalRules: amenityData.autoApprovalRules || {
          maxDurationMinutes: 60,
          maxReservationsPerDay: 3
        },
        specialRequirements: amenityData.specialRequirements || {},
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save to database
      const createdAmenity = await databaseService.createItem(this.collectionName, amenity);
      
      // Invalidate related caches
      await cacheService.del('amenities:all');
      
      logger.info(`✅ Amenity created: ${amenity.name} - Cache invalidated`);
      return createdAmenity;
    } catch (error) {
      logger.error('Create amenity error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: updateAmenity with cache invalidation
  async updateAmenity(id, updateData) {
    try {
      const existingAmenity = await databaseService.getItem(this.collectionName, id);
      
      if (!existingAmenity) {
        throw new Error('Amenity not found');
      }

      // Check if name is being changed and if new name already exists
      if (updateData.name && updateData.name !== existingAmenity.name) {
        const nameExists = await this.getAmenityByName(updateData.name);
        if (nameExists) {
          throw new Error('Amenity with this name already exists');
        }
      }

      // Merge update data with existing amenity
      const updatedAmenity = {
        ...existingAmenity,
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      // Update in database
      const result = await databaseService.updateItem(this.collectionName, updatedAmenity);
      
      // Invalidate related caches
      await cacheService.del(cacheService.generateKey('amenity', id));
      await cacheService.del('amenities:all');
      
      logger.info(`✅ Amenity ${id} updated - Cache invalidated`);
      return result;
    } catch (error) {
      logger.error('Update amenity error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: deleteAmenity with cache invalidation
  async deleteAmenity(id) {
    try {
      const amenity = await databaseService.getItem(this.collectionName, id);
      
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      // Soft delete by setting isActive to false
      const updatedAmenity = {
        ...amenity,
        isActive: false,
        updatedAt: new Date().toISOString()
      };

      const result = await databaseService.updateItem(this.collectionName, updatedAmenity);
      
      // Invalidate related caches
      await cacheService.del(cacheService.generateKey('amenity', id));
      await cacheService.del('amenities:all');
      
      logger.info(`✅ Amenity ${id} deleted (soft delete) - Cache invalidated`);
      return result;
    } catch (error) {
      logger.error('Delete amenity error:', error);
      throw error;
    }
  }

  // ✅ PRESERVED: updateAmenityStatus (unchanged)
  async updateAmenityStatus(id, isActive, maintenanceNotes = '') {
    try {
      const amenity = await databaseService.getItem(this.collectionName, id);
      
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      const updateData = {
        isActive,
        ...(maintenanceNotes && { maintenanceNotes }),
        updatedAt: new Date().toISOString()
      };

      const updatedAmenity = {
        ...amenity,
        ...updateData
      };

      const result = await databaseService.updateItem(this.collectionName, updatedAmenity);
      
      // Invalidate related caches
      await cacheService.del(cacheService.generateKey('amenity', id));
      await cacheService.del('amenities:all');
      
      logger.info(`✅ Amenity ${id} status updated - Cache invalidated`);
      return result;
    } catch (error) {
      logger.error('Update amenity status error:', error);
      throw error;
    }
  }

  // ✅ PRESERVED: validateAmenityData (unchanged)
  validateAmenityData(amenityData) {
    const errors = {};
    
    if (!amenityData.name || amenityData.name.trim().length === 0) {
      errors.name = 'Name is required';
    }
    
    if (!amenityData.type) {
      errors.type = 'Type is required';
    }
    
    if (!amenityData.capacity || amenityData.capacity < 1) {
      errors.capacity = 'Capacity must be at least 1';
    }
    
    if (!amenityData.operatingHours) {
      errors.operatingHours = 'Operating hours are required';
    }
    
    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  // ✅ PRESERVED: formatAmenityData (unchanged)
  formatAmenityData(amenityData) {
    return {
      name: amenityData.name?.trim(),
      type: amenityData.type,
      description: amenityData.description?.trim() || '',
      capacity: parseInt(amenityData.capacity),
      operatingHours: amenityData.operatingHours,
      autoApprovalRules: amenityData.autoApprovalRules || {
        maxDurationMinutes: 60,
        maxReservationsPerDay: 3
      },
      specialRequirements: amenityData.specialRequirements || {},
      isActive: amenityData.isActive !== undefined ? amenityData.isActive : true
    };
  }
}

module.exports = new AmenityService();