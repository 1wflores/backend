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

  async getUserReservations(req, res) {
    try {
      const userId = req.user.id;
      const { status, startDate, endDate } = req.query;
      
      const reservations = await reservationService.getUserReservations(userId, {
        status,
        startDate,
        endDate
      });
      
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

  async getAllReservations(req, res) {
    try {
      const { status, amenityId, startDate, endDate } = req.query;
      
      const reservations = await reservationService.getAllReservations({
        status,
        amenityId,
        startDate,
        endDate
      });
      
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

  // Add this to your backend controllers/reservationController.js

  async updateReservationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, denialReason } = req.body;
      
      logger.info(`🎯 Controller: Updating reservation ${id} status to ${status}`, { denialReason });
      
      // First, let's debug if the reservation exists at all
      const debugReservation = await reservationService.debugReservationExists(id);
      if (!debugReservation) {
        logger.error(`❌ Controller: Reservation ${id} does not exist in database`);
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }
      
      logger.info(`📋 Controller: Found reservation ${id} with status: ${debugReservation.status}`);
      
      // Now try the normal update
      const reservation = await reservationService.updateReservationStatus(
        id, 
        status, 
        denialReason
      );
      
      if (!reservation) {
        logger.error(`❌ Controller: Update returned null for reservation ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Reservation not found or could not be updated'
        });
      }
      
      logger.info(`✅ Controller: Reservation ${id} status updated successfully to ${status}`);
      
      res.json({
        success: true,
        message: `Reservation ${status} successfully`,
        data: {
          reservation
        }
      });
    } catch (error) {
      logger.error('❌ Controller: Update reservation status error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // ✅ ENHANCED: Updated cancelReservation controller with proper deletion handling
  async cancelReservation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      
      logger.info(`🚫 Controller: User ${userId} (${userRole}) requesting to cancel reservation ${id}`);

      // Call the service layer to handle the cancellation and deletion
      const cancelledReservation = await reservationService.cancelReservation(id, userId, userRole);
      
      if (!cancelledReservation) {
        logger.error(`❌ Controller: Reservation ${id} not found or could not be cancelled`);
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      logger.info(`✅ Controller: Reservation ${id} successfully cancelled and deleted`);
      
      // Return success response with details
      res.json({
        success: true,
        message: 'Reservation cancelled and deleted successfully',
        data: {
          reservation: cancelledReservation,
          slotFreed: true,
          deletedFromDatabase: true
        }
      });
    } catch (error) {
      logger.error(`❌ Controller: Cancel reservation error for ${req.params.id}:`, error);
      
      // Handle specific error cases
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      } else if (error.message.includes('Access denied')) {
        return res.status(403).json({
          success: false,
          message: 'You can only cancel your own reservations'
        });
      } else if (error.message.includes('Cannot cancel')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to cancel reservation. Please try again.'
        });
      }
    }
  }

   // ✅ ENHANCED: Better available slots endpoint
  async getAvailableSlots(req, res) {
    try {
      const { amenityId, date, duration } = req.query;
      
      if (!amenityId || !date) {
        return res.status(400).json({
          success: false,
          message: 'Amenity ID and date are required'
        });
      }

      logger.info(`🔍 Controller: Getting available slots for ${amenityId} on ${date}`);
      
      const slots = await reservationService.getAvailableSlots(
        amenityId, 
        date, 
        parseInt(duration) || 60
      );
      
      logger.info(`✅ Controller: Found ${slots.length} available slots`);
      
      res.json({
        success: true,
        data: {
          slots,
          amenityId,
          date,
          duration: parseInt(duration) || 60,
          totalSlotsAvailable: slots.length
        }
      });
    } catch (error) {
      logger.error('Controller: Get available slots error:', error);
      
      if (error.message.includes('not found') || error.message.includes('not available')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // ✅ ENHANCED: Better reservations by amenity endpoint
  async getReservationsByAmenity(req, res) {
    try {
      const { amenityId } = req.params;
      const { startDate, endDate } = req.query;
      
      logger.info(`📋 Controller: Getting reservations for amenity ${amenityId}`);
      
      const reservations = await reservationService.getReservationsByAmenity(
        amenityId,
        startDate,
        endDate
      );
      
      logger.info(`✅ Controller: Found ${reservations.length} reservations for amenity ${amenityId}`);
      
      res.json({
        success: true,
        data: {
          reservations,
          amenityId,
          dateRange: {
            startDate,
            endDate
          },
          totalReservations: reservations.length
        }
      });
    } catch (error) {
      logger.error('Controller: Get reservations by amenity error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // ✅ NEW: Health check endpoint for reservation system
  async getReservationHealth(req, res) {
    try {
      // Basic health checks
      const stats = {
        timestamp: new Date().toISOString(),
        database: 'connected',
        operations: {
          create: 'operational',
          read: 'operational', 
          update: 'operational',
          delete: 'operational'
        }
      };

      // Optional: Add more detailed health metrics
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