const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const logger = require('../utils/logger');

class AmenityService {
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
        autoApprovalRules: amenityData.autoApprovalRules,
        specialRequirements: amenityData.specialRequirements || {},
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save to database
      const createdAmenity = await databaseService.createItem('Amenities', amenity);
      
      logger.info(`Amenity created: ${amenity.name}`);
      return createdAmenity;
    } catch (error) {
      logger.error('Create amenity error:', error);
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
      const amenities = await databaseService.queryItems('Amenities', query);
      
      // Cache the result
      await cacheService.set(cacheKey, amenities, 3600); // 1 hour TTL
      
      return amenities;
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
      const amenity = await databaseService.getItem('Amenities', id);
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

  async getAmenityByName(name) {
    try {
      const query = 'SELECT * FROM c WHERE c.name = @name AND c.isActive = true';
      const parameters = [{ name: '@name', value: name }];
      
      const amenities = await databaseService.queryItems('Amenities', query, parameters);
      return amenities.length > 0 ? amenities[0] : null;
    } catch (error) {
      logger.error('Get amenity by name error:', error);
      throw error;
    }
  }

  async updateAmenity(id, updateData) {
    try {
      const amenity = await this.getAmenityById(id);
      if (!amenity) {
        return null;
      }

      // Check if new name conflicts with existing amenity
      if (updateData.name && updateData.name !== amenity.name) {
        const existingAmenity = await this.getAmenityByName(updateData.name);
        if (existingAmenity) {
          throw new Error('Amenity with this name already exists');
        }
      }

      const updatedAmenity = {
        ...amenity,
        ...updateData,
        id: amenity.id, // Ensure ID doesn't change
        updatedAt: new Date().toISOString()
      };

      const result = await databaseService.updateItem('Amenities', updatedAmenity);
      
      logger.info(`Amenity updated: ${updatedAmenity.name}`);
      return result;
    } catch (error) {
      logger.error('Update amenity error:', error);
      throw error;
    }
  }

  async deleteAmenity(id) {
    try {
      const amenity = await this.getAmenityById(id);
      if (!amenity) {
        return false;
      }

      // Soft delete by setting isActive to false
      const updatedAmenity = {
        ...amenity,
        isActive: false,
        updatedAt: new Date().toISOString()
      };

      await databaseService.updateItem('Amenities', updatedAmenity);
      
      logger.info(`Amenity deleted: ${amenity.name}`);
      return true;
    } catch (error) {
      logger.error('Delete amenity error:', error);
      throw error;
    }
  }

  async getAmenityAvailability(amenityId, date, durationMinutes = 60) {
    try {
      const amenity = await this.getAmenityById(amenityId);
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      // Parse the date and get day of week
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();

      // Check if amenity operates on this day
      if (!amenity.operatingHours.days.includes(dayOfWeek)) {
        return {
          available: false,
          reason: 'Amenity is closed on this day',
          slots: []
        };
      }

      // Get existing reservations for this date
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const reservationsQuery = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.startTime >= @startOfDay 
        AND c.startTime < @endOfDay 
        AND c.status IN ('pending', 'approved')
      `;
      
      const reservationParams = [
        { name: '@amenityId', value: amenityId },
        { name: '@startOfDay', value: startOfDay.toISOString() },
        { name: '@endOfDay', value: endOfDay.toISOString() }
      ];

      const existingReservations = await databaseService.queryItems(
        'Reservations', 
        reservationsQuery, 
        reservationParams
      );

      // Generate available time slots
      const slots = this.generateAvailableSlots(
        amenity.operatingHours,
        targetDate,
        durationMinutes,
        existingReservations
      );

      return {
        available: slots.length > 0,
        slots,
        operatingHours: amenity.operatingHours
      };
    } catch (error) {
      logger.error('Get amenity availability error:', error);
      throw error;
    }
  }

  generateAvailableSlots(operatingHours, date, durationMinutes, existingReservations) {
    const slots = [];
    
    // Parse operating hours
    const [startHour, startMinute] = operatingHours.start.split(':').map(Number);
    const [endHour, endMinute] = operatingHours.end.split(':').map(Number);
    
    const operatingStart = new Date(date);
    operatingStart.setHours(startHour, startMinute, 0, 0);
    
    const operatingEnd = new Date(date);
    operatingEnd.setHours(endHour, endMinute, 0, 0);
    
    // Generate 30-minute interval slots
    const slotInterval = 30; // minutes
    let currentSlot = new Date(operatingStart);
    
    while (currentSlot < operatingEnd) {
      const slotEnd = new Date(currentSlot.getTime() + (durationMinutes * 60 * 1000));
      
      // Check if slot end time is within operating hours
      if (slotEnd <= operatingEnd) {
        // Check if slot conflicts with existing reservations
        const hasConflict = existingReservations.some(reservation => {
          const reservationStart = new Date(reservation.startTime);
          const reservationEnd = new Date(reservation.endTime);
          
          return (
            (currentSlot >= reservationStart && currentSlot < reservationEnd) ||
            (slotEnd > reservationStart && slotEnd <= reservationEnd) ||
            (currentSlot <= reservationStart && slotEnd >= reservationEnd)
          );
        });
        
        if (!hasConflict) {
          slots.push({
            startTime: currentSlot.toISOString(),
            endTime: slotEnd.toISOString(),
            duration: durationMinutes
          });
        }
      }
      
      // Move to next slot
      currentSlot = new Date(currentSlot.getTime() + (slotInterval * 60 * 1000));
    }
    
    return slots;
  }

  async getAmenityTypes() {
    return ['jacuzzi', 'cold-tub', 'yoga-deck', 'lounge'];
  }

  async getAmenitiesByType(type) {
    try {
      const query = 'SELECT * FROM c WHERE c.type = @type AND c.isActive = true ORDER BY c.name';
      const parameters = [{ name: '@type', value: type }];
      
      const amenities = await databaseService.queryItems('Amenities', query, parameters);
      return amenities;
    } catch (error) {
      logger.error('Get amenities by type error:', error);
      throw error;
    }
  }
}

module.exports = new AmenityService();