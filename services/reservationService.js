const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const amenityService = require('./amenityService');
const authService = require('./authService');
const logger = require('../utils/logger');

class ReservationService {
  async createReservation(reservationData) {
    try {
      const { amenityId, startTime, endTime, specialRequests = {} } = reservationData;
      
      // Validate amenity exists and is active
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      if (!amenity.isActive) {
        throw new Error('This amenity is currently unavailable');
      }

      // Validate time slots
      const startDateTime = new Date(startTime);
      const endDateTime = new Date(endTime);
      const now = new Date();

      if (startDateTime <= now) {
        throw new Error('Start time must be in the future');
      }

      if (endDateTime <= startDateTime) {
        throw new Error('End time must be after start time');
      }

      // Check for conflicts
      const conflictingReservations = await this.getConflictingReservations(amenityId, startTime, endTime);
      if (conflictingReservations.length > 0) {
        throw new Error('Time slot is already reserved');
      }

      // Determine if auto-approval applies
      const durationMinutes = (endDateTime - startDateTime) / (1000 * 60);
      const requiresApproval = this.checkIfRequiresApproval(amenity, durationMinutes, specialRequests);

      const reservation = {
        id: uuidv4(),
        userId: reservationData.userId,
        amenityId,
        amenityName: amenity.name,
        startTime,
        endTime,
        durationMinutes: Math.round(durationMinutes),
        status: requiresApproval ? 'pending' : 'approved',
        specialRequests,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const createdReservation = await databaseService.createItem('Reservations', reservation);
      
      logger.info(`Reservation created: ${reservation.id} for amenity ${amenity.name}`);
      return await this.enrichReservationWithUserData(createdReservation);
    } catch (error) {
      logger.error('Create reservation error:', error);
      throw error;
    }
  }

  async getUserReservations(userId, filters = {}) {
    try {
      let query = 'SELECT * FROM c WHERE c.userId = @userId';
      const parameters = [{ name: '@userId', value: userId }];

      if (filters.status) {
        query += ' AND c.status = @status';
        parameters.push({ name: '@status', value: filters.status });
      }

      if (filters.startDate) {
        query += ' AND c.startTime >= @startDate';
        parameters.push({ name: '@startDate', value: filters.startDate });
      }

      if (filters.endDate) {
        query += ' AND c.startTime <= @endDate';
        parameters.push({ name: '@endDate', value: filters.endDate });
      }

      query += ' ORDER BY c.startTime DESC';

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      return reservations;
    } catch (error) {
      logger.error('Get user reservations error:', error);
      throw error;
    }
  }

  async getAllReservations(filters = {}) {
    try {
      let query = 'SELECT * FROM c WHERE 1=1';
      const parameters = [];

      if (filters.status) {
        query += ' AND c.status = @status';
        parameters.push({ name: '@status', value: filters.status });
      }

      if (filters.amenityId) {
        query += ' AND c.amenityId = @amenityId';
        parameters.push({ name: '@amenityId', value: filters.amenityId });
      }

      if (filters.startDate) {
        query += ' AND c.startTime >= @startDate';
        parameters.push({ name: '@startDate', value: filters.startDate });
      }

      if (filters.endDate) {
        query += ' AND c.startTime <= @endDate';
        parameters.push({ name: '@endDate', value: filters.endDate });
      }

      query += ' ORDER BY c.createdAt DESC';

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      return await this.enrichReservationsWithUserData(reservations);
    } catch (error) {
      logger.error('Get all reservations error:', error);
      throw error;
    }
  }

  // ✅ FIXED: Use query instead of direct item access
  async getReservationById(id) {
    try {
      logger.info(`🔍 Looking for reservation with ID: ${id}`);
      
      // ✅ FIX: Use query instead of direct item access since that's working
      const query = 'SELECT * FROM c WHERE c.id = @id';
      const parameters = [{ name: '@id', value: id }];
      
      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      
      if (reservations.length === 0) {
        logger.warn(`❌ Reservation not found in database: ${id}`);
        return null;
      }
      
      const reservation = reservations[0];
      logger.info(`✅ Found reservation: ${reservation.id}, status: ${reservation.status}, user: ${reservation.userId}`);
      
      return await this.enrichReservationWithUserData(reservation);
    } catch (error) {
      logger.error('Get reservation by ID error:', error);
      throw error;
    }
  }

  // ✅ COMPLETE WITH DEBUGGING
  async updateReservationStatus(id, status, denialReason = null) {
    try {
      logger.info(`🎯 Starting status update for reservation: ${id} to ${status}`);
      
      const reservation = await this.getReservationById(id);
      if (!reservation) {
        logger.warn(`❌ Reservation not found during status update: ${id}`);
        return null;
      }

      logger.info(`📋 Current reservation status: ${reservation.status}`);

      // Validate status transition
      if (reservation.status === 'approved' || reservation.status === 'denied') {
        logger.warn(`⚠️ Attempting to modify already processed reservation ${id}: current status is ${reservation.status}`);
        throw new Error('Cannot modify already processed reservation');
      }

      // Validate status value
      if (!['approved', 'denied', 'cancelled'].includes(status)) {
        logger.error(`❌ Invalid status value: ${status}`);
        throw new Error('Invalid status value');
      }

      // Handle denial reason
      if (status === 'denied' && !denialReason) {
        logger.warn(`⚠️ Reservation ${id} denied without reason`);
        denialReason = 'No reason provided';
      }

      const updatedReservation = {
        ...reservation,
        status,
        denialReason: status === 'denied' ? denialReason : null,
        processedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      logger.info(`💾 Updating reservation ${id} in database...`);
      
      const updated = await databaseService.updateItem('Reservations', updatedReservation);
      
      logger.info(`✅ Successfully updated reservation ${id} status to ${status}`);
      
      return await this.enrichReservationWithUserData(updated);
    } catch (error) {
      logger.error('❌ Update reservation status error:', error);
      throw error;
    }
  }

  // ✅ DEBUG METHOD
  async debugReservationExists(id) {
    try {
      logger.info(`🔍 Debug: Checking if reservation ${id} exists in any form...`);
      
      // Try to query for the reservation using SQL
      const query = 'SELECT * FROM c WHERE c.id = @id';
      const parameters = [{ name: '@id', value: id }];
      
      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      
      if (reservations.length === 0) {
        logger.warn(`❌ Debug: No reservation found with ID ${id} in query results`);
        return null;
      }
      
      const reservation = reservations[0];
      logger.info(`✅ Debug: Found reservation via query: ${reservation.id}, status: ${reservation.status}`);
      
      return reservation;
    } catch (error) {
      logger.error('❌ Debug query error:', error);
      throw error;
    }
  }

  async cancelReservation(id, userId, userRole) {
    try {
      const reservation = await this.getReservationById(id);
      if (!reservation) {
        return null;
      }

      // Check permissions
      if (userRole !== 'admin' && reservation.userId !== userId) {
        throw new Error('Access denied');
      }

      // Check if reservation can be cancelled
      if (reservation.status === 'cancelled') {
        throw new Error('Reservation is already cancelled');
      }

      const now = new Date();
      const startTime = new Date(reservation.startTime);

      // Don't allow cancellation of past reservations
      if (startTime <= now) {
        throw new Error('Cannot cancel past reservations');
      }

      const updatedReservation = {
        ...reservation,
        status: 'cancelled',
        cancelledAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      const updated = await databaseService.updateItem('Reservations', updatedReservation);
      
      logger.info(`Reservation ${id} cancelled by user ${userId}`);
      return await this.enrichReservationWithUserData(updated);
    } catch (error) {
      logger.error('Cancel reservation error:', error);
      throw error;
    }
  }

  async getAvailableSlots(amenityId, date) {
    try {
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      if (!amenity.isActive) {
        throw new Error('This amenity is currently unavailable');
      }

      // Get existing reservations for the date
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.startTime >= @startOfDay 
        AND c.startTime <= @endOfDay 
        AND c.status IN ('approved', 'pending')
      `;
      
      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startOfDay', value: startOfDay.toISOString() },
        { name: '@endOfDay', value: endOfDay.toISOString() }
      ];

      const existingReservations = await databaseService.queryItems('Reservations', query, parameters);
      
      // Generate available slots based on amenity operating hours
      const availableSlots = this.generateAvailableSlots(amenity, date, existingReservations);
      
      return availableSlots;
    } catch (error) {
      logger.error('Get available slots error:', error);
      throw error;
    }
  }

  async getConflictingReservations(amenityId, startTime, endTime) {
    try {
      const query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.status IN ('approved', 'pending')
        AND (
          (c.startTime <= @startTime AND c.endTime > @startTime) OR
          (c.startTime < @endTime AND c.endTime >= @endTime) OR
          (c.startTime >= @startTime AND c.endTime <= @endTime)
        )
      `;
      
      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startTime', value: startTime },
        { name: '@endTime', value: endTime }
      ];

      return await databaseService.queryItems('Reservations', query, parameters);
    } catch (error) {
      logger.error('Get conflicting reservations error:', error);
      throw error;
    }
  }

  async getReservationsByAmenity(amenityId, startDate, endDate) {
    try {
      let query = 'SELECT * FROM c WHERE c.amenityId = @amenityId';
      const parameters = [{ name: '@amenityId', value: amenityId }];

      if (startDate) {
        query += ' AND c.startTime >= @startDate';
        parameters.push({ name: '@startDate', value: startDate });
      }

      if (endDate) {
        query += ' AND c.startTime <= @endDate';
        parameters.push({ name: '@endDate', value: endDate });
      }

      query += ' ORDER BY c.startTime ASC';

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      return await this.enrichReservationsWithUserData(reservations);
    } catch (error) {
      logger.error('Get reservations by amenity error:', error);
      throw error;
    }
  }

  // Helper methods
  checkIfRequiresApproval(amenity, durationMinutes, specialRequests) {
    const rules = amenity.autoApprovalRules;
    
    if (!rules) return true;
    
    // Check duration
    if (durationMinutes > rules.maxDurationMinutes) {
      return true;
    }
    
    // Check special requirements
    if (specialRequests.visitorCount && specialRequests.visitorCount > (rules.maxVisitors || 4)) {
      return true;
    }
    
    if (specialRequests.grillUsage && !rules.allowGrillUsage) {
      return true;
    }
    
    return false;
  }

  generateAvailableSlots(amenity, date, existingReservations) {
    const slots = [];
    const operatingHours = amenity.operatingHours;
    
    if (!operatingHours) return slots;
    
    const requestDate = new Date(date);
    const dayOfWeek = requestDate.getDay();
    
    // Check if amenity operates on this day
    if (!operatingHours.days.includes(dayOfWeek)) {
      return slots;
    }
    
    // Generate slots (simplified - you can enhance this logic)
    const startHour = parseInt(operatingHours.startTime.split(':')[0]);
    const endHour = parseInt(operatingHours.endTime.split(':')[0]);
    
    for (let hour = startHour; hour < endHour; hour++) {
      const slotStart = new Date(requestDate);
      slotStart.setHours(hour, 0, 0, 0);
      
      const slotEnd = new Date(slotStart);
      slotEnd.setHours(hour + 1, 0, 0, 0);
      
      // Check if slot conflicts with existing reservations
      const hasConflict = existingReservations.some(reservation => {
        const resStart = new Date(reservation.startTime);
        const resEnd = new Date(reservation.endTime);
        return (slotStart < resEnd && slotEnd > resStart);
      });
      
      if (!hasConflict) {
        slots.push({
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          available: true
        });
      }
    }
    
    return slots;
  }

  async enrichReservationWithUserData(reservation) {
    try {
      if (!reservation) return null;
      
      const user = await authService.getUserById(reservation.userId);
      return {
        ...reservation,
        userName: user ? user.username : 'Unknown User'
      };
    } catch (error) {
      logger.warn('Could not enrich reservation with user data:', error.message);
      return reservation;
    }
  }

  async enrichReservationsWithUserData(reservations) {
    try {
      const enrichedReservations = await Promise.all(
        reservations.map(reservation => this.enrichReservationWithUserData(reservation))
      );
      return enrichedReservations.filter(reservation => reservation !== null);
    } catch (error) {
      logger.error('Error enriching reservations with user data:', error);
      return reservations;
    }
  }
}

module.exports = new ReservationService();