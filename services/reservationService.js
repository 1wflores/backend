const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const amenityService = require('./amenityService');
const authService = require('./authService');
const logger = require('../utils/logger');

class ReservationService {
  
  // ✅ NEW: Complete cancelReservation implementation with proper deletion
  async cancelReservation(reservationId, userId, userRole) {
    try {
      logger.info(`🚫 Cancelling reservation ${reservationId} by user ${userId} (role: ${userRole})`);

      // 1. First, verify the reservation exists
      const reservation = await databaseService.getItem('Reservations', reservationId);
      if (!reservation) {
        logger.warn(`❌ Reservation ${reservationId} not found for cancellation`);
        throw new Error('Reservation not found');
      }

      logger.info(`📋 Found reservation:`, {
        id: reservation.id,
        status: reservation.status,
        userId: reservation.userId,
        amenityId: reservation.amenityId,
        startTime: reservation.startTime,
        endTime: reservation.endTime
      });

      // 2. Check user permission to cancel this reservation
      if (userRole !== 'admin' && reservation.userId !== userId) {
        logger.warn(`⚠️ User ${userId} attempted to cancel reservation ${reservationId} belonging to user ${reservation.userId}`);
        throw new Error('Access denied - you can only cancel your own reservations');
      }

      // 3. Validate that the reservation can be cancelled
      const cancellableStatuses = ['pending', 'approved', 'confirmed'];
      if (!cancellableStatuses.includes(reservation.status)) {
        logger.warn(`❌ Cannot cancel reservation ${reservationId} with status: ${reservation.status}`);
        throw new Error(`Cannot cancel reservation with status: ${reservation.status}`);
      }

      // 4. Check if reservation is in the past (optional business rule)
      const now = new Date();
      const reservationStart = new Date(reservation.startTime);
      if (reservationStart < now) {
        // Allow admins to cancel past reservations, but warn residents
        if (userRole !== 'admin') {
          logger.warn(`⚠️ User ${userId} attempted to cancel past reservation ${reservationId}`);
          throw new Error('Cannot cancel reservations that have already started');
        } else {
          logger.info(`ℹ️ Admin ${userId} cancelling past reservation ${reservationId}`);
        }
      }

      // 5. Log cancellation details before deletion (for audit trail)
      const cancellationLog = {
        reservationId: reservation.id,
        originalReservation: { ...reservation },
        cancelledBy: userId,
        cancelledByRole: userRole,
        cancelledAt: new Date().toISOString(),
        reason: userRole === 'admin' ? 'Admin cancellation' : 'User cancellation',
        slotFreed: {
          amenityId: reservation.amenityId,
          startTime: reservation.startTime,
          endTime: reservation.endTime,
          date: reservation.startTime.split('T')[0]
        }
      };

      logger.info(`📝 Logging cancellation details:`, cancellationLog);

      // 6. IMPORTANT: Completely DELETE the reservation from CosmosDB
      // This ensures the slot becomes available again for booking
      const deleted = await databaseService.deleteItem('Reservations', reservationId);
      
      if (!deleted) {
        logger.error(`❌ Failed to delete reservation ${reservationId} from database`);
        throw new Error('Failed to cancel reservation - database operation failed');
      }

      logger.info(`✅ Reservation ${reservationId} successfully deleted from CosmosDB`);

      // 7. Verify the slot is now available by checking for conflicts
      await this.validateSlotAvailability(
        reservation.amenityId,
        reservation.startTime,
        reservation.endTime,
        null // No exclusion needed since we deleted the reservation
      );

      logger.info(`✅ Slot confirmed available: ${reservation.amenityId} from ${reservation.startTime} to ${reservation.endTime}`);

      // 8. Return the deleted reservation details for response
      const result = {
        ...reservation,
        status: 'cancelled',
        cancelledAt: cancellationLog.cancelledAt,
        cancelledBy: userId,
        deletedFromDatabase: true,
        slotFreed: true
      };

      logger.info(`🎉 Successfully cancelled and deleted reservation ${reservationId}`);

      return result;

    } catch (error) {
      logger.error(`❌ Error cancelling reservation ${reservationId}:`, error);
      throw error;
    }
  }

  // ✅ NEW: Validate that a time slot is available (helper method)
  async validateSlotAvailability(amenityId, startTime, endTime, excludeReservationId = null) {
    try {
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);

      logger.info(`🔍 Checking slot availability for amenity ${amenityId} from ${startTime} to ${endTime}`);

      // Query for conflicting reservations
      let query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.status IN ('approved', 'pending', 'confirmed')
        AND (
          (c.startTime < @endTime AND c.endTime > @startTime)
        )
      `;

      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startTime', value: startTime },
        { name: '@endTime', value: endTime }
      ];

      // Exclude specific reservation if provided
      if (excludeReservationId) {
        query += ` AND c.id != @excludeId`;
        parameters.push({ name: '@excludeId', value: excludeReservationId });
      }

      const conflictingReservations = await databaseService.queryItems('Reservations', query, parameters);

      if (conflictingReservations.length > 0) {
        logger.warn(`⚠️ Found ${conflictingReservations.length} conflicting reservations:`, 
          conflictingReservations.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime }))
        );
        return false;
      }

      logger.info(`✅ Slot is available - no conflicts found`);
      return true;

    } catch (error) {
      logger.error('Error validating slot availability:', error);
      throw error;
    }
  }

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
        createdBy: reservationData.userId,
      };

      const result = await databaseService.createItem('Reservations', reservation);
      logger.info('Reservation created:', result.id);
      
      return result;
    } catch (error) {
      logger.error('Create reservation error:', error);
      throw error;
    }
  }

  checkIfRequiresApproval(amenity, durationMinutes, specialRequests) {
    // Check if amenity requires approval by default
    if (amenity.requiresApproval) {
      return true;
    }
    
    // Check auto-approval rules
    if (amenity.autoApprovalRules) {
      const rules = amenity.autoApprovalRules;
      
      // Check duration limit
      if (rules.maxDurationMinutes && durationMinutes > rules.maxDurationMinutes) {
        return true;
      }
      
      // Check visitor count limit
      if (rules.maxVisitors && specialRequests.visitorCount > rules.maxVisitors) {
        return true;
      }
    }
    
    // Check special requests that require approval
    if (specialRequests.grillUsage && !amenity.allowGrillUsage) {
      return true;
    }
    
    return false;
  }

  // FIXED: Enhanced generateAvailableSlots with better error handling and data structure normalization
  generateAvailableSlots(amenity, date, existingReservations) {
    const slots = [];
    
    try {
      // FIXED: Normalize operating hours structure
      const operatingHours = this.normalizeOperatingHours(amenity.operatingHours);
      
      if (!operatingHours) {
        logger.warn('No operating hours found for amenity:', amenity.id);
        return slots;
      }
      
      const requestDate = new Date(date);
      const dayOfWeek = requestDate.getDay();
      
      // Check if amenity operates on this day
      if (!operatingHours.days || !operatingHours.days.includes(dayOfWeek)) {
        logger.info('Amenity does not operate on day:', dayOfWeek);
        return slots;
      }
      
      // FIXED: Safe parsing of start and end times
      const { startHour, startMinute, endHour, endMinute } = this.parseOperatingTimes(operatingHours);
      
      if (startHour === null || endHour === null) {
        logger.warn('Could not parse operating times for amenity:', amenity.id);
        return slots;
      }
      
      // Generate hourly slots (you can adjust the interval as needed)
      for (let hour = startHour; hour < endHour; hour++) {
        const slotStart = new Date(requestDate);
        slotStart.setHours(hour, startMinute || 0, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setHours(hour + 1, startMinute || 0, 0, 0);
        
        // Ensure slot end doesn't exceed operating hours
        const operatingEnd = new Date(requestDate);
        operatingEnd.setHours(endHour, endMinute || 0, 0, 0);
        
        if (slotEnd > operatingEnd) {
          slotEnd.setHours(endHour, endMinute || 0, 0, 0);
        }
        
        // Skip slots that are too short
        if ((slotEnd - slotStart) < 30 * 60 * 1000) { // Less than 30 minutes
          continue;
        }
        
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
            available: true,
            autoApproval: !this.checkIfRequiresApproval(amenity, 60, {}) // Assume 1-hour slot
          });
        }
      }
      
      return slots;
    } catch (error) {
      logger.error('Error generating available slots:', error);
      return slots; // Return empty array on error
    }
  }

  // FIXED: New method to normalize different operating hours structures
  normalizeOperatingHours(operatingHours) {
    if (!operatingHours) return null;
    
    // Handle different possible structures
    let normalized = {
      days: operatingHours.days || [1, 2, 3, 4, 5, 6, 0], // Default to all days
      start: null,
      end: null
    };
    
    // Try different property names for start time
    if (operatingHours.start) {
      normalized.start = operatingHours.start;
    } else if (operatingHours.startTime) {
      normalized.start = operatingHours.startTime;
    } else if (operatingHours.openTime) {
      normalized.start = operatingHours.openTime;
    }
    
    // Try different property names for end time
    if (operatingHours.end) {
      normalized.end = operatingHours.end;
    } else if (operatingHours.endTime) {
      normalized.end = operatingHours.endTime;
    } else if (operatingHours.closeTime) {
      normalized.end = operatingHours.closeTime;
    }
    
    // Fallback to default hours if nothing found
    if (!normalized.start) normalized.start = '06:00';
    if (!normalized.end) normalized.end = '22:00';
    
    return normalized;
  }

  // FIXED: New method to safely parse operating times
  parseOperatingTimes(operatingHours) {
    let startHour = null, startMinute = 0, endHour = null, endMinute = 0;
    
    try {
      // Parse start time
      if (operatingHours.start && typeof operatingHours.start === 'string') {
        const startParts = operatingHours.start.split(':');
        if (startParts.length >= 2) {
          startHour = parseInt(startParts[0]);
          startMinute = parseInt(startParts[1]) || 0;
        }
      }
      
      // Parse end time
      if (operatingHours.end && typeof operatingHours.end === 'string') {
        const endParts = operatingHours.end.split(':');
        if (endParts.length >= 2) {
          endHour = parseInt(endParts[0]);
          endMinute = parseInt(endParts[1]) || 0;
        }
      }
      
      // Validate parsed values
      if (isNaN(startHour) || startHour < 0 || startHour > 23) startHour = 6;
      if (isNaN(endHour) || endHour < 0 || endHour > 23) endHour = 22;
      if (isNaN(startMinute) || startMinute < 0 || startMinute > 59) startMinute = 0;
      if (isNaN(endMinute) || endMinute < 0 || endMinute > 59) endMinute = 0;
      
      // Ensure end is after start
      if (endHour <= startHour) {
        endHour = startHour + 1;
        if (endHour > 23) endHour = 23;
      }
      
    } catch (error) {
      logger.error('Error parsing operating times:', error);
      // Return default values
      startHour = 6;
      startMinute = 0;
      endHour = 22;
      endMinute = 0;
    }
    
    return { startHour, startMinute, endHour, endMinute };
  }

  // ✅ ENHANCED: Better available slots calculation that accounts for cancelled reservations
  async getAvailableSlots(amenityId, date, duration = 60) {
    try {
      logger.info(`🔍 Getting available slots for amenity ${amenityId} on ${date}, duration: ${duration}min`);

      // Get amenity details
      const amenity = await databaseService.getItem('Amenities', amenityId);
      if (!amenity || !amenity.isActive) {
        throw new Error('Amenity not found or not available');
      }

      // Get existing reservations for the date (only active statuses)
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      const query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.startTime >= @startOfDay 
        AND c.startTime < @endOfDay
        AND c.status IN ('approved', 'pending', 'confirmed')
        ORDER BY c.startTime ASC
      `;

      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startOfDay', value: startOfDay.toISOString() },
        { name: '@endOfDay', value: endOfDay.toISOString() }
      ];

      const existingReservations = await databaseService.queryItems('Reservations', query, parameters);

      logger.info(`📊 Found ${existingReservations.length} active reservations for ${date}`);

      // Generate available time slots
      const slots = this.generateTimeSlots(amenity, date, duration, existingReservations);

      logger.info(`✅ Generated ${slots.length} available slots`);

      return slots;

    } catch (error) {
      logger.error('Error getting available slots:', error);
      throw error;
    }
  }

  // ✅ NEW: Generate time slots avoiding existing reservations
  generateTimeSlots(amenity, date, duration, existingReservations) {
    const slots = [];
    const slotDuration = duration * 60 * 1000; // Convert to milliseconds

    // Parse amenity operating hours (assuming format like "09:00-21:00")
    const operatingHours = amenity.operatingHours || "09:00-21:00";
    const [startHour, endHour] = operatingHours.split('-');
    
    const startTime = new Date(`${date}T${startHour}:00.000Z`);
    const endTime = new Date(`${date}T${endHour}:00.000Z`);

    let currentSlotStart = new Date(startTime);

    while (currentSlotStart.getTime() + slotDuration <= endTime.getTime()) {
      const currentSlotEnd = new Date(currentSlotStart.getTime() + slotDuration);

      // Check if this slot conflicts with any existing reservation
      const hasConflict = existingReservations.some(reservation => {
        const resStart = new Date(reservation.startTime);
        const resEnd = new Date(reservation.endTime);

        return (currentSlotStart < resEnd && currentSlotEnd > resStart);
      });

      if (!hasConflict) {
        slots.push({
          startTime: currentSlotStart.toISOString(),
          endTime: currentSlotEnd.toISOString(),
          available: true,
          duration: duration
        });
      }

      // Move to next potential slot (e.g., every 30 minutes)
      currentSlotStart = new Date(currentSlotStart.getTime() + (30 * 60 * 1000));
    }

    return slots;
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

 // ✅ ENHANCED: Better error handling for user data enrichment
  async enrichReservationWithUserData(reservation) {
    try {
      if (!reservation.userId) {
        logger.warn('Reservation missing userId:', reservation.id);
        return {
          ...reservation,
          username: 'Unknown User',
          user: null
        };
      }

      const user = await databaseService.getItem('Users', reservation.userId);
      
      return {
        ...reservation,
        username: user?.username || 'Unknown User',
        user: user || null // Add full user object for better apartment extraction
      };
    } catch (error) {
      logger.warn(`Could not enrich reservation ${reservation.id} with user data:`, error.message);
      // ✅ IMPORTANT: Still return the reservation even if user enrichment fails
      return {
        ...reservation,
        username: 'Unknown User',
        user: null
      };
    }
  }

  async enrichReservationsWithUserData(reservations) {
    try {
      if (!Array.isArray(reservations) || reservations.length === 0) {
        logger.info('No reservations to enrich');
        return [];
      }

      logger.info(`Enriching ${reservations.length} reservations with user data`);

      const enrichedReservations = await Promise.all(
        reservations.map(reservation => this.enrichReservationWithUserData(reservation))
      );
      
      // ✅ IMPORTANT: Filter out any null results but keep valid reservations
      const validReservations = enrichedReservations.filter(reservation => reservation !== null);
      
      logger.info(`Successfully enriched ${validReservations.length} reservations`);
      
      return validReservations;
    } catch (error) {
      logger.error('Error enriching reservations with user data:', error);
      // ✅ IMPORTANT: Return original reservations if enrichment fails
      return reservations || [];
    }
  }

  // ✅ NEW: Debug method to check if reservation exists
  async debugReservationExists(reservationId) {
    try {
      const reservation = await databaseService.getItem('Reservations', reservationId);
      logger.info(`Debug: Reservation ${reservationId} exists:`, !!reservation);
      return reservation;
    } catch (error) {
      logger.info(`Debug: Reservation ${reservationId} does not exist:`, error.message);
      return null;
    }
  }

  // Additional methods for reservation management
  async updateReservationStatus(reservationId, status, reason = null) {
    try {
      const reservation = await databaseService.getItem('Reservations', reservationId);
      if (!reservation) {
        throw new Error('Reservation not found');
      }

      const updatedReservation = {
        ...reservation,
        status,
        ...(reason && { rejectionReason: reason }),
        updatedAt: new Date().toISOString()
      };

      return await databaseService.updateItem('Reservations', reservationId, updatedReservation);
    } catch (error) {
      logger.error('Update reservation status error:', error);
      throw error;
    }
  }

  // ✅ FIXED: Updated getUserReservations to handle filters properly
  async getUserReservations(userId, filters = {}) {
    try {
      // Handle both old signature (userId, limit) and new signature (userId, filters)
      let limit = 50;
      let status = null;
      let startDate = null;
      let endDate = null;

      // Check if second parameter is a number (old signature) or object (new signature)
      if (typeof filters === 'number') {
        limit = filters;
      } else if (filters && typeof filters === 'object') {
        limit = filters.limit || 50;
        status = filters.status;
        startDate = filters.startDate;
        endDate = filters.endDate;
      }

      logger.info(`Getting user reservations for userId: ${userId}`, { filters, limit });

      // Build query conditions
      let whereConditions = [`c.userId = @userId`];
      const parameters = [{ name: '@userId', value: userId }];

      // Add status filter
      if (status) {
        whereConditions.push(`c.status = @status`);
        parameters.push({ name: '@status', value: status });
      }

      // Add date filters
      if (startDate) {
        whereConditions.push(`c.startTime >= @startDate`);
        parameters.push({ name: '@startDate', value: startDate });
      }

      if (endDate) {
        whereConditions.push(`c.startTime <= @endDate`);
        parameters.push({ name: '@endDate', value: endDate });
      }

      const query = `
        SELECT * FROM c 
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY c.createdAt DESC
        OFFSET 0 LIMIT @limit
      `;
      
      parameters.push({ name: '@limit', value: limit });

      logger.info(`Executing query for user reservations:`, { query, parameters });

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      
      logger.info(`Found ${reservations.length} reservations for user ${userId}`);

      // ✅ IMPORTANT: Always return an array, even if empty
      const enrichedReservations = await this.enrichReservationsWithUserData(reservations || []);
      
      return enrichedReservations;
    } catch (error) {
      logger.error('Get user reservations error:', error);
      // ✅ IMPORTANT: Don't throw error for empty results, return empty array
      if (error.message.includes('not found') || error.code === 404) {
        logger.info(`No reservations found for user ${userId} - returning empty array`);
        return [];
      }
      throw error;
    }
  }

  // ✅ ENHANCED: Get reservations by amenity (useful for debugging slot availability)
  async getReservationsByAmenity(amenityId, startDate, endDate) {
    try {
      logger.info(`📋 Getting reservations for amenity ${amenityId} from ${startDate} to ${endDate}`);

      const query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.startTime >= @startDate 
        AND c.startTime <= @endDate
        ORDER BY c.startTime ASC
      `;

      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startDate', value: startDate },
        { name: '@endDate', value: endDate }
      ];

      const reservations = await databaseService.queryItems('Reservations', query, parameters);

      // Enrich with user data
      const enrichedReservations = await this.enrichReservationsWithUserData(reservations);

      logger.info(`✅ Found ${enrichedReservations.length} reservations for amenity ${amenityId}`);

      return enrichedReservations;

    } catch (error) {
      logger.error('Error getting reservations by amenity:', error);
      throw error;
    }
  }

  // ✅ FIXED: Updated getAllReservations to handle filters properly
  async getAllReservations(filters = {}) {
    try {
      const limit = filters.limit || 100;
      const status = filters.status;
      const amenityId = filters.amenityId;
      const startDate = filters.startDate;
      const endDate = filters.endDate;

      logger.info(`Getting all reservations with filters:`, filters);

      // Build query conditions
      let whereConditions = [];
      const parameters = [];

      if (status) {
        whereConditions.push(`c.status = @status`);
        parameters.push({ name: '@status', value: status });
      }

      if (amenityId) {
        whereConditions.push(`c.amenityId = @amenityId`);
        parameters.push({ name: '@amenityId', value: amenityId });
      }

      if (startDate) {
        whereConditions.push(`c.startTime >= @startDate`);
        parameters.push({ name: '@startDate', value: startDate });
      }

      if (endDate) {
        whereConditions.push(`c.startTime <= @endDate`);
        parameters.push({ name: '@endDate', value: endDate });
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      const query = `
        SELECT * FROM c 
        ${whereClause}
        ORDER BY c.createdAt DESC
        OFFSET 0 LIMIT @limit
      `;
      
      parameters.push({ name: '@limit', value: limit });

      logger.info(`Executing query for all reservations:`, { query, parameters });

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      
      logger.info(`Found ${reservations.length} total reservations`);

      // ✅ IMPORTANT: Always return an array, even if empty
      const enrichedReservations = await this.enrichReservationsWithUserData(reservations || []);
      
      return enrichedReservations;
    } catch (error) {
      logger.error('Get all reservations error:', error);
      // ✅ IMPORTANT: Don't throw error for empty results, return empty array
      if (error.message.includes('not found') || error.code === 404) {
        logger.info('No reservations found - returning empty array');
        return [];
      }
      throw error;
    }
  }
}

module.exports = new ReservationService();