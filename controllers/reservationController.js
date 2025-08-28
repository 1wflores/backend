// controllers/reservationController.js - COMPLETE FILE

const reservationService = require('../services/reservationService');
const amenityService = require('../services/amenityService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class ReservationController {
  // ✅ Create reservation with lounge support
  async createReservation(req, res) {
    try {
      const { 
        amenityId, 
        startTime, 
        endTime, 
        notes, 
        specialRequests,
        visitorCount,
        willUseGrill 
      } = req.body;
      const userId = req.user.id;

      logger.info(`User ${req.user.username} creating reservation for amenity ${amenityId}`);

      // Validate required fields
      if (!amenityId || !startTime || !endTime) {
        return res.status(400).json({
          success: false,
          message: 'Amenity ID, start time, and end time are required'
        });
      }

      // Validate time format and logic
      const start = new Date(startTime);
      const end = new Date(endTime);
      const now = new Date();

      if (start < now) {
        return res.status(400).json({
          success: false,
          message: 'Cannot create reservations in the past'
        });
      }

      if (end <= start) {
        return res.status(400).json({
          success: false,
          message: 'End time must be after start time'
        });
      }

      // Get amenity details to check if it's a lounge
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        return res.status(404).json({
          success: false,
          message: 'Amenity not found'
        });
      }

      if (!amenity.isActive) {
        return res.status(400).json({
          success: false,
          message: 'This amenity is currently unavailable'
        });
      }

      // Check if it's a lounge based on type or name
      const isLounge = amenity.type === 'lounge' || 
                      amenity.name?.toLowerCase().includes('lounge');

      // Validate lounge-specific fields
      if (isLounge) {
        // Use maxVisitors from specialRequirements or capacity as fallback
        const maxCapacity = amenity.specialRequirements?.maxVisitors || amenity.capacity || 20;
        
        if (visitorCount) {
          if (visitorCount < 1 || visitorCount > maxCapacity) {
            return res.status(400).json({
              success: false,
              message: `Visitor count must be between 1 and ${maxCapacity}`
            });
          }
        }

        // Validate grill usage if it's provided
        if (willUseGrill !== undefined && typeof willUseGrill !== 'boolean') {
          return res.status(400).json({
            success: false,
            message: 'Grill usage must be a boolean value'
          });
        }
      }

      // Check operating hours
      const startHour = start.getHours();
      const endHour = end.getHours();
      const dayOfWeek = start.getDay();

      if (amenity.operatingHours) {
        const { start: openTime, end: closeTime, days } = amenity.operatingHours;
        const [openHour, openMinute] = openTime.split(':').map(Number);
        const [closeHour, closeMinute] = closeTime.split(':').map(Number);

        if (!days.includes(dayOfWeek)) {
          return res.status(400).json({
            success: false,
            message: 'Amenity is not available on this day'
          });
        }

        const startMinutes = startHour * 60 + start.getMinutes();
        const endMinutes = endHour * 60 + end.getMinutes();
        const openMinutes = openHour * 60 + openMinute;
        const closeMinutes = closeHour * 60 + closeMinute;

        if (startMinutes < openMinutes || endMinutes > closeMinutes) {
          return res.status(400).json({
            success: false,
            message: `Amenity is only available from ${openTime} to ${closeTime}`
          });
        }
      }

      // Check for time conflicts
      const hasConflict = await reservationService.checkTimeConflict(
        amenityId,
        startTime,
        endTime
      );

      if (hasConflict) {
        return res.status(409).json({
          success: false,
          message: 'The selected time slot is no longer available'
        });
      }

      // Check auto-approval rules
      let status = 'pending';
      if (amenity.autoApprovalRules) {
        const duration = (end - start) / (1000 * 60); // Duration in minutes
        const hoursUntilReservation = (start - now) / (1000 * 60 * 60);
        
        const meetsAutoApproval = 
          duration <= (amenity.autoApprovalRules.maxDurationMinutes || 240) &&
          hoursUntilReservation >= (amenity.autoApprovalRules.advanceBookingHours || 0);
        
        if (meetsAutoApproval) {
          status = 'approved';
        }
      } else if (!amenity.requiresApproval) {
        status = 'approved';
      }

      // Create reservation data
      const reservationData = {
        id: uuidv4(),
        userId,
        amenityId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status,
        notes: notes || specialRequests || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Add lounge-specific fields
      if (isLounge) {
        reservationData.visitorCount = visitorCount || 1;
        reservationData.willUseGrill = willUseGrill || false;
      }

      // Save reservation
      const reservation = await reservationService.createReservation(reservationData);

      // Enrich with user data
      const enrichedReservation = await reservationService.enrichReservationWithUserData(reservation);

      logger.info(`✅ Reservation ${reservation.id} created successfully`);

      res.status(201).json({
        success: true,
        message: status === 'approved' 
          ? 'Reservation confirmed' 
          : 'Reservation created and pending approval',
        data: {
          reservation: enrichedReservation
        }
      });
    } catch (error) {
      logger.error('Create reservation error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create reservation'
      });
    }
  }

  // ✅ Update reservation with lounge support
  async updateReservation(req, res) {
    try {
      const { id } = req.params;
      const { 
        amenityId, 
        startTime, 
        endTime, 
        notes, 
        specialRequests,
        visitorCount,
        willUseGrill
      } = req.body;
      const userId = req.user.id;

      logger.info(`User ${req.user.username} attempting to update reservation ${id}`);

      // Validate required fields
      if (!startTime || !endTime) {
        return res.status(400).json({
          success: false,
          message: 'Start time and end time are required'
        });
      }

      // Get existing reservation
      const existingReservation = await reservationService.getReservationById(id);
      
      if (!existingReservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      // Check ownership (only owner can update their reservation)
      if (existingReservation.userId !== userId && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own reservations'
        });
      }

      // Check if reservation is in the future
      const now = new Date();
      const reservationStart = new Date(existingReservation.startTime);
      if (reservationStart < now) {
        return res.status(400).json({
          success: false,
          message: 'Cannot edit past reservations'
        });
      }

      // Check if reservation status allows editing
      const editableStatuses = ['pending', 'approved', 'confirmed'];
      if (!editableStatuses.includes(existingReservation.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot edit reservation with status: ${existingReservation.status}`
        });
      }

      // Validate new times
      const start = new Date(startTime);
      const end = new Date(endTime);

      if (start < now) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update reservation to a past time'
        });
      }

      if (end <= start) {
        return res.status(400).json({
          success: false,
          message: 'End time must be after start time'
        });
      }

      // Get amenity details
      const finalAmenityId = amenityId || existingReservation.amenityId;
      const amenity = await amenityService.getAmenityById(finalAmenityId);
      
      if (!amenity) {
        return res.status(404).json({
          success: false,
          message: 'Amenity not found'
        });
      }

      // Check if it's a lounge
      const isLounge = amenity.type === 'lounge' || 
                      amenity.name?.toLowerCase().includes('lounge');

      // Validate lounge-specific fields
      if (isLounge && visitorCount !== undefined) {
        const maxCapacity = amenity.specialRequirements?.maxVisitors || amenity.capacity || 20;
        if (visitorCount < 1 || visitorCount > maxCapacity) {
          return res.status(400).json({
            success: false,
            message: `Visitor count must be between 1 and ${maxCapacity}`
          });
        }
      }

      // Check operating hours for new time
      const startHour = start.getHours();
      const endHour = end.getHours();
      const dayOfWeek = start.getDay();

      if (amenity.operatingHours) {
        const { start: openTime, end: closeTime, days } = amenity.operatingHours;
        const [openHour, openMinute] = openTime.split(':').map(Number);
        const [closeHour, closeMinute] = closeTime.split(':').map(Number);

        if (!days.includes(dayOfWeek)) {
          return res.status(400).json({
            success: false,
            message: 'Amenity is not available on this day'
          });
        }

        const startMinutes = startHour * 60 + start.getMinutes();
        const endMinutes = endHour * 60 + end.getMinutes();
        const openMinutes = openHour * 60 + openMinute;
        const closeMinutes = closeHour * 60 + closeMinute;

        if (startMinutes < openMinutes || endMinutes > closeMinutes) {
          return res.status(400).json({
            success: false,
            message: `Amenity is only available from ${openTime} to ${closeTime}`
          });
        }
      }

      // Validate new time slot doesn't conflict with other reservations
      // (excluding the current reservation being edited)
      const hasConflict = await reservationService.checkTimeConflict(
        finalAmenityId,
        startTime,
        endTime,
        id // Exclude current reservation from conflict check
      );

      if (hasConflict) {
        return res.status(409).json({
          success: false,
          message: 'The selected time slot is no longer available'
        });
      }

      // Prepare update data
      const updateData = {
        amenityId: finalAmenityId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        notes: notes || specialRequests || existingReservation.notes || '',
        updatedAt: new Date().toISOString(),
        status: existingReservation.status // Keep the same status
      };

      // Add lounge-specific fields if applicable
      if (isLounge) {
        updateData.visitorCount = visitorCount !== undefined ? visitorCount : existingReservation.visitorCount || 1;
        updateData.willUseGrill = willUseGrill !== undefined ? willUseGrill : existingReservation.willUseGrill || false;
      }

      // Update the reservation
      const updatedReservation = await reservationService.updateReservation(id, updateData);

      // Enrich with user data
      const enrichedReservation = await reservationService.enrichReservationWithUserData(updatedReservation);

      logger.info(`✅ Reservation ${id} updated successfully by ${req.user.username}`);

      res.json({
        success: true,
        message: 'Reservation updated successfully',
        data: {
          reservation: enrichedReservation
        }
      });
    } catch (error) {
      logger.error('Update reservation error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update reservation'
      });
    }
  }

  // ✅ Get user reservations
  async getUserReservations(req, res) {
    try {
      const userId = req.user.id;
      const { status, upcoming } = req.query;

      logger.info(`Getting reservations for user ${req.user.username}`);

      let reservations = await reservationService.getUserReservations(userId);

      // Filter by status if provided
      if (status) {
        reservations = reservations.filter(r => r.status === status);
      }

      // Filter upcoming if requested
      if (upcoming === 'true') {
        const now = new Date();
        reservations = reservations.filter(r => new Date(r.startTime) > now);
      }

      // Sort by start time (most recent first)
      reservations.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      // Enrich with amenity data
      const enrichedReservations = await reservationService.enrichReservationsWithAmenityData(reservations);

      res.json({
        success: true,
        data: {
          reservations: enrichedReservations,
          total: enrichedReservations.length
        }
      });
    } catch (error) {
      logger.error('Get user reservations error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get reservations'
      });
    }
  }

  // ✅ Get all reservations (admin only)
  async getAllReservations(req, res) {
    try {
      const { status, amenityId, userId, startDate, endDate } = req.query;

      logger.info(`Admin ${req.user.username} getting all reservations`);

      let reservations = await reservationService.getAllReservations();

      // Apply filters
      if (status) {
        reservations = reservations.filter(r => r.status === status);
      }

      if (amenityId) {
        reservations = reservations.filter(r => r.amenityId === amenityId);
      }

      if (userId) {
        reservations = reservations.filter(r => r.userId === userId);
      }

      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : new Date('2000-01-01');
        const end = endDate ? new Date(endDate) : new Date('2100-01-01');
        reservations = reservations.filter(r => {
          const resStart = new Date(r.startTime);
          return resStart >= start && resStart <= end;
        });
      }

      // Sort by start time (most recent first)
      reservations.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      // Enrich with user and amenity data
      const enrichedReservations = await reservationService.enrichReservationsWithFullData(reservations);

      res.json({
        success: true,
        data: {
          reservations: enrichedReservations,
          total: enrichedReservations.length
        }
      });
    } catch (error) {
      logger.error('Get all reservations error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get reservations'
      });
    }
  }

  // ✅ Get reservation by ID
  async getReservationById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';

      logger.info(`Getting reservation ${id} for user ${req.user.username}`);

      const reservation = await reservationService.getReservationById(id);

      if (!reservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      // Check access rights
      if (!isAdmin && reservation.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Enrich with full data
      const enrichedReservation = await reservationService.enrichReservationWithFullData(reservation);

      res.json({
        success: true,
        data: {
          reservation: enrichedReservation
        }
      });
    } catch (error) {
      logger.error('Get reservation by ID error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get reservation'
      });
    }
  }

  // ✅ Cancel reservation
  async cancelReservation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';

      logger.info(`User ${req.user.username} attempting to cancel reservation ${id}`);

      const reservation = await reservationService.getReservationById(id);

      if (!reservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      // Check ownership
      if (!isAdmin && reservation.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only cancel your own reservations'
        });
      }

      // Check if reservation can be cancelled
      const cancellableStatuses = ['pending', 'approved', 'confirmed'];
      if (!cancellableStatuses.includes(reservation.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel reservation with status: ${reservation.status}`
        });
      }

      // Delete the reservation
      await reservationService.deleteReservation(id);

      logger.info(`✅ Reservation ${id} cancelled successfully`);

      res.json({
        success: true,
        message: 'Reservation cancelled successfully'
      });
    } catch (error) {
      logger.error('Cancel reservation error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to cancel reservation'
      });
    }
  }

  // ✅ Update reservation status (admin only)
  async updateReservationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, denialReason } = req.body;

      logger.info(`Admin ${req.user.username} updating status of reservation ${id} to ${status}`);

      const validStatuses = ['approved', 'denied', 'cancelled'];
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

      // Enrich with full data
      const enrichedReservation = await reservationService.enrichReservationWithFullData(updatedReservation);

      logger.info(`✅ Successfully updated reservation ${id} status to ${status}`);

      res.json({
        success: true,
        message: `Reservation ${status} successfully`,
        data: {
          reservation: enrichedReservation
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

  // ✅ Get available slots
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

  // ✅ Get reservations by amenity (admin only)
  async getReservationsByAmenity(req, res) {
    try {
      const { amenityId } = req.params;
      const { startDate, endDate } = req.query;

      logger.info(`Admin ${req.user.username} getting reservations for amenity ${amenityId}`);

      // Default to current month if no dates provided
      const now = new Date();
      const defaultStartDate = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const defaultEndDate = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      const reservations = await reservationService.getReservationsByAmenity(
        amenityId, 
        defaultStartDate, 
        defaultEndDate
      );

      // Enrich with user data
      const enrichedReservations = await reservationService.enrichReservationsWithUserData(reservations);

      res.json({
        success: true,
        data: {
          reservations: enrichedReservations,
          total: enrichedReservations.length
        }
      });
    } catch (error) {
      logger.error('Get reservations by amenity error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get reservations'
      });
    }
  }

  // ✅ Health check
  async getReservationHealth(req, res) {
    try {
      const health = await reservationService.getSystemHealth();
      
      res.json({
        success: true,
        data: health
      });
    } catch (error) {
      logger.error('Health check error:', error);
      res.status(500).json({
        success: false,
        message: 'Health check failed'
      });
    }
  }
}

module.exports = new ReservationController();