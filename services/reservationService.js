// services/reservationService.js - COMPLETE BACKEND SERVICE FILE

const databaseService = require('./databaseService');
const authService = require('./authService');
const amenityService = require('./amenityService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class ReservationService {
  constructor() {
    this.collectionName = 'Reservations';
  }

  // ✅ Create reservation with lounge support
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
      
      logger.info(`Reservation ${reservation.id} created successfully`);
      
      return reservation;
    } catch (error) {
      logger.error('Create reservation error:', error);
      throw error;
    }
  }

  // ✅ Update reservation with lounge support
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
      
      logger.info(`Reservation ${reservationId} updated successfully`);
      
      return updatedReservation;
    } catch (error) {
      logger.error('Update reservation error:', error);
      throw error;
    }
  }

  // ✅ Get reservation by ID
  async getReservationById(reservationId) {
    try {
      const reservation = await databaseService.getItem(this.collectionName, reservationId);
      
      if (!reservation) {
        return null;
      }
      
      return reservation;
    } catch (error) {
      logger.error(`Get reservation ${reservationId} error:`, error);
      return null;
    }
  }

  // ✅ Get user reservations
  async getUserReservations(userId) {
    try {
      const reservations = await databaseService.query(this.collectionName, {
        userId: userId
      });
      
      return reservations || [];
    } catch (error) {
      logger.error('Get user reservations error:', error);
      return [];
    }
  }

  // ✅ Get all reservations
  async getAllReservations() {
    try {
      const reservations = await databaseService.getAllItems(this.collectionName);
      return reservations || [];
    } catch (error) {
      logger.error('Get all reservations error:', error);
      return [];
    }
  }

  // ✅ Get reservations by amenity
  async getReservationsByAmenity(amenityId, startDate, endDate) {
    try {
      let reservations = await databaseService.query(this.collectionName, {
        amenityId: amenityId
      });

      // Filter by date range if provided
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : new Date('2000-01-01');
        const end = endDate ? new Date(endDate) : new Date('2100-01-01');
        
        reservations = reservations.filter(r => {
          const resStart = new Date(r.startTime);
          return resStart >= start && resStart <= end;
        });
      }

      return reservations || [];
    } catch (error) {
      logger.error('Get reservations by amenity error:', error);
      return [];
    }
  }

  // ✅ Delete reservation
  async deleteReservation(reservationId) {
    try {
      await databaseService.deleteItem(this.collectionName, reservationId);
      logger.info(`Reservation ${reservationId} deleted successfully`);
      return true;
    } catch (error) {
      logger.error('Delete reservation error:', error);
      throw error;
    }
  }

  // ✅ Update reservation status
  async updateReservationStatus(reservationId, status, denialReason = null) {
    try {
      const reservation = await this.getReservationById(reservationId);
      
      if (!reservation) {
        return null;
      }

      const updateData = {
        status,
        updatedAt: new Date().toISOString()
      };

      if (denialReason) {
        updateData.denialReason = denialReason;
        updateData.rejectionReason = denialReason; // Support both field names
      }

      const updatedReservation = await this.updateReservation(reservationId, updateData);
      
      return updatedReservation;
    } catch (error) {
      logger.error('Update reservation status error:', error);
      throw error;
    }
  }

  // ✅ Check time conflict
  async checkTimeConflict(amenityId, startTime, endTime, excludeReservationId = null) {
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);
      
      // Get all active reservations for this amenity
      const reservations = await databaseService.query(this.collectionName, {
        amenityId: amenityId,
        status: { $in: ['pending', 'approved', 'confirmed'] }
      });

      // Check for conflicts
      for (const reservation of reservations) {
        // Skip the reservation being edited
        if (excludeReservationId && reservation.id === excludeReservationId) {
          continue;
        }

        const resStart = new Date(reservation.startTime);
        const resEnd = new Date(reservation.endTime);

        // Check if times overlap
        if (
          (start >= resStart && start < resEnd) ||    // New start is within existing reservation
          (end > resStart && end <= resEnd) ||        // New end is within existing reservation
          (start <= resStart && end >= resEnd)        // New reservation completely encompasses existing
        ) {
          logger.info(`Time conflict found with reservation ${reservation.id}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Check time conflict error:', error);
      throw error;
    }
  }

  // ✅ Get available slots
  async getAvailableSlots(amenityId, date, durationMinutes = 60) {
    try {
      // Get amenity details
      const amenity = await amenityService.getAmenityById(amenityId);
      
      if (!amenity) {
        throw new Error('Amenity not found');
      }

      // Parse operating hours
      const { start: openTime, end: closeTime } = amenity.operatingHours || { start: '08:00', end: '22:00' };
      const [openHour, openMinute] = openTime.split(':').map(Number);
      const [closeHour, closeMinute] = closeTime.split(':').map(Number);

      // Get existing reservations for this date
      const dateObj = new Date(date);
      const startOfDay = new Date(dateObj);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateObj);
      endOfDay.setHours(23, 59, 59, 999);

      const existingReservations = await databaseService.query(this.collectionName, {
        amenityId: amenityId,
        status: { $in: ['pending', 'approved', 'confirmed'] }
      });

      // Filter reservations for this specific date
      const dayReservations = existingReservations.filter(r => {
        const resStart = new Date(r.startTime);
        return resStart >= startOfDay && resStart <= endOfDay;
      });

      // Generate all possible slots
      const slots = [];
      const slotDate = new Date(date);
      
      // Start from opening hour
      slotDate.setHours(openHour, openMinute, 0, 0);
      const closeDateTime = new Date(date);
      closeDateTime.setHours(closeHour, closeMinute, 0, 0);

      while (slotDate < closeDateTime) {
        const slotStart = new Date(slotDate);
        const slotEnd = new Date(slotDate);
        slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

        // Only add slot if it ends before closing time
        if (slotEnd <= closeDateTime) {
          // Check if slot is available (not conflicting with existing reservations)
          let isAvailable = true;
          
          for (const reservation of dayReservations) {
            const resStart = new Date(reservation.startTime);
            const resEnd = new Date(reservation.endTime);
            
            // Check for overlap
            if (
              (slotStart >= resStart && slotStart < resEnd) ||
              (slotEnd > resStart && slotEnd <= resEnd) ||
              (slotStart <= resStart && slotEnd >= resEnd)
            ) {
              isAvailable = false;
              break;
            }
          }

          // Only add available slots
          if (isAvailable) {
            // Check if slot is in the future
            const now = new Date();
            if (slotStart > now) {
              slots.push({
                startTime: slotStart.toISOString(),
                endTime: slotEnd.toISOString(),
                label: `${this.formatTime(slotStart)} - ${this.formatTime(slotEnd)}`,
                available: true
              });
            }
          }
        }

        // Move to next slot (30-minute intervals)
        slotDate.setMinutes(slotDate.getMinutes() + 30);
      }

      return slots;
    } catch (error) {
      logger.error('Get available slots error:', error);
      throw error;
    }
  }

  // ✅ Helper: Format time for display
  formatTime(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  }

  // ✅ Enrich reservation with user data
  async enrichReservationWithUserData(reservation) {
    if (!reservation) return null;
    
    try {
      const user = await authService.getUserById(reservation.userId);
      
      if (user) {
        return {
          ...reservation,
          username: user.username,
          userEmail: user.email || null,
          userRole: user.role
        };
      }
      
      return reservation;
    } catch (error) {
      logger.warn(`Could not enrich reservation ${reservation.id} with user data:`, error.message);
      return reservation;
    }
  }

  // ✅ Enrich reservations with user data (batch)
  async enrichReservationsWithUserData(reservations) {
    if (!reservations || reservations.length === 0) {
      return [];
    }

    try {
      // Get unique user IDs
      const userIds = [...new Set(reservations.map(r => r.userId))];
      
      // Fetch all users
      const users = {};
      for (const userId of userIds) {
        try {
          const user = await authService.getUserById(userId);
          if (user) {
            users[userId] = user;
          }
        } catch (error) {
          logger.warn(`Could not fetch user ${userId}:`, error.message);
        }
      }

      // Enrich reservations
      return reservations.map(reservation => {
        const user = users[reservation.userId];
        if (user) {
          return {
            ...reservation,
            username: user.username,
            userEmail: user.email || null,
            userRole: user.role
          };
        }
        return reservation;
      });
    } catch (error) {
      logger.error('Enrich reservations with user data error:', error);
      return reservations;
    }
  }

  // ✅ Enrich reservations with amenity data
  async enrichReservationsWithAmenityData(reservations) {
    if (!reservations || reservations.length === 0) {
      return [];
    }

    try {
      // Get unique amenity IDs
      const amenityIds = [...new Set(reservations.map(r => r.amenityId))];
      
      // Fetch all amenities
      const amenities = {};
      for (const amenityId of amenityIds) {
        try {
          const amenity = await amenityService.getAmenityById(amenityId);
          if (amenity) {
            amenities[amenityId] = amenity;
          }
        } catch (error) {
          logger.warn(`Could not fetch amenity ${amenityId}:`, error.message);
        }
      }

      // Enrich reservations
      return reservations.map(reservation => {
        const amenity = amenities[reservation.amenityId];
        if (amenity) {
          return {
            ...reservation,
            amenityName: amenity.name,
            amenityType: amenity.type,
            amenityDescription: amenity.description,
            requiresApproval: amenity.requiresApproval || 
                             (amenity.autoApprovalRules ? true : false)
          };
        }
        return reservation;
      });
    } catch (error) {
      logger.error('Enrich reservations with amenity data error:', error);
      return reservations;
    }
  }

  // ✅ Enrich reservation with full data
  async enrichReservationWithFullData(reservation) {
    if (!reservation) return null;
    
    try {
      // Get user data
      const user = await authService.getUserById(reservation.userId);
      
      // Get amenity data
      const amenity = await amenityService.getAmenityById(reservation.amenityId);
      
      return {
        ...reservation,
        // User data
        username: user?.username || 'Unknown',
        userEmail: user?.email || null,
        userRole: user?.role || 'resident',
        // Amenity data
        amenityName: amenity?.name || 'Unknown',
        amenityType: amenity?.type || null,
        amenityDescription: amenity?.description || null,
        requiresApproval: amenity?.requiresApproval || 
                         (amenity?.autoApprovalRules ? true : false),
        // Lounge-specific data (will be included if present in reservation)
        visitorCount: reservation.visitorCount || null,
        willUseGrill: reservation.willUseGrill || null
      };
    } catch (error) {
      logger.warn(`Could not enrich reservation ${reservation.id} with full data:`, error.message);
      return reservation;
    }
  }

  // ✅ Enrich reservations with full data (batch)
  async enrichReservationsWithFullData(reservations) {
    if (!reservations || reservations.length === 0) {
      return [];
    }

    try {
      // Get unique IDs
      const userIds = [...new Set(reservations.map(r => r.userId))];
      const amenityIds = [...new Set(reservations.map(r => r.amenityId))];
      
      // Fetch all users
      const users = {};
      for (const userId of userIds) {
        try {
          const user = await authService.getUserById(userId);
          if (user) {
            users[userId] = user;
          }
        } catch (error) {
          logger.warn(`Could not fetch user ${userId}:`, error.message);
        }
      }

      // Fetch all amenities
      const amenities = {};
      for (const amenityId of amenityIds) {
        try {
          const amenity = await amenityService.getAmenityById(amenityId);
          if (amenity) {
            amenities[amenityId] = amenity;
          }
        } catch (error) {
          logger.warn(`Could not fetch amenity ${amenityId}:`, error.message);
        }
      }

      // Enrich reservations
      return reservations.map(reservation => {
        const user = users[reservation.userId];
        const amenity = amenities[reservation.amenityId];
        
        return {
          ...reservation,
          // User data
          username: user?.username || 'Unknown',
          userEmail: user?.email || null,
          userRole: user?.role || 'resident',
          // Amenity data
          amenityName: amenity?.name || 'Unknown',
          amenityType: amenity?.type || null,
          amenityDescription: amenity?.description || null,
          requiresApproval: amenity?.requiresApproval || 
                           (amenity?.autoApprovalRules ? true : false),
          // Lounge-specific data (will be included if present in reservation)
          visitorCount: reservation.visitorCount || null,
          willUseGrill: reservation.willUseGrill || null
        };
      });
    } catch (error) {
      logger.error('Enrich reservations with full data error:', error);
      return reservations;
    }
  }

  // ✅ Get system health
  async getSystemHealth() {
    try {
      const now = new Date();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Get all reservations
      const allReservations = await this.getAllReservations();
      
      // Calculate stats
      const todayReservations = allReservations.filter(r => {
        const start = new Date(r.startTime);
        return start >= today && start < tomorrow;
      });

      const upcomingReservations = allReservations.filter(r => {
        return new Date(r.startTime) > now;
      });

      const pendingReservations = allReservations.filter(r => {
        return r.status === 'pending';
      });

      return {
        status: 'healthy',
        timestamp: now.toISOString(),
        stats: {
          total: allReservations.length,
          today: todayReservations.length,
          upcoming: upcomingReservations.length,
          pending: pendingReservations.length
        }
      };
    } catch (error) {
      logger.error('Get system health error:', error);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

module.exports = new ReservationService();