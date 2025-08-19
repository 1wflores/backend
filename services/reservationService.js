const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const amenityService = require('./amenityService');
const authService = require('./authService');
const logger = require('../utils/logger');

// Timezone helper for Costa Rica (UTC-6)
const COSTA_RICA_OFFSET = -6; // UTC-6 hours

const toCostaRicaTime = (date) => {
  const utcDate = new Date(date);
  // Subtract 6 hours from UTC to get Costa Rica time
  return new Date(utcDate.getTime() + (COSTA_RICA_OFFSET * 60 * 60 * 1000));
};

const getCurrentCostaRicaTime = () => {
  return toCostaRicaTime(new Date());
};

class ReservationService {
  // Helper method to enrich reservations with user data
  async enrichReservationWithUserData(reservation) {
    try {
      const user = await authService.getUserById(reservation.userId);
      return {
        ...reservation,
        username: user?.username || null,
        userRole: user?.role || null
      };
    } catch (error) {
      logger.warn(`Failed to get user data for reservation ${reservation.id}:`, error.message);
      return reservation;
    }
  }

  // Helper method to enrich multiple reservations
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

      // FIX 1: Check if amenity is under maintenance
      if (!amenity.isActive) {
        throw new Error('This amenity is currently under maintenance and cannot be booked');
      }

      // Validate time slot is available
      const isAvailable = await this.isTimeSlotAvailable(amenityId, startTime, endTime);
      if (!isAvailable) {
        throw new Error('Time slot is not available');
      }

      // Validate operating hours
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      this.validateOperatingHours(amenity, startDate, endDate);

      // Determine approval status
      const requiresApproval = this.determineApprovalRequirement(amenity, specialRequests);

      // Create reservation
      const reservation = {
        id: uuidv4(),
        userId,
        amenityId,
        amenityName: amenity.name,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
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

  async getReservationById(id) {
    try {
      const reservation = await databaseService.getItem('Reservations', id);
      if (!reservation) return null;
      
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

      // FIX: Use only 2 parameters - containerName and the complete item object
      const updated = await databaseService.updateItem('Reservations', updatedReservation);
      
      logger.info(`Reservation ${id} status updated to ${status}`);
      return await this.enrichReservationWithUserData(updated);
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

      // FIX: Use only 2 parameters - containerName and the complete item object
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

      // FIX 1: Check if amenity is under maintenance
      if (!amenity.isActive) {
        throw new Error('This amenity is currently under maintenance');
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Get existing reservations for the day
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

      // Generate available slots based on operating hours
      const availableSlots = this.generateAvailableSlots(amenity, date, existingReservations);
      
      return availableSlots;
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
      return await this.enrichReservationsWithUserData(reservations);
    } catch (error) {
      logger.error('Get reservations by amenity error:', error);
      throw error;
    }
  }

  // Helper methods
  async isTimeSlotAvailable(amenityId, startTime, endTime) {
    try {
      const query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.status IN ('approved', 'pending')
        AND (
          (c.startTime < @endTime AND c.endTime > @startTime)
        )
      `;
      
      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startTime', value: startTime },
        { name: '@endTime', value: endTime }
      ];

      const conflicts = await databaseService.queryItems('Reservations', query, parameters);
      return conflicts.length === 0;
    } catch (error) {
      logger.error('Check time slot availability error:', error);
      throw error;
    }
  }

  validateOperatingHours(amenity, startDate, endDate) {
    const dayOfWeek = startDate.getDay();
    const operatingHours = amenity.operatingHours;

    // Check if amenity operates on this day
    if (!operatingHours.days.includes(dayOfWeek)) {
      throw new Error('Amenity is not available on this day');
    }

    // Check if times are within operating hours
    const startHour = startDate.getHours();
    const startMinute = startDate.getMinutes();
    const endHour = endDate.getHours();
    const endMinute = endDate.getMinutes();

    const [openHour, openMinute] = operatingHours.start.split(':').map(Number);
    const [closeHour, closeMinute] = operatingHours.end.split(':').map(Number);

    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;
    const openTimeMinutes = openHour * 60 + openMinute;
    const closeTimeMinutes = closeHour * 60 + closeMinute;

    if (startTimeMinutes < openTimeMinutes || endTimeMinutes > closeTimeMinutes) {
      throw new Error(`Amenity operates from ${operatingHours.start} to ${operatingHours.end}`);
    }
  }

  determineApprovalRequirement(amenity, specialRequests) {
    // Check auto-approval rules
    const autoApprovalRules = amenity.autoApprovalRules || {};
    
    // Check if special requests require approval
    if (specialRequests.visitorCount > (autoApprovalRules.maxVisitors || 10)) {
      return true;
    }

    if (specialRequests.grillUsage && amenity.specialRequirements?.grillUsage) {
      return true;
    }

    // Default to auto-approval if within rules
    return false;
  }

  generateAvailableSlots(amenity, date, existingReservations) {
    const slots = [];
    const slotDuration = 60; // 60 minutes per slot
    const operatingHours = amenity.operatingHours;
    
    const [openHour, openMinute] = operatingHours.start.split(':').map(Number);
    const [closeHour, closeMinute] = operatingHours.end.split(':').map(Number);

    const targetDate = new Date(date);
    
    // FIX 2: Use Costa Rica time for current time comparison
    const currentCostaRicaTime = getCurrentCostaRicaTime();
    
    // If the target date is today, we need to compare with current Costa Rica time
    const isToday = targetDate.toDateString() === currentCostaRicaTime.toDateString();

    for (let hour = openHour; hour < closeHour; hour++) {
      const slotStart = new Date(targetDate);
      slotStart.setHours(hour, 0, 0, 0);
      
      const slotEnd = new Date(slotStart);
      slotEnd.setHours(hour + 1, 0, 0, 0);

      // FIX 2: Skip past slots using Costa Rica time
      if (isToday) {
        // For today, compare with current Costa Rica time
        const slotStartCostaRica = toCostaRicaTime(slotStart);
        if (slotStartCostaRica <= currentCostaRicaTime) {
          logger.info(`Skipping past slot: ${slotStart.toISOString()} (Costa Rica: ${slotStartCostaRica.toISOString()})`);
          continue;
        }
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
          available: true
        });
      }
    }

    return slots;
  }
}

module.exports = new ReservationService();