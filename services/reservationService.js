// services/reservationService.js - COMPLETE VERSION WITH CACHING AND ENHANCED FILTERING
//=============================================================================

const databaseService = require('./databaseService');
const authService = require('./authService');
const amenityService = require('./amenityService');
const cacheService = require('./cacheService'); // +1 line for caching
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class ReservationService {
  constructor() {
    this.collectionName = 'Reservations';
  }

  // ✅ ENHANCED: createReservation with cache invalidation
  async createReservation(reservationData) {
    try {
      // Ensure ID is set
      if (!reservationData.id) {
        reservationData.id = uuidv4();
      }

      // Set timestamps
      const now = new Date().toISOString();
      reservationData.createdAt = now;
      reservationData.updatedAt = now;

      // Set default values for optional fields
      if (reservationData.visitorCount === undefined) {
        reservationData.visitorCount = null;
      }
      if (reservationData.willUseGrill === undefined) {
        reservationData.willUseGrill = null;
      }

      // Save to database
      const reservation = await databaseService.createItem(this.collectionName, reservationData);
      
      // Invalidate affected caches
      await this.invalidateUserCaches(reservationData.userId);
      await this.invalidateSlotCaches(reservationData.amenityId);
      
      logger.info(`✅ Reservation ${reservation.id} created - Cache invalidated`);
      
      return reservation;
    } catch (error) {
      logger.error('Create reservation error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: updateReservation with cache invalidation
  async updateReservation(reservationId, updateData) {
    try {
      const reservation = await databaseService.getItem(this.collectionName, reservationId);
      
      if (!reservation) {
        throw new Error('Reservation not found');
      }

      // Merge update data with existing reservation
      const updatedReservation = {
        ...reservation,
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      // Update in database
      await databaseService.updateItem(this.collectionName, reservationId, updatedReservation);
      
      // Invalidate affected caches
      await this.invalidateUserCaches(reservation.userId);
      await this.invalidateSlotCaches(reservation.amenityId);
      await cacheService.del(cacheService.generateKey('reservation', reservationId));
      
      logger.info(`✅ Reservation ${reservationId} updated - Cache invalidated`);
      
      return updatedReservation;
    } catch (error) {
      logger.error('Update reservation error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: getReservationById with caching
  async getReservationById(reservationId) {
    const cacheKey = cacheService.generateKey('reservation', reservationId);
    
    // Try cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const reservation = await databaseService.getItem(this.collectionName, reservationId);
      
      if (!reservation) {
        return null;
      }
      
      // Cache the result
      await cacheService.set(cacheKey, reservation, 1800); // 30 minutes TTL
      
      return reservation;
    } catch (error) {
      logger.error('Get reservation by ID error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: getUserReservations with caching and improved filtering options
  async getUserReservations(userId, options = {}) {
    // Generate cache key based on userId and options
    const cacheKey = cacheService.generateKey('user_reservations', userId, JSON.stringify(options));
    
    // Try cache first (shorter TTL since reservations change more frequently)
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.info(`📋 Returning cached reservations for user ${userId}`);
      return cached;
    }

    try {
      const { 
        amenityId,
        status,
        excludeId,
        includePastReservations = false,
        startDate,
        endDate,
        amenityType,
        limit,
        offset = 0
      } = options;

      logger.info(`📋 Getting reservations for user ${userId} with options:`, options);

      // Build query
      let query = `SELECT * FROM c WHERE c.userId = @userId`;
      const parameters = [{ name: '@userId', value: userId }];

      // Add amenity filter
      if (amenityId) {
        query += ` AND c.amenityId = @amenityId`;
        parameters.push({ name: '@amenityId', value: amenityId });
      }

      // Add amenity type filter (requires join or separate query)
      if (amenityType) {
        query += ` AND c.amenityType = @amenityType`;
        parameters.push({ name: '@amenityType', value: amenityType });
      }

      // Add status filter (can be array or string)
      if (status) {
        if (Array.isArray(status)) {
          const statusConditions = status.map((s, index) => {
            const paramName = `@status${index}`;
            parameters.push({ name: paramName, value: s });
            return `c.status = ${paramName}`;
          }).join(' OR ');
          query += ` AND (${statusConditions})`;
        } else {
          query += ` AND c.status = @status`;
          parameters.push({ name: '@status', value: status });
        }
      }

      // Exclude specific reservation (useful for update validation)
      if (excludeId) {
        query += ` AND c.id != @excludeId`;
        parameters.push({ name: '@excludeId', value: excludeId });
      }

      // Date range filters
      if (startDate) {
        query += ` AND c.startTime >= @startDate`;
        parameters.push({ name: '@startDate', value: new Date(startDate).toISOString() });
      }

      if (endDate) {
        query += ` AND c.endTime <= @endDate`;
        parameters.push({ name: '@endDate', value: new Date(endDate).toISOString() });
      }

      // Filter out past reservations unless explicitly requested
      if (!includePastReservations) {
        query += ` AND c.startTime > @now`;
        parameters.push({ name: '@now', value: new Date().toISOString() });
      }

      query += ` ORDER BY c.startTime ASC`;

      // Add limit and offset for pagination
      if (limit) {
        query += ` OFFSET ${offset} LIMIT ${limit}`;
      }

      const reservations = await databaseService.queryItems(this.collectionName, query, parameters);
      
      // Cache with 5 minute TTL (frequent changes expected)
      await cacheService.set(cacheKey, reservations || [], 300);
      
      logger.info(`✅ Found ${reservations?.length || 0} reservations for user ${userId}`);
      return reservations || [];

    } catch (error) {
      logger.error('Get user reservations error:', error);
      return [];
    }
  }

  // ✅ ENHANCED: getAllReservations with filtering and caching
  async getAllReservations(options = {}) {
    // Generate cache key based on options
    const cacheKey = cacheService.generateKey('all_reservations', JSON.stringify(options));
    
    // Try cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.info('📋 Returning cached all reservations');
      return cached;
    }

    try {
      const {
        status,
        amenityId,
        amenityType,
        startDate,
        endDate,
        userId,
        includePastReservations = true,
        limit,
        offset = 0,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      // Build query
      let query = `SELECT * FROM c WHERE 1=1`;
      const parameters = [];

      // Add filters
      if (status) {
        if (Array.isArray(status)) {
          const statusConditions = status.map((s, index) => {
            const paramName = `@status${index}`;
            parameters.push({ name: paramName, value: s });
            return `c.status = ${paramName}`;
          }).join(' OR ');
          query += ` AND (${statusConditions})`;
        } else {
          query += ` AND c.status = @status`;
          parameters.push({ name: '@status', value: status });
        }
      }

      if (amenityId) {
        query += ` AND c.amenityId = @amenityId`;
        parameters.push({ name: '@amenityId', value: amenityId });
      }

      if (amenityType) {
        query += ` AND c.amenityType = @amenityType`;
        parameters.push({ name: '@amenityType', value: amenityType });
      }

      if (userId) {
        query += ` AND c.userId = @userId`;
        parameters.push({ name: '@userId', value: userId });
      }

      if (startDate) {
        query += ` AND c.startTime >= @startDate`;
        parameters.push({ name: '@startDate', value: new Date(startDate).toISOString() });
      }

      if (endDate) {
        query += ` AND c.endTime <= @endDate`;
        parameters.push({ name: '@endDate', value: new Date(endDate).toISOString() });
      }

      if (!includePastReservations) {
        query += ` AND c.startTime > @now`;
        parameters.push({ name: '@now', value: new Date().toISOString() });
      }

      // Add sorting
      const validSortFields = ['createdAt', 'startTime', 'status', 'amenityName'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      query += ` ORDER BY c.${sortField} ${order}`;

      // Add pagination
      if (limit) {
        query += ` OFFSET ${offset} LIMIT ${limit}`;
      }

      const reservations = await databaseService.queryItems(this.collectionName, query, parameters);
      
      // Cache with 2 minute TTL (admin data changes less frequently)
      await cacheService.set(cacheKey, reservations || [], 120);
      
      logger.info(`✅ Found ${reservations?.length || 0} reservations (admin query)`);
      return reservations || [];
    } catch (error) {
      logger.error('Get all reservations error:', error);
      return [];
    }
  }

  // ✅ ENHANCED: getAvailableSlots with caching (biggest performance gain)
  async getAvailableSlots(amenityId, date, duration = 60) {
    const cacheKey = cacheService.generateKey('available_slots', amenityId, date, duration);
    
    // Try cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.info(`📋 Returning cached available slots for ${amenityId} on ${date}`);
      return cached;
    }

    try {
      // Get amenity details
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity || !amenity.isActive) {
        return [];
      }

      // Parse the target date
      const targetDate = new Date(date);
      const dateStr = targetDate.toISOString().split('T')[0];

      // Get existing reservations for this amenity on this date
      const existingReservations = await this.getReservationsForAmenityOnDate(amenityId, dateStr);

      // Generate time slots based on operating hours
      const operatingHours = amenity.operatingHours;
      const slots = this.generateTimeSlots(dateStr, operatingHours, duration, existingReservations);

      // Cache with 10 minute TTL (slots can change as reservations are made)
      await cacheService.set(cacheKey, slots, 600);
      
      logger.info(`✅ Generated ${slots.length} available slots for ${amenityId} on ${date}`);
      return slots;
    } catch (error) {
      logger.error('Get available slots error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: checkTimeConflict with proper exclusion support
  async checkTimeConflict(amenityId, startTime, endTime, excludeReservationId = null) {
    try {
      const query = `SELECT * FROM c WHERE c.amenityId = @amenityId 
                     AND c.status IN ('approved', 'pending', 'confirmed')
                     AND ((c.startTime < @endTime AND c.endTime > @startTime))
                     ${excludeReservationId ? 'AND c.id != @excludeId' : ''}`;
      
      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startTime', value: new Date(startTime).toISOString() },
        { name: '@endTime', value: new Date(endTime).toISOString() }
      ];

      if (excludeReservationId) {
        parameters.push({ name: '@excludeId', value: excludeReservationId });
      }

      const conflicts = await databaseService.queryItems(this.collectionName, query, parameters);
      
      return conflicts && conflicts.length > 0 ? conflicts : [];
    } catch (error) {
      logger.error('Check time conflict error:', error);
      throw error;
    }
  }

  // ✅ ENHANCED: cancelReservation with cache invalidation
  async cancelReservation(reservationId) {
    try {
      const reservation = await this.getReservationById(reservationId);
      
      if (!reservation) {
        throw new Error('Reservation not found');
      }

      if (reservation.status === 'cancelled') {
        throw new Error('Reservation is already cancelled');
      }

      // Update status to cancelled
      const updatedReservation = {
        ...reservation,
        status: 'cancelled',
        updatedAt: new Date().toISOString()
      };

      await databaseService.updateItem(this.collectionName, reservationId, updatedReservation);
      
      // Invalidate affected caches
      await this.invalidateUserCaches(reservation.userId);
      await this.invalidateSlotCaches(reservation.amenityId);
      await cacheService.del(cacheService.generateKey('reservation', reservationId));
      
      logger.info(`✅ Reservation ${reservationId} cancelled - Cache invalidated`);
      return updatedReservation;
    } catch (error) {
      logger.error('Cancel reservation error:', error);
      throw error;
    }
  }

  // ✅ HELPER METHODS FOR CACHE INVALIDATION
  async invalidateUserCaches(userId) {
    await cacheService.delPattern(`user_reservations:${userId}:*`);
    await cacheService.delPattern('all_reservations:*');
    logger.info(`✅ Invalidated user caches for ${userId}`);
  }

  async invalidateSlotCaches(amenityId) {
    await cacheService.delPattern(`available_slots:${amenityId}:*`);
    logger.info(`✅ Invalidated slot caches for amenity ${amenityId}`);
  }

  // ✅ PRESERVED: Helper methods (unchanged)
  async getReservationsForAmenityOnDate(amenityId, date) {
    try {
      const startOfDay = new Date(date + 'T00:00:00.000Z').toISOString();
      const endOfDay = new Date(date + 'T23:59:59.999Z').toISOString();

      const query = `SELECT * FROM c WHERE c.amenityId = @amenityId 
                     AND c.startTime >= @startOfDay 
                     AND c.startTime <= @endOfDay
                     AND c.status IN ('approved', 'pending', 'confirmed')`;
      
      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startOfDay', value: startOfDay },
        { name: '@endOfDay', value: endOfDay }
      ];

      return await databaseService.queryItems(this.collectionName, query, parameters) || [];
    } catch (error) {
      logger.error('Get reservations for amenity on date error:', error);
      return [];
    }
  }

  generateTimeSlots(date, operatingHours, slotDuration, existingReservations) {
    const slots = [];
    const targetDate = new Date(date);
    
    try {
      // Parse operating hours
      const [startHour, startMinute] = operatingHours.start.split(':').map(Number);
      const [endHour, endMinute] = operatingHours.end.split(':').map(Number);

      // Create start and end times for the day
      const dayStart = new Date(targetDate);
      dayStart.setHours(startHour, startMinute, 0, 0);
      
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(endHour, endMinute, 0, 0);

      // Generate slots
      let currentTime = new Date(dayStart);
      
      while (currentTime < dayEnd) {
        const slotStart = new Date(currentTime);
        const slotEnd = new Date(currentTime.getTime() + (slotDuration * 60 * 1000));
        
        // Check if slot end time is within operating hours
        if (slotEnd <= dayEnd) {
          // Check if slot conflicts with existing reservations
          const hasConflict = existingReservations.some(reservation => {
            const reservationStart = new Date(reservation.startTime);
            const reservationEnd = new Date(reservation.endTime);
            
            return (slotStart < reservationEnd && slotEnd > reservationStart);
          });

          if (!hasConflict) {
            slots.push({
              startTime: slotStart.toISOString(),
              endTime: slotEnd.toISOString(),
              duration: slotDuration,
              available: true
            });
          }
        }
        
        // Move to next slot (typically 15 or 30 minute intervals)
        currentTime.setMinutes(currentTime.getMinutes() + (slotDuration / 4)); // 15 min intervals
      }
    } catch (error) {
      logger.error('Generate time slots error:', error);
    }

    return slots;
  }

  // ✅ PRESERVED: Validation methods (unchanged)
  validateReservationTime(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();

    // Check if times are in the future
    if (start <= now) {
      return { isValid: false, error: 'Start time must be in the future' };
    }

    // Check if end time is after start time
    if (end <= start) {
      return { isValid: false, error: 'End time must be after start time' };
    }

    // Check if duration is reasonable (max 8 hours)
    const durationMs = end.getTime() - start.getTime();
    const maxDurationMs = 8 * 60 * 60 * 1000; // 8 hours
    
    if (durationMs > maxDurationMs) {
      return { isValid: false, error: 'Reservation duration cannot exceed 8 hours' };
    }

    return { isValid: true };
  }

  async validateReservationData(reservationData) {
    const errors = {};

    // Required fields
    if (!reservationData.amenityId) {
      errors.amenityId = 'Amenity ID is required';
    }

    if (!reservationData.userId) {
      errors.userId = 'User ID is required';
    }

    if (!reservationData.startTime) {
      errors.startTime = 'Start time is required';
    }

    if (!reservationData.endTime) {
      errors.endTime = 'End time is required';
    }

    // Validate time ranges
    if (reservationData.startTime && reservationData.endTime) {
      const timeValidation = this.validateReservationTime(reservationData.startTime, reservationData.endTime);
      if (!timeValidation.isValid) {
        errors.time = timeValidation.error;
      }
    }

    // Validate amenity exists and is active
    if (reservationData.amenityId) {
      try {
        const amenity = await amenityService.getAmenityById(reservationData.amenityId);
        if (!amenity || !amenity.isActive) {
          errors.amenityId = 'Amenity not found or inactive';
        }
      } catch (error) {
        errors.amenityId = 'Invalid amenity';
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }
}

module.exports = new ReservationService();