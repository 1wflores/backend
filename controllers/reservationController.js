const reservationService = require('../services/reservationService');
const logger = require('../utils/logger');

class ReservationController {
  async createReservation(req, res) {
    try {
      const userId = req.user.id;
      const reservationData = {
        ...req.body,
        userId
      };
      
      const reservation = await reservationService.createReservation(reservationData);
      
      res.status(201).json({
        success: true,
        message: 'Reservation created successfully',
        data: {
          reservation
        }
      });
    } catch (error) {
      logger.error('Create reservation error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // ✅ UPDATED: Enhanced getUserReservations with user role filtering
  async getUserReservations(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { status, startDate, endDate, limit } = req.query;
      
      logger.info(`Getting reservations for user ${userId} (role: ${userRole})`, {
        status,
        startDate,
        endDate,
        limit
      });

      const reservations = await reservationService.getUserReservations(userId, {
        status,
        startDate,
        endDate,
        limit: limit ? parseInt(limit) : 50,
        userRole // ✅ NEW: Pass user role to service for filtering
      });
      
      logger.info(`Returning ${reservations.length} reservations for user ${userId}`);
      
      res.json({
        success: true,
        data: {
          reservations
        }
      });
    } catch (error) {
      logger.error('Get user reservations error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // ✅ UPDATED: Enhanced getAllReservations (admin only)
  async getAllReservations(req, res) {
    try {
      const { status, amenityId, startDate, endDate, limit } = req.query;
      
      logger.info(`Admin ${req.user.username} fetching all reservations`, {
        status,
        amenityId,
        startDate,
        endDate,
        limit
      });

      const reservations = await reservationService.getAllReservations({
        status,
        amenityId,
        startDate,
        endDate,
        limit: limit ? parseInt(limit) : 100
      });
      
      logger.info(`Returning ${reservations.length} total reservations to admin`);

      res.json({
        success: true,
        data: {
          reservations
        }
      });
    } catch (error) {
      logger.error('Get all reservations error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async getReservationById(req, res) {
    try {
      const { id } = req.params;
      const reservation = await reservationService.getReservationById(id);
      
      if (!reservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      // Check if user has permission to view this reservation
      if (req.user.role !== 'admin' && reservation.userId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      res.json({
        success: true,
        data: {
          reservation
        }
      });
    } catch (error) {
      logger.error('Get reservation by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // ✅ UPDATED: Enhanced cancelReservation with proper user role handling
  async cancelReservation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      logger.info(`User ${userId} (role: ${userRole}) cancelling reservation ${id}`);

      const result = await reservationService.cancelReservation(id, userId, userRole);

      res.json({
        success: true,
        message: 'Reservation cancelled successfully',
        data: result
      });
    } catch (error) {
      logger.error('Cancel reservation error:', error);
      
      // Handle specific error cases
      if (error.message === 'Reservation not found') {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      } else if (error.message.includes('Access denied') || error.message.includes('Cannot cancel')) {
        return res.status(403).json({
          success: false,
          message: error.message
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to cancel reservation'
        });
      }
    }
  }

  async updateReservationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, denialReason } = req.body;
      
      logger.info(`🎯 Controller: Updating reservation ${id} status to ${status}`, { denialReason });
      
      // Validate status
      const validStatuses = ['approved', 'denied', 'cancelled', 'completed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }

      // Require denial reason for denied status
      if (status === 'denied' && !denialReason) {
        return res.status(400).json({
          success: false,
          message: 'Denial reason is required when denying a reservation'
        });
      }

      const updatedReservation = await reservationService.updateReservationStatus(
        id, 
        status, 
        denialReason
      );

      if (!updatedReservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      logger.info(`✅ Successfully updated reservation ${id} status to ${status}`);

      res.json({
        success: true,
        message: `Reservation ${status} successfully`,
        data: {
          reservation: updatedReservation
        }
      });
    } catch (error) {
      logger.error('Update reservation status error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update reservation status'
      });
    }
  }

  // ✅ UPDATED: Enhanced getAvailableSlots
  async getAvailableSlots(req, res) {
    try {
      const { amenityId, date, duration } = req.query;
      
      if (!amenityId || !date) {
        return res.status(400).json({
          success: false,
          message: 'Amenity ID and date are required'
        });
      }

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          success: false,
          message: 'Date must be in YYYY-MM-DD format'
        });
      }

      const durationMinutes = duration ? parseInt(duration) : 60;

      logger.info(`Getting available slots for amenity ${amenityId} on ${date} (${durationMinutes}min)`);

      const slots = await reservationService.getAvailableSlots(amenityId, date, durationMinutes);

      res.json({
        success: true,
        data: {
          slots,
          amenityId,
          date,
          durationMinutes
        }
      });
    } catch (error) {
      logger.error('Get available slots error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get available slots'
      });
    }
  }

  // ✅ UPDATED: Enhanced getReservationsByAmenity (admin only)
  async getReservationsByAmenity(req, res) {
    try {
      const { amenityId } = req.params;
      const { startDate, endDate } = req.query;

      logger.info(`Admin ${req.user.username} getting reservations for amenity ${amenityId}`, {
        startDate,
        endDate
      });

      // Default to current month if no dates provided
      const now = new Date();
      const defaultStartDate = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const defaultEndDate = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      const reservations = await reservationService.getReservationsByAmenity(
        amenityId,
        defaultStartDate,
        defaultEndDate
      );

      res.json({
        success: true,
        data: {
          reservations,
          amenityId,
          dateRange: {
            startDate: defaultStartDate,
            endDate: defaultEndDate
          }
        }
      });
    } catch (error) {
      logger.error('Get reservations by amenity error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // ✅ NEW: Health check endpoint for reservation system
  async getReservationHealth(req, res) {
    try {
      const stats = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'reservation-system'
      };

      // Add detailed stats for admin users
      if (req.query.detailed === 'true' && req.user.role === 'admin') {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        try {
          const todayReservations = await reservationService.getAllReservations({
            startDate: todayStart.toISOString(),
            endDate: todayEnd.toISOString()
          });

          stats.todayStats = {
            totalReservations: todayReservations.length,
            byStatus: {
              pending: todayReservations.filter(r => r.status === 'pending').length,
              approved: todayReservations.filter(r => r.status === 'approved').length,
              cancelled: todayReservations.filter(r => r.status === 'cancelled').length,
              denied: todayReservations.filter(r => r.status === 'denied').length
            }
          };
        } catch (error) {
          logger.warn('Could not fetch detailed health stats:', error);
          stats.todayStats = 'unavailable';
        }
      }

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Controller: Reservation health check error:', error);
      res.status(500).json({
        success: false,
        message: 'Health check failed',
        error: error.message
      });
    }
  }
}

module.exports = new ReservationController();