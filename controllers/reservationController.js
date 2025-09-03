// controllers/reservationController.js - ENHANCED VERSION preserving ALL existing functionality

const reservationService = require('../services/reservationService');
const amenityService = require('../services/amenityService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// **NEW: Helper functions for consecutive booking validation**
const isWeekendDay = (date) => {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  return dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6; // Sunday, Friday, Saturday
};

const areConsecutiveWeekendDays = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  // Both must be weekend days
  if (!isWeekendDay(d1) || !isWeekendDay(d2)) return false;
  
  // Get day of week for both dates
  const day1 = d1.getDay();
  const day2 = d2.getDay();
  
  // Check for consecutive combinations
  // Friday (5) -> Saturday (6)
  if ((day1 === 5 && day2 === 6) || (day1 === 6 && day2 === 5)) {
    // Check if they are consecutive days
    const timeDiff = Math.abs(d1.getTime() - d2.getTime());
    return timeDiff === 24 * 60 * 60 * 1000; // 1 day difference
  }
  
  // Friday (5) -> Sunday (0)
  if ((day1 === 5 && day2 === 0) || (day1 === 0 && day2 === 5)) {
    // Check if Sunday is 2 days after Friday
    const timeDiff = Math.abs(d1.getTime() - d2.getTime());
    return timeDiff === 2 * 24 * 60 * 60 * 1000; // 2 day difference
  }
  
  // Saturday (6) -> Sunday (0)
  if ((day1 === 6 && day2 === 0) || (day1 === 0 && day2 === 6)) {
    // Check if they are consecutive days
    const timeDiff = Math.abs(d1.getTime() - d2.getTime());
    return timeDiff === 24 * 60 * 60 * 1000; // 1 day difference
  }
  
  return false;
};

// **NEW: Check for consecutive weekend bookings for the same user**
const checkConsecutiveWeekendBookings = async (userId, amenityId, startTime, excludeReservationId = null) => {
  try {
    // Get user's existing reservations for this amenity
    const userReservations = await reservationService.getUserReservations(userId);
    
    // Filter for the same amenity and active statuses
    const relevantReservations = userReservations.filter(r => 
      r.amenityId === amenityId &&
      ['pending', 'approved', 'confirmed'].includes(r.status) &&
      (!excludeReservationId || r.id !== excludeReservationId)
    );
    
    const newBookingDate = new Date(startTime);
    
    // Check if new booking is on a weekend
    if (!isWeekendDay(newBookingDate)) {
      return { allowed: true }; // Non-weekend bookings are always allowed
    }
    
    // Check each existing reservation for consecutive conflicts
    for (const reservation of relevantReservations) {
      const existingDate = new Date(reservation.startTime);
      
      // Skip if existing reservation is not on a weekend
      if (!isWeekendDay(existingDate)) continue;
      
      // Check if dates are consecutive weekend days
      if (areConsecutiveWeekendDays(newBookingDate, existingDate)) {
        return {
          allowed: false,
          message: 'Cannot book consecutive weekend days. You already have a reservation that conflicts with this request.',
          conflictingReservation: reservation
        };
      }
    }
    
    return { allowed: true };
  } catch (error) {
    logger.error('Error checking consecutive weekend bookings:', error);
    // In case of error, allow the booking but log the issue
    return { allowed: true };
  }
};

class ReservationController {
  // ✅ ENHANCED: Create reservation with consecutive booking validation
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

      // **NEW: Check consecutive weekend bookings for lounge**
      if (isLounge) {
        const consecutiveCheck = await checkConsecutiveWeekendBookings(userId, amenityId, startTime);
        if (!consecutiveCheck.allowed) {
          return res.status(400).json({
            success: false,
            message: consecutiveCheck.message,
            details: 'Consecutive weekend bookings (Friday, Saturday, Sunday) are not allowed for the Community Lounge.'
          });
        }
      }

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
      if (amenity.operatingHours) {
        const { start: openTime, end: closeTime, days } = amenity.operatingHours;
        const startHour = start.getHours();
        const endHour = end.getHours();
        const dayOfWeek = start.getDay();
        
        if (!days.includes(dayOfWeek)) {
          return res.status(400).json({
            success: false,
            message: 'Amenity is not available on this day'
          });
        }

        const [openHour, openMinute] = openTime.split(':').map(Number);
        const [closeHour, closeMinute] = closeTime.split(':').map(Number);
        
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

      // Check time conflicts with existing reservations
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

      // **ENHANCED: Determine approval status with LOUNGE ALWAYS REQUIRING APPROVAL**
      let status = 'pending';
      
      if (isLounge) {
        // **CRITICAL: Lounge ALWAYS requires administrator approval, never auto-approved**
        status = 'pending';
        logger.info(`🏛️ Lounge booking always requires admin approval - status set to pending`);
      } else {
        // For non-lounge amenities, check auto-approval rules
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

      // Create the reservation
      const reservation = await reservationService.createReservation(reservationData);

      // Enrich with user and amenity data
      const enrichedReservation = await reservationService.enrichReservationWithUserData(reservation);

      const message = status === 'approved' 
        ? 'Reservation created and automatically approved'
        : 'Reservation created and submitted for approval';

      logger.info(`✅ Reservation ${reservation.id} created successfully by ${req.user.username}`);

      res.status(201).json({
        success: true,
        message,
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

  // ✅ ENHANCED: Update reservation with consecutive booking validation
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
      const isAdmin = req.user.role === 'admin';

      logger.info(`User ${req.user.username} updating reservation ${id}`);

      // Get existing reservation
      const existingReservation = await reservationService.getReservationById(id);
      if (!existingReservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      // Check ownership
      if (!isAdmin && existingReservation.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only modify your own reservations'
        });
      }

      // Check if reservation can be edited
      const editableStatuses = ['pending', 'approved', 'confirmed'];
      if (!editableStatuses.includes(existingReservation.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot edit reservation with status: ${existingReservation.status}`
        });
      }

      // Validate new time
      const start = new Date(startTime);
      const end = new Date(endTime);
      const now = new Date();

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

      // **NEW: Check consecutive weekend bookings for lounge (excluding current reservation)**
      if (isLounge) {
        const consecutiveCheck = await checkConsecutiveWeekendBookings(userId, finalAmenityId, startTime, id);
        if (!consecutiveCheck.allowed) {
          return res.status(400).json({
            success: false,
            message: consecutiveCheck.message,
            details: 'Consecutive weekend bookings (Friday, Saturday, Sunday) are not allowed for the Community Lounge.'
          });
        }
      }

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
      if (amenity.operatingHours) {
        const { start: openTime, end: closeTime, days } = amenity.operatingHours;
        const startHour = start.getHours();
        const endHour = end.getHours();
        const dayOfWeek = start.getDay();

        if (!days.includes(dayOfWeek)) {
          return res.status(400).json({
            success: false,
            message: 'Amenity is not available on this day'
          });
        }

        const [openHour, openMinute] = openTime.split(':').map(Number);
        const [closeHour, closeMinute] = closeTime.split(':').map(Number);

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

      // Check for time conflicts (excluding current reservation)
      const hasConflict = await reservationService.checkTimeConflict(
        finalAmenityId, 
        startTime, 
        endTime, 
        id
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

  // ✅ PRESERVED: Get user reservations (unchanged)
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

  // ✅ ENHANCED: Get all reservations with improved chronological sorting for admin
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

      // **ENHANCED: Sort by creation date (chronological order) with same-day prioritization**
      reservations.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        
        // For same day reservations, show submission order clearly
        const dayA = new Date(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
        const dayB = new Date(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
        
        if (dayA.getTime() === dayB.getTime()) {
          // Same day - sort by submission time (earliest first)
          return dateA.getTime() - dateB.getTime();
        } else {
          // Different days - most recent day first, but within each day chronological
          return dateB.getTime() - dateA.getTime();
        }
      });

      // **NEW: Add submission order indicators for same-day requests**
      const enrichedReservations = reservations.map((reservation, index) => {
        const sameDayReservations = reservations.filter(r => {
          const rDate = new Date(r.createdAt);
          const currentDate = new Date(reservation.createdAt);
          return rDate.getFullYear() === currentDate.getFullYear() &&
                 rDate.getMonth() === currentDate.getMonth() &&
                 rDate.getDate() === currentDate.getDate();
        });

        if (sameDayReservations.length > 1) {
          // Find the order within the same day
          const dayIndex = sameDayReservations.findIndex(r => r.id === reservation.id);
          return {
            ...reservation,
            submissionOrder: dayIndex + 1,
            totalSameDayRequests: sameDayReservations.length,
            isFirstOfDay: dayIndex === 0,
            isMultipleRequestDay: true
          };
        } else {
          return {
            ...reservation,
            isMultipleRequestDay: false
          };
        }
      });

      // Enrich with user and amenity data
      const fullyEnrichedReservations = await reservationService.enrichReservationsWithFullData(enrichedReservations);

      res.json({
        success: true,
        data: {
          reservations: fullyEnrichedReservations,
          total: fullyEnrichedReservations.length
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

  // ✅ PRESERVED: Get reservation by ID (unchanged)
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

  // ✅ PRESERVED: Cancel reservation (unchanged)
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
      if (reservation.status === 'cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Reservation is already cancelled'
        });
      }

      if (reservation.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel completed reservations'
        });
      }

      // Delete the reservation
      await reservationService.deleteReservation(id);

      logger.info(`✅ Reservation ${id} cancelled successfully by ${req.user.username}`);

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

  // ✅ PRESERVED: Update reservation status (admin only) (unchanged)
  async updateReservationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, adminNotes } = req.body;

      logger.info(`Admin ${req.user.username} updating reservation ${id} status to ${status}`);

      const validStatuses = ['pending', 'approved', 'denied', 'cancelled', 'completed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status'
        });
      }

      const reservation = await reservationService.getReservationById(id);
      if (!reservation) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found'
        });
      }

      // Update reservation status
      const updateData = {
        status,
        updatedAt: new Date().toISOString()
      };

      if (adminNotes) {
        updateData.adminNotes = adminNotes;
      }

      const updatedReservation = await reservationService.updateReservation(id, updateData);
      const enrichedReservation = await reservationService.enrichReservationWithUserData(updatedReservation);

      logger.info(`✅ Reservation ${id} status updated to ${status} by admin ${req.user.username}`);

      res.json({
        success: true,
        message: 'Reservation status updated successfully',
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

  // ✅ PRESERVED: Get available slots (unchanged)
  async getAvailableSlots(req, res) {
    try {
      const { amenityId, date, duration } = req.query;

      if (!amenityId || !date) {
        return res.status(400).json({
          success: false,
          message: 'Amenity ID and date are required'
        });
      }

      logger.info(`Getting available slots for amenity ${amenityId} on ${date}`);

      const slots = await reservationService.getAvailableSlots(
        amenityId, 
        date, 
        parseInt(duration) || 60
      );

      res.json({
        success: true,
        data: {
          slots,
          total: slots.length
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

  // ✅ PRESERVED: Get reservations by amenity (admin only) (unchanged)
  async getReservationsByAmenity(req, res) {
    try {
      const { amenityId } = req.params;
      const { startDate, endDate } = req.query;

      logger.info(`Admin ${req.user.username} getting reservations for amenity ${amenityId}`);

      const filters = { amenityId };
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const reservations = await reservationService.searchReservations(filters);

      res.json({
        success: true,
        data: {
          reservations,
          total: reservations.length
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
}

module.exports = new ReservationController();