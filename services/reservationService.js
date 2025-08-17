const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const amenityService = require('./amenityService');
const authService = require('./authService'); // ✅ NEW: Import to get user data
const logger = require('../utils/logger');
const databaseService = require('./databaseService');
const logger = require('../utils/logger');

class ReservationExpiryService {
  constructor() {
    this.intervalId = null;
    this.CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
  }

  // Start the automatic expiry checker
  startAutoExpiry() {
    logger.info('🕒 Starting reservation expiry service...');
    
    // Run immediately on start
    this.checkExpiredReservations();
    
    // Then run every 5 minutes
    this.intervalId = setInterval(() => {
      this.checkExpiredReservations();
    }, this.CHECK_INTERVAL);
    
    logger.info(`✅ Reservation expiry service started (checking every ${this.CHECK_INTERVAL / 1000}s)`);
  }

  // Stop the automatic expiry checker
  stopAutoExpiry() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('⏹️ Reservation expiry service stopped');
    }
  }

  // Check for and handle expired reservations
  async checkExpiredReservations() {
    try {
      const now = new Date();
      logger.info(`🔍 Checking for expired reservations at ${now.toISOString()}`);

      // Find pending reservations where start time has passed
      const query = `
        SELECT * FROM c 
        WHERE c.status = 'pending' 
        AND c.startTime < @now
        ORDER BY c.startTime ASC
      `;
      
      const parameters = [
        { name: '@now', value: now.toISOString() }
      ];

      const expiredReservations = await databaseService.queryItems('Reservations', query, parameters);
      
      if (expiredReservations.length === 0) {
        logger.info('✅ No expired pending reservations found');
        return;
      }

      logger.warn(`⚠️ Found ${expiredReservations.length} expired pending reservations`);

      // Process each expired reservation
      for (const reservation of expiredReservations) {
        await this.handleExpiredReservation(reservation);
      }

    } catch (error) {
      logger.error('❌ Error checking expired reservations:', error);
    }
  }

  // Handle a single expired reservation
  async handleExpiredReservation(reservation) {
    try {
      const hoursOverdue = (new Date().getTime() - new Date(reservation.startTime).getTime()) / (1000 * 60 * 60);
      
      logger.warn(`⚠️ Processing expired reservation ${reservation.id} (${hoursOverdue.toFixed(1)}h overdue)`);

      // Auto-deny reservations that are past their start time
      const updatedReservation = {
        ...reservation,
        status: 'denied',
        denialReason: `Automatically denied - reservation expired without admin review. Original start time: ${new Date(reservation.startTime).toLocaleString()}`,
        processedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        autoExpired: true // Flag to indicate auto-expiry
      };

      await databaseService.updateItem('Reservations', updatedReservation);
      
      logger.info(`✅ Auto-denied expired reservation ${reservation.id}`);

      // TODO: Send notification to user about auto-denial
      // TODO: Send alert to admin about missed approval

    } catch (error) {
      logger.error(`❌ Error handling expired reservation ${reservation.id}:`, error);
    }
  }

  // Get reservations needing urgent admin attention (starting within next 2 hours)
  async getUrgentPendingReservations() {
    try {
      const now = new Date();
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const query = `
        SELECT * FROM c 
        WHERE c.status = 'pending' 
        AND c.startTime >= @now 
        AND c.startTime <= @twoHoursFromNow
        ORDER BY c.startTime ASC
      `;
      
      const parameters = [
        { name: '@now', value: now.toISOString() },
        { name: '@twoHoursFromNow', value: twoHoursFromNow.toISOString() }
      ];

      const urgentReservations = await databaseService.queryItems('Reservations', query, parameters);
      return urgentReservations;

    } catch (error) {
      logger.error('Error getting urgent reservations:', error);
      return [];
    }
  }

  // Manual cleanup method for past expired reservations
  async cleanupOldExpiredReservations() {
    try {
      logger.info('🧹 Starting cleanup of old expired reservations...');

      // Find old pending reservations (more than 24 hours past start time)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const query = `
        SELECT * FROM c 
        WHERE c.status = 'pending' 
        AND c.startTime < @oneDayAgo
      `;
      
      const parameters = [
        { name: '@oneDayAgo', value: oneDayAgo.toISOString() }
      ];

      const oldExpiredReservations = await databaseService.queryItems('Reservations', query, parameters);
      
      logger.info(`Found ${oldExpiredReservations.length} old expired reservations to cleanup`);

      for (const reservation of oldExpiredReservations) {
        await this.handleExpiredReservation(reservation);
      }

      logger.info('✅ Cleanup completed');
      return oldExpiredReservations.length;

    } catch (error) {
      logger.error('Error during cleanup:', error);
      throw error;
    }
  }
}

module.exports = new ReservationExpiryService();

class ReservationService {
  // ✅ NEW: Helper method to enrich reservations with user data
  async enrichReservationWithUserData(reservation) {
    try {
      const user = await authService.getUserById(reservation.userId);
      return {
        ...reservation,
        username: user?.username || null, // Add username to reservation
        userRole: user?.role || null // Optionally add role
      };
    } catch (error) {
      logger.warn(`Failed to get user data for reservation ${reservation.id}:`, error.message);
      return reservation; // Return original reservation if user lookup fails
    }
  }

  // ✅ NEW: Helper method to enrich multiple reservations
  async enrichReservationsWithUserData(reservations) {
    return Promise.all(reservations.map(reservation => this.enrichReservationWithUserData(reservation)));
  }

  async createReservation(reservationData) {
    try {
      const { userId, amenityId, startTime, endTime, specialRequests = {} } = reservationData;

      // Validate amenity exists
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      // Validate reservation time
      const start = new Date(startTime);
      const end = new Date(endTime);
      const now = new Date();

      if (start <= now) {
        throw new Error('Reservation start time must be in the future');
      }

      if (end <= start) {
        throw new Error('End time must be after start time');
      }

      const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
      if (durationMinutes > amenity.autoApprovalRules.maxDurationMinutes) {
        throw new Error(`Reservation cannot exceed ${amenity.autoApprovalRules.maxDurationMinutes} minutes`);
      }

      // Check availability
      const availability = await amenityService.getAmenityAvailability(
        amenityId,
        start.toISOString().split('T')[0],
        durationMinutes
      );

      if (!availability.available) {
        throw new Error('Amenity is not available at the requested time');
      }

      // Check if time slot is available
      const requestedSlot = {
        startTime: start.toISOString(),
        endTime: end.toISOString()
      };

      const isSlotAvailable = availability.slots.some(slot => 
        slot.startTime <= requestedSlot.startTime && 
        slot.endTime >= requestedSlot.endTime
      );

      if (!isSlotAvailable) {
        throw new Error('Requested time slot is not available');
      }

      // Check daily reservation limit
      await this.checkDailyLimit(userId, amenityId, start, amenity.autoApprovalRules.maxReservationsPerDay);

      // Determine approval status
      const requiresApproval = this.requiresManualApproval(amenity, specialRequests, durationMinutes);
      const status = requiresApproval ? 'pending' : 'approved';

      // Create reservation object
      const reservation = {
        id: uuidv4(),
        userId,
        amenityId,
        amenityName: amenity.name, // ✅ NEW: Include amenity name
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        duration: durationMinutes,
        status,
        specialRequests,
        autoApproved: !requiresApproval,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save to database
      const createdReservation = await databaseService.createItem('Reservations', reservation);
      
      logger.info(`Reservation created: ${reservation.id} for ${amenity.name} (${status})`);
      
      // ✅ NEW: Return enriched reservation with user data
      return await this.enrichReservationWithUserData(createdReservation);
    } catch (error) {
      logger.error('Create reservation error:', error);
      throw error;
    }
  }

  async checkDailyLimit(userId, amenityId, date, maxReservationsPerDay) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const query = `
      SELECT COUNT(1) as count FROM c 
      WHERE c.userId = @userId 
      AND c.amenityId = @amenityId 
      AND c.startTime >= @startOfDay 
      AND c.startTime < @endOfDay 
      AND c.status IN ('pending', 'approved')
    `;

    const parameters = [
      { name: '@userId', value: userId },
      { name: '@amenityId', value: amenityId },
      { name: '@startOfDay', value: startOfDay.toISOString() },
      { name: '@endOfDay', value: endOfDay.toISOString() }
    ];

    const result = await databaseService.queryItems('Reservations', query, parameters);
    const currentCount = result[0]?.count || 0;

    if (currentCount >= maxReservationsPerDay) {
      throw new Error(`Maximum ${maxReservationsPerDay} reservations per day exceeded for this amenity`);
    }
  }

  requiresManualApproval(amenity, specialRequests, durationMinutes) {
    // Check duration
    if (durationMinutes > amenity.autoApprovalRules.maxDurationMinutes) {
      return true;
    }

    // Check advance booking requirement
    if (amenity.autoApprovalRules.requiresAdvanceBooking) {
      const now = new Date();
      const requiredAdvanceTime = amenity.autoApprovalRules.advanceBookingHours * 60 * 60 * 1000;
      const reservationTime = new Date(specialRequests.startTime);
      
      if (reservationTime.getTime() - now.getTime() < requiredAdvanceTime) {
        return true;
      }
    }

    // Check special requirements
    if (amenity.specialRequirements) {
      // Deposit required
      if (amenity.specialRequirements.requiresDeposit) {
        return true;
      }

      // Visitor count exceeds limit
      if (specialRequests.visitorCount && 
          amenity.specialRequirements.maxVisitors && 
          specialRequests.visitorCount > amenity.specialRequirements.maxVisitors) {
        return true;
      }
    }

    // Grill usage requires approval
    if (specialRequests.grillUsage) {
      return true;
    }

    return false;
  }

  async getUserReservations(userId, filters = {}) {
    try {
      let query = 'SELECT * FROM c WHERE c.userId = @userId';
      const parameters = [{ name: '@userId', value: userId }];

      // Add status filter
      if (filters.status) {
        query += ' AND c.status = @status';
        parameters.push({ name: '@status', value: filters.status });
      }

      // Add date range filter
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
      
      // ✅ NEW: Enrich with user data (though for user reservations, we already have the user)
      return reservations; // No need to enrich for user's own reservations
    } catch (error) {
      logger.error('Get user reservations error:', error);
      throw error;
    }
  }

  async getAllReservations(filters = {}) {
    try {
      let query = 'SELECT * FROM c WHERE 1=1';
      const parameters = [];

      // Add filters
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
      
      // ✅ NEW: Enrich all reservations with user data for admin view
      return await this.enrichReservationsWithUserData(reservations);
    } catch (error) {
      logger.error('Get all reservations error:', error);
      throw error;
    }
  }

  async getReservationById(id) {
    try {
      const reservation = await databaseService.getItem('Reservations', id);
      if (!reservation) return null;
      
      // ✅ NEW: Enrich with user data
      return await this.enrichReservationWithUserData(reservation);
    } catch (error) {
      logger.error('Get reservation by ID error:', error);
      throw error;
    }
  }

  async updateReservationStatus(id, status, denialReason = null) {
    try {
      const reservation = await this.getReservationById(id);
      if (!reservation) {
        return null;
      }

      // Validate status transition
      if (reservation.status === 'approved' || reservation.status === 'denied') {
        throw new Error('Cannot modify already processed reservation');
      }

      if (status === 'denied' && !denialReason) {
        throw new Error('Denial reason is required when denying a reservation');
      }

      const updatedReservation = {
        ...reservation,
        status,
        denialReason: status === 'denied' ? denialReason : null,
        processedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await databaseService.updateItem('Reservations', updatedReservation);
      
      logger.info(`Reservation ${status}: ${id}`);
      
      // ✅ NEW: Return enriched reservation with user data
      return await this.enrichReservationWithUserData(result);
    } catch (error) {
      logger.error('Update reservation status error:', error);
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
        throw new Error('You can only cancel your own reservations');
      }

      // Check if reservation can be cancelled
      const now = new Date();
      const startTime = new Date(reservation.startTime);
      
      if (startTime <= now) {
        throw new Error('Cannot cancel reservation that has already started');
      }

      // Allow cancellation up to 2 hours before start time
      const hoursUntilStart = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntilStart < 2 && userRole !== 'admin') {
        throw new Error('Cannot cancel reservation less than 2 hours before start time');
      }

      const updatedReservation = {
        ...reservation,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await databaseService.updateItem('Reservations', updatedReservation);
      
      logger.info(`Reservation cancelled: ${id}`);
      
      // ✅ NEW: Return enriched reservation with user data
      return await this.enrichReservationWithUserData(result);
    } catch (error) {
      logger.error('Cancel reservation error:', error);
      throw error;
    }
  }

  async getAvailableSlots(amenityId, date) {
    try {
      const availability = await amenityService.getAmenityAvailability(amenityId, date);
      
      // Return just the slots array to match frontend expectations
      return availability.slots;
      
    } catch (error) {
      logger.error('Get available slots error:', error);
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
      
      // ✅ NEW: Enrich with user data for admin view
      return await this.enrichReservationsWithUserData(reservations);
    } catch (error) {
      logger.error('Get reservations by amenity error:', error);
      throw error;
    }
  }

  async getReservationStats(startDate, endDate) {
    try {
      let query = `
        SELECT 
          c.status,
          c.amenityId,
          c.amenityName,
          COUNT(1) as count
        FROM c 
        WHERE 1=1
      `;
      const parameters = [];

      if (startDate) {
        query += ' AND c.startTime >= @startDate';
        parameters.push({ name: '@startDate', value: startDate });
      }

      if (endDate) {
        query += ' AND c.startTime <= @endDate';
        parameters.push({ name: '@endDate', value: endDate });
      }

      query += ' GROUP BY c.status, c.amenityId, c.amenityName';

      const stats = await databaseService.queryItems('Reservations', query, parameters);
      return stats;
    } catch (error) {
      logger.error('Get reservation stats error:', error);
      throw error;
    }
  }
}

module.exports = new ReservationService();