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

  // ✅ FIXED: Added the missing updateReservationStatus method
  async updateReservationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, denialReason } = req.body;
      
      logger.info(`Updating reservation ${id} status to ${status}`, { denialReason });
      
      const reservation = await reservationService.updateReservationStatus(
        id, 
        status, 
        denialReason
      );
      
      if (!reservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }
      
      logger.info(`Reservation ${id} status updated successfully to ${status}`);
      
      res.json({
        success: true,
        message: `Reservation ${status} successfully`,
        data: {
          reservation
        }
      });
    } catch (error) {
      logger.error('Update reservation status error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async cancelReservation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      
      const reservation = await reservationService.cancelReservation(id, userId, userRole);
      
      if (!reservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Reservation cancelled successfully',
        data: {
          reservation
        }
      });
    } catch (error) {
      logger.error('Cancel reservation error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async getAvailableSlots(req, res) {
    try {
      const { amenityId, date } = req.query;
      
      if (!amenityId || !date) {
        return res.status(400).json({
          success: false,
          message: 'Amenity ID and date are required'
        });
      }
      
      const slots = await reservationService.getAvailableSlots(amenityId, date);
      
      res.json({
        success: true,
        data: {
          slots
        }
      });
    } catch (error) {
      logger.error('Get available slots error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async getReservationsByAmenity(req, res) {
    try {
      const { amenityId } = req.params;
      const { startDate, endDate } = req.query;
      
      const reservations = await reservationService.getReservationsByAmenity(
        amenityId,
        startDate,
        endDate
      );
      
      res.json({
        success: true,
        data: {
          reservations
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
}

module.exports = new ReservationController();