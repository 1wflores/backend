// services/reservationService.js - FIXED BACKEND SERVICE FILE

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

  // ✅ FIXED: Get user reservations - using queryItems instead of query
  async getUserReservations(userId) {
    try {
      const query = 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.startTime DESC';
      const parameters = [{ name: '@userId', value: userId }];
      
      const reservations = await databaseService.queryItems(this.collectionName, query, parameters);
      
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

  // ✅ FIXED: Get reservations by amenity - using queryItems instead of query
  async getReservationsByAmenity(amenityId, startDate, endDate) {
    try {
      let query = 'SELECT * FROM c WHERE c.amenityId = @amenityId';
      const parameters = [{ name: '@amenityId', value: amenityId }];
      
      // Add date range filters if provided
      if (startDate) {
        query += ' AND c.startTime >= @startDate';
        parameters.push({ name: '@startDate', value: startDate });
      }
      
      if (endDate) {
        query += ' AND c.startTime <= @endDate';
        parameters.push({ name: '@endDate', value: endDate });
      }
      
      query += ' ORDER BY c.startTime DESC';
      
      const reservations = await databaseService.queryItems(this.collectionName, query, parameters);

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

  // ✅ FIXED: Check time conflict - using queryItems instead of query
  async checkTimeConflict(amenityId, startTime, endTime, excludeReservationId = null) {
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);
      
      // Get all active reservations for this amenity
      const query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.status IN ('pending', 'approved', 'confirmed')
      `;
      const parameters = [{ name: '@amenityId', value: amenityId }];
      
      const reservations = await databaseService.queryItems(this.collectionName, query, parameters);

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

  // ✅ FIXED: Get available slots - using queryItems instead of query
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

      // FIXED: Using queryItems with proper SQL query instead of query method
      const query = `
        SELECT * FROM c 
        WHERE c.amenityId = @amenityId 
        AND c.startTime >= @startOfDay 
        AND c.startTime <= @endOfDay 
        AND c.status IN ('pending', 'approved', 'confirmed')
      `;
      
      const parameters = [
        { name: '@amenityId', value: amenityId },
        { name: '@startOfDay', value: startOfDay.toISOString() },
        { name: '@endOfDay', value: endOfDay.toISOString() }
      ];

      const existingReservations = await databaseService.queryItems(
        this.collectionName, 
        query, 
        parameters
      );

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
          // Check if this slot conflicts with any existing reservation
          let isAvailable = true;
          
          for (const reservation of existingReservations) {
            const resStart = new Date(reservation.startTime);
            const resEnd = new Date(reservation.endTime);
            
            if (
              (slotStart >= resStart && slotStart < resEnd) ||
              (slotEnd > resStart && slotEnd <= resEnd) ||
              (slotStart <= resStart && slotEnd >= resEnd)
            ) {
              isAvailable = false;
              break;
            }
          }

          slots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            available: isAvailable
          });
        }

        // Move to next slot
        slotDate.setMinutes(slotDate.getMinutes() + 30); // 30-minute intervals
      }

      return slots;
    } catch (error) {
      logger.error('Get available slots error:', error);
      throw error;
    }
  }

  // ✅ Enrich reservation with user data
  async enrichReservationWithUserData(reservation) {
    try {
      if (!reservation) return null;
      
      const user = await authService.getUserById(reservation.userId);
      
      return {
        ...reservation,
        user: user ? authService.sanitizeUser(user) : null
      };
    } catch (error) {
      logger.error('Enrich reservation error:', error);
      return reservation;
    }
  }

  // ✅ Enrich multiple reservations with user data
  async enrichReservationsWithUserData(reservations) {
    try {
      const enrichedReservations = [];
      
      for (const reservation of reservations) {
        const enriched = await this.enrichReservationWithUserData(reservation);
        enrichedReservations.push(enriched);
      }
      
      return enrichedReservations;
    } catch (error) {
      logger.error('Enrich reservations error:', error);
      return reservations;
    }
  }

  // ✅ Enrich reservation with full data (user + amenity)
  async enrichReservationWithFullData(reservation) {
    try {
      if (!reservation) return null;
      
      const [user, amenity] = await Promise.all([
        authService.getUserById(reservation.userId),
        amenityService.getAmenityById(reservation.amenityId)
      ]);
      
      return {
        ...reservation,
        user: user ? authService.sanitizeUser(user) : null,
        amenity: amenity || null
      };
    } catch (error) {
      logger.error('Enrich reservation with full data error:', error);
      return reservation;
    }
  }

  // ✅ Enrich reservations with amenity data (for getUserReservations)
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

  // ✅ Enrich reservations with full data (both user and amenity)
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
      const [totalReservations, pendingCount, approvedCount] = await Promise.all([
        this.getAllReservations().then(r => r.length),
        this.getReservationsByStatus('pending').then(r => r.length),
        this.getReservationsByStatus('approved').then(r => r.length)
      ]);

      return {
        status: 'healthy',
        stats: {
          total: totalReservations,
          pending: pendingCount,
          approved: approvedCount
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Get system health error:', error);
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ✅ FIXED: Get reservations by status - using queryItems
  async getReservationsByStatus(status) {
    try {
      const query = 'SELECT * FROM c WHERE c.status = @status ORDER BY c.createdAt DESC';
      const parameters = [{ name: '@status', value: status }];
      
      const reservations = await databaseService.queryItems(this.collectionName, query, parameters);
      
      return reservations || [];
    } catch (error) {
      logger.error('Get reservations by status error:', error);
      return [];
    }
  }

  // ✅ FIXED: Search reservations - using queryItems
  async searchReservations({ searchTerm, status, amenityId, userId, startDate, endDate }) {
    try {
      let query = 'SELECT * FROM c WHERE 1=1';
      const parameters = [];
      
      if (searchTerm) {
        query += ' AND (CONTAINS(LOWER(c.notes), @searchTerm) OR CONTAINS(LOWER(c.id), @searchTerm))';
        parameters.push({ name: '@searchTerm', value: searchTerm.toLowerCase() });
      }
      
      if (status) {
        query += ' AND c.status = @status';
        parameters.push({ name: '@status', value: status });
      }
      
      if (amenityId) {
        query += ' AND c.amenityId = @amenityId';
        parameters.push({ name: '@amenityId', value: amenityId });
      }
      
      if (userId) {
        query += ' AND c.userId = @userId';
        parameters.push({ name: '@userId', value: userId });
      }
      
      if (startDate) {
        query += ' AND c.startTime >= @startDate';
        parameters.push({ name: '@startDate', value: startDate });
      }
      
      if (endDate) {
        query += ' AND c.endTime <= @endDate';
        parameters.push({ name: '@endDate', value: endDate });
      }
      
      query += ' ORDER BY c.createdAt DESC';
      
      const reservations = await databaseService.queryItems(this.collectionName, query, parameters);
      
      // Enrich with full data
      const enrichedReservations = await this.enrichReservationsWithFullData(reservations || []);
      
      return enrichedReservations;
    } catch (error) {
      logger.error('Search reservations error:', error);
      return [];
    }
  }
}

module.exports = new ReservationService();