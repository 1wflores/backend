const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const amenityService = require('./amenityService');
const authService = require('./authService');
const logger = require('../utils/logger');

class ReservationService {
  
  // ✅ UPDATED: Enhanced getUserReservations with role-based filtering
  async getUserReservations(userId, filters = {}) {
    try {
      // Handle both old signature (userId, limit) and new signature (userId, filters)
      let limit = 50;
      let status = null;
      let startDate = null;
      let endDate = null;
      let userRole = null;

      // Check if second parameter is a number (old signature) or object (new signature)
      if (typeof filters === 'number') {
        limit = filters;
      } else if (filters && typeof filters === 'object') {
        limit = filters.limit || 50;
        status = filters.status;
        startDate = filters.startDate;
        endDate = filters.endDate;
        userRole = filters.userRole;
      }

      logger.info(`Getting user reservations for userId: ${userId}`, { 
        filters, 
        limit, 
        userRole 
      });

      // ✅ NEW: For non-admin users, only show upcoming reservations
      if (userRole !== 'admin') {
        const now = new Date();
        // Only get reservations that start in the future
        startDate = now.toISOString();
        logger.info(`🔒 Non-admin user - filtering to upcoming reservations only (from ${startDate})`);
      }

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
        ORDER BY c.startTime ASC
        OFFSET 0 LIMIT @limit
      `;
      
      parameters.push({ name: '@limit', value: limit });

      logger.info(`Executing query for user reservations:`, { query, parameters });

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      
      logger.info(`Found ${reservations.length} reservations for user ${userId} (role: ${userRole})`);

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

  // ✅ UPDATED: Enhanced getAllReservations - unchanged for admin use
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

      const whereClause = whereConditions.length > 0 ? 
        `WHERE ${whereConditions.join(' AND ')}` : '';

      const query = `
        SELECT * FROM c 
        ${whereClause}
        ORDER BY c.createdAt DESC
        OFFSET 0 LIMIT @limit
      `;
      
      parameters.push({ name: '@limit', value: limit });

      logger.info(`Executing query for all reservations:`, { query, parameters });

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      
      logger.info(`✅ Found ${reservations.length} total reservations`);

      // Enrich with user data
      const enrichedReservations = await this.enrichReservationsWithUserData(reservations);

      return enrichedReservations;

    } catch (error) {
      logger.error('Error getting all reservations:', error);
      throw error;
    }
  }

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
        reason: userRole === 'admin' ? 'Administrative cancellation' : 'User cancellation'
      };

      // Log the cancellation for audit purposes
      logger.info('🗂️ Reservation cancellation audit log:', cancellationLog);

      // 6. Delete the reservation
      await databaseService.deleteItem('Reservations', reservationId);

      logger.info(`✅ Successfully cancelled reservation ${reservationId}`);

      return {
        success: true,
        message: 'Reservation cancelled successfully',
        deletedReservation: reservation
      };

    } catch (error) {
      logger.error(`❌ Cancel reservation error for ${reservationId}:`, error);
      throw error;
    }
  }

  async createReservation(reservationData) {
    try {
      const { userId, amenityId, startTime, endTime, notes } = reservationData;
      
      logger.info('Creating new reservation:', { userId, amenityId, startTime, endTime });

      // 1. Validate amenity exists
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        throw new Error('Invalid amenity selected');
      }

      // 2. Validate user exists
      const user = await authService.getUserById(userId);
      if (!user) {
        throw new Error('Invalid user');
      }

      // 3. Validate date/time
      const start = new Date(startTime);
      const end = new Date(endTime);
      const now = new Date();

      if (start <= now) {
        throw new Error('Cannot create reservations for past dates');
      }

      if (start >= end) {
        throw new Error('End time must be after start time');
      }

      // 4. Calculate duration
      const durationMinutes = (end - start) / (1000 * 60);
      
      if (durationMinutes > amenity.maxDurationMinutes) {
        throw new Error(`Reservation duration cannot exceed ${amenity.maxDurationMinutes} minutes`);
      }

      if (durationMinutes < 30) {
        throw new Error('Minimum reservation duration is 30 minutes');
      }

      // 5. Check for conflicts
      const conflictingReservations = await this.getReservationsByAmenity(
        amenityId, 
        start.toISOString(), 
        end.toISOString()
      );

      const activeConflicts = conflictingReservations.filter(r => 
        r.status !== 'cancelled' && r.status !== 'denied'
      );

      if (activeConflicts.length > 0) {
        throw new Error('Time slot is already reserved');
      }

      // 6. Determine approval status
      const requiresApproval = amenity.requiresApproval || false;
      
      // 7. Create reservation
      const reservation = {
        id: uuidv4(),
        userId,
        amenityId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        durationMinutes,
        status: requiresApproval ? 'pending' : 'approved',
        notes: notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requiresApproval
      };

      const savedReservation = await databaseService.createItem('Reservations', reservation);
      
      logger.info(`✅ Created reservation ${savedReservation.id} with status: ${savedReservation.status}`);

      // 8. Enrich with user data
      const enrichedReservation = await this.enrichReservationsWithUserData([savedReservation]);

      return enrichedReservation[0];
    } catch (error) {
      logger.error('Create reservation error:', error);
      throw error;
    }
  }

  async getReservationById(reservationId) {
    try {
      const reservation = await databaseService.getItem('Reservations', reservationId);
      if (!reservation) {
        return null;
      }

      const enriched = await this.enrichReservationsWithUserData([reservation]);
      return enriched[0];
    } catch (error) {
      logger.error(`Get reservation by ID error (${reservationId}):`, error);
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

  async debugReservationExists(reservationId) {
    try {
      const reservation = await databaseService.getItem('Reservations', reservationId);
      logger.info(`Debug: Found reservation ${reservationId}:`, !!reservation);
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

  // ✅ HELPER: Enrich reservations with user data
  async enrichReservationsWithUserData(reservations) {
    if (!reservations || reservations.length === 0) {
      return [];
    }

    try {
      // Get unique user IDs
      const userIds = [...new Set(reservations.map(r => r.userId))];
      
      // Fetch user data for all unique users
      const users = {};
      for (const userId of userIds) {
        try {
          const user = await authService.getUserById(userId);
          if (user) {
            users[userId] = user;
          }
        } catch (error) {
          logger.warn(`Could not fetch user data for userId: ${userId}`, error.message);
        }
      }

      // Get unique amenity IDs
      const amenityIds = [...new Set(reservations.map(r => r.amenityId))];
      
      // Fetch amenity data
      const amenities = {};
      for (const amenityId of amenityIds) {
        try {
          const amenity = await amenityService.getAmenityById(amenityId);
          if (amenity) {
            amenities[amenityId] = amenity;
          }
        } catch (error) {
          logger.warn(`Could not fetch amenity data for amenityId: ${amenityId}`, error.message);
        }
      }

      // Enrich reservations
      const enrichedReservations = reservations.map(reservation => {
        const user = users[reservation.userId];
        const amenity = amenities[reservation.amenityId];

        return {
          ...reservation,
          // User data
          username: user?.username || 'Unknown User',
          userRole: user?.role || 'resident',
          // Amenity data
          amenityName: amenity?.name || 'Unknown Amenity',
          amenityDescription: amenity?.description || '',
          amenityMaxDuration: amenity?.maxDurationMinutes || 60,
        };
      });

      return enrichedReservations;
    } catch (error) {
      logger.error('Error enriching reservations with user data:', error);
      // Return original reservations if enrichment fails
      return reservations;
    }
  }

  // ✅ HELPER: Get available time slots for an amenity
  async getAvailableSlots(amenityId, date, durationMinutes = 60) {
    try {
      logger.info(`Getting available slots for amenity ${amenityId} on ${date} (duration: ${durationMinutes}min)`);

      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      // Parse operating hours
      const startHour = parseInt(amenity.operatingHours.start.split(':')[0]);
      const endHour = parseInt(amenity.operatingHours.end.split(':')[0]);
      
      // Get existing reservations for this date
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const existingReservations = await this.getReservationsByAmenity(
        amenityId,
        startOfDay.toISOString(),
        endOfDay.toISOString()
      );

      // Filter out cancelled/denied reservations
      const activeReservations = existingReservations.filter(r => 
        r.status !== 'cancelled' && r.status !== 'denied'
      );

      // Generate available slots
      const slots = [];
      const slotDuration = 30; // 30-minute slots
      
      for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += slotDuration) {
          const slotStart = new Date(date);
          slotStart.setHours(hour, minute, 0, 0);
          
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

          // Skip if slot extends beyond operating hours
          if (slotEnd.getHours() > endHour) {
            continue;
          }

          // Check for conflicts
          const hasConflict = activeReservations.some(reservation => {
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
      }

      logger.info(`✅ Found ${slots.length} available slots for ${date}`);
      
      return slots;
    } catch (error) {
      logger.error('Get available slots error:', error);
      throw error;
    }
  }
}

module.exports = new ReservationService();