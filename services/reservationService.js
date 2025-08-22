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

  async enrichReservationWithUserData(reservation) {
    try {
      if (!reservation) return null;
      
      const user = await authService.getUserById(reservation.userId);
      return {
        ...reservation,
        userName: user ? user.username : 'Unknown User',
        user: user // Add full user object for better apartment extraction
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

  async getUserReservations(userId, limit = 50) {
    try {
      const query = `
        SELECT * FROM c 
        WHERE c.userId = @userId 
        ORDER BY c.createdAt DESC
        OFFSET 0 LIMIT @limit
      `;
      
      const parameters = [
        { name: '@userId', value: userId },
        { name: '@limit', value: limit }
      ];

      return await databaseService.queryItems('Reservations', query, parameters);
    } catch (error) {
      logger.error('Get user reservations error:', error);
      throw error;
    }
  }

  async getAllReservations(limit = 100) {
    try {
      const query = `
        SELECT * FROM c 
        ORDER BY c.createdAt DESC
        OFFSET 0 LIMIT @limit
      `;
      
      const parameters = [
        { name: '@limit', value: limit }
      ];

      const reservations = await databaseService.queryItems('Reservations', query, parameters);
      return await this.enrichReservationsWithUserData(reservations);
    } catch (error) {
      logger.error('Get all reservations error:', error);
      throw error;
    }
  }
}

module.exports = new ReservationService();