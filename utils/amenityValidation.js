// utils/amenityValidation.js - Centralized validation logic for amenity bookings

const reservationService = require('../services/reservationService');
const amenityService = require('../services/amenityService');
const logger = require('./logger');

class AmenityValidationUtils {
  
  /**
   * Check if an amenity is a lounge
   */
  static isLounge(amenity) {
    return amenity.type === 'lounge' || 
           (amenity.name && amenity.name.toLowerCase().includes('lounge'));
  }

  /**
   * Check if a date is a weekend day (Friday, Saturday, or Sunday)
   */
  static isWeekendDay(date) {
    const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    return dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6; // Sunday, Friday, Saturday
  }

  /**
   * Check if two dates are consecutive weekend days
   */
  static areConsecutiveWeekendDays(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    
    // Both must be weekend days
    if (!this.isWeekendDay(d1) || !this.isWeekendDay(d2)) return false;
    
    // Normalize dates to compare only the date part
    const day1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const day2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    
    const dayOfWeek1 = day1.getDay();
    const dayOfWeek2 = day2.getDay();
    
    // Calculate time difference in days
    const timeDiff = Math.abs(day1.getTime() - day2.getTime());
    const daysDiff = timeDiff / (24 * 60 * 60 * 1000);
    
    // Check for consecutive combinations
    if (daysDiff === 1) {
      // One day apart - check Friday->Saturday or Saturday->Sunday
      return (dayOfWeek1 === 5 && dayOfWeek2 === 6) || 
             (dayOfWeek1 === 6 && dayOfWeek2 === 5) ||
             (dayOfWeek1 === 6 && dayOfWeek2 === 0) ||
             (dayOfWeek1 === 0 && dayOfWeek2 === 6);
    } else if (daysDiff === 2) {
      // Two days apart - check Friday->Sunday
      return (dayOfWeek1 === 5 && dayOfWeek2 === 0) || 
             (dayOfWeek1 === 0 && dayOfWeek2 === 5);
    }
    
    return false;
  }

  /**
   * Get all weekend days within a date range
   */
  static getWeekendDaysInRange(startDate, endDate) {
    const weekendDays = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      if (this.isWeekendDay(current)) {
        weekendDays.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }
    
    return weekendDays;
  }

  /**
   * Validate consecutive weekend booking restrictions
   */
  static async validateConsecutiveWeekendBooking(userId, amenityId, newBookingDate, excludeReservationId = null) {
    try {
      logger.info(`🔍 Validating consecutive weekend booking for user ${userId}, amenity ${amenityId}`);
      
      // Get amenity to check if it's a lounge
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        return { valid: false, message: 'Amenity not found' };
      }

      // Only apply consecutive booking restrictions to lounges
      if (!this.isLounge(amenity)) {
        logger.info('✅ Non-lounge amenity - consecutive booking restrictions do not apply');
        return { valid: true };
      }

      // Check if the new booking is on a weekend
      const bookingDate = new Date(newBookingDate);
      if (!this.isWeekendDay(bookingDate)) {
        logger.info('✅ Non-weekend booking - consecutive restrictions do not apply');
        return { valid: true };
      }

      // Get user's existing lounge reservations (active statuses only)
      const existingReservations = await reservationService.getUserReservations(userId, {
        amenityId,
        status: ['pending', 'approved', 'confirmed'],
        excludeId: excludeReservationId,
        includePastReservations: false // Only check future reservations
      });

      logger.info(`📋 Found ${existingReservations.length} existing reservations to check`);

      // Check each existing reservation for consecutive conflicts
      for (const reservation of existingReservations) {
        const existingDate = new Date(reservation.startTime);
        
        // Skip if existing reservation is not on a weekend
        if (!this.isWeekendDay(existingDate)) continue;
        
        // Check if dates are consecutive weekend days
        if (this.areConsecutiveWeekendDays(bookingDate, existingDate)) {
          const conflictMessage = this.getConsecutiveBookingErrorMessage(bookingDate, existingDate);
          
          logger.warn(`❌ Consecutive weekend booking conflict detected`);
          return {
            valid: false,
            message: 'Cannot book consecutive weekend days for the Community Lounge',
            details: conflictMessage,
            conflictingReservation: {
              id: reservation.id,
              date: existingDate.toDateString(),
              time: `${this.formatTime(existingDate)} - ${this.formatTime(new Date(reservation.endTime))}`
            }
          };
        }
      }

      logger.info('✅ No consecutive weekend booking conflicts found');
      return { valid: true };

    } catch (error) {
      logger.error('Error validating consecutive weekend booking:', error);
      // In case of error, allow the booking but log the issue
      return { 
        valid: true, 
        warning: 'Unable to validate consecutive booking restrictions - proceeding with caution'
      };
    }
  }

  /**
   * Generate a user-friendly error message for consecutive booking conflicts
   */
  static getConsecutiveBookingErrorMessage(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const day1Name = dayNames[d1.getDay()];
    const day2Name = dayNames[d2.getDay()];
    
    const earlierDate = d1 < d2 ? d1 : d2;
    const laterDate = d1 < d2 ? d2 : d1;
    const earlierDay = dayNames[earlierDate.getDay()];
    const laterDay = dayNames[laterDate.getDay()];
    
    return `You already have a reservation on ${earlierDay}. ` +
           `Consecutive weekend bookings (${earlierDay} + ${laterDay}) are not allowed for the Community Lounge.`;
  }

  /**
   * Validate amenity approval requirements
   */
  static validateApprovalRequirements(amenity, reservationData) {
    const isLounge = this.isLounge(amenity);
    
    // **CRITICAL RULE: Lounge ALWAYS requires administrator approval**
    if (isLounge) {
      logger.info('🏛️ Lounge booking detected - forcing admin approval requirement');
      return {
        requiresApproval: true,
        status: 'pending',
        reason: 'Community Lounge bookings always require administrator approval'
      };
    }

    // For non-lounge amenities, check auto-approval rules
    if (amenity.autoApprovalRules) {
      const { startTime, endTime } = reservationData;
      const start = new Date(startTime);
      const end = new Date(endTime);
      const now = new Date();

      const duration = (end - start) / (1000 * 60); // Duration in minutes
      const hoursUntilReservation = (start - now) / (1000 * 60 * 60);
      
      const meetsAutoApproval = 
        duration <= (amenity.autoApprovalRules.maxDurationMinutes || 240) &&
        hoursUntilReservation >= (amenity.autoApprovalRules.advanceBookingHours || 0);
      
      if (meetsAutoApproval) {
        return {
          requiresApproval: false,
          status: 'approved',
          reason: 'Meets auto-approval criteria'
        };
      } else {
        return {
          requiresApproval: true,
          status: 'pending',
          reason: 'Does not meet auto-approval criteria'
        };
      }
    }

    // Check explicit requiresApproval flag
    if (amenity.requiresApproval === false) {
      return {
        requiresApproval: false,
        status: 'approved',
        reason: 'Amenity does not require approval'
      };
    }

    // Default to requiring approval
    return {
      requiresApproval: true,
      status: 'pending',
      reason: 'Default: requires administrator approval'
    };
  }

  /**
   * Validate lounge-specific requirements
   */
  static validateLoungeRequirements(amenity, reservationData) {
    const errors = [];
    
    if (!this.isLounge(amenity)) {
      return { valid: true, errors: [] };
    }

    const { visitorCount, willUseGrill, startTime } = reservationData;

    // Validate visitor count
    if (visitorCount !== undefined) {
      const maxCapacity = amenity.specialRequirements?.maxVisitors || amenity.capacity || 20;
      
      if (!Number.isInteger(visitorCount) || visitorCount < 1 || visitorCount > maxCapacity) {
        errors.push(`Visitor count must be between 1 and ${maxCapacity}`);
      }
    }

    // Validate grill usage
    if (willUseGrill !== undefined && typeof willUseGrill !== 'boolean') {
      errors.push('Grill usage must be specified as true or false');
    }

    // Validate advance booking requirement
    if (startTime) {
      const bookingTime = new Date(startTime);
      const now = new Date();
      const hoursInAdvance = (bookingTime - now) / (1000 * 60 * 60);
      
      const requiredAdvanceHours = amenity.specialRequirements?.advanceBookingHours || 24;
      
      if (hoursInAdvance < requiredAdvanceHours) {
        errors.push(`Lounge bookings require at least ${requiredAdvanceHours} hours advance notice`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate operating hours
   */
  static validateOperatingHours(amenity, startTime, endTime) {
    if (!amenity.operatingHours) {
      return { valid: true };
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const dayOfWeek = start.getDay();

    const { start: openTime, end: closeTime, days } = amenity.operatingHours;
    
    // Check if amenity is open on this day
    if (!days.includes(dayOfWeek)) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return {
        valid: false,
        message: `${amenity.name} is not available on ${dayNames[dayOfWeek]}`
      };
    }

    // Check if times are within operating hours
    const [openHour, openMinute] = openTime.split(':').map(Number);
    const [closeHour, closeMinute] = closeTime.split(':').map(Number);

    const startHour = start.getHours();
    const startMinute = start.getMinutes();
    const endHour = end.getHours();
    const endMinute = end.getMinutes();

    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;

    if (startMinutes < openMinutes || endMinutes > closeMinutes) {
      return {
        valid: false,
        message: `${amenity.name} is only available from ${openTime} to ${closeTime}`
      };
    }

    return { valid: true };
  }

  /**
   * Comprehensive validation for a reservation
   */
  static async validateReservation(reservationData, excludeReservationId = null) {
    const errors = [];
    const warnings = [];
    
    try {
      const { userId, amenityId, startTime, endTime, visitorCount, willUseGrill } = reservationData;

      // Get amenity details
      const amenity = await amenityService.getAmenityById(amenityId);
      if (!amenity) {
        errors.push('Amenity not found');
        return { valid: false, errors, warnings };
      }

      // Basic time validation
      const start = new Date(startTime);
      const end = new Date(endTime);
      const now = new Date();

      if (start < now) {
        errors.push('Cannot book amenity for a past time');
      }

      if (end <= start) {
        errors.push('End time must be after start time');
      }

      // Operating hours validation
      const operatingHoursValidation = this.validateOperatingHours(amenity, startTime, endTime);
      if (!operatingHoursValidation.valid) {
        errors.push(operatingHoursValidation.message);
      }

      // Lounge-specific validation
      if (this.isLounge(amenity)) {
        const loungeValidation = this.validateLoungeRequirements(amenity, reservationData);
        if (!loungeValidation.valid) {
          errors.push(...loungeValidation.errors);
        }

        // Consecutive weekend booking validation
        const consecutiveValidation = await this.validateConsecutiveWeekendBooking(
          userId, amenityId, startTime, excludeReservationId
        );
        
        if (!consecutiveValidation.valid) {
          errors.push(consecutiveValidation.message);
          if (consecutiveValidation.details) {
            errors.push(consecutiveValidation.details);
          }
        }

        if (consecutiveValidation.warning) {
          warnings.push(consecutiveValidation.warning);
        }
      }

      // Time conflict validation
      const hasConflict = await reservationService.checkTimeConflict(
        amenityId, startTime, endTime, excludeReservationId
      );

      if (hasConflict) {
        errors.push('The selected time slot conflicts with an existing reservation');
      }

      // Approval requirements
      const approvalValidation = this.validateApprovalRequirements(amenity, reservationData);

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        approval: approvalValidation
      };

    } catch (error) {
      logger.error('Error in comprehensive reservation validation:', error);
      errors.push('Validation error occurred');
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Format time for display
   */
  static formatTime(date) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  /**
   * Get formatted day name
   */
  static getDayName(date) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return dayNames[new Date(date).getDay()];
  }

  /**
   * Check if amenity configuration is valid
   */
  static validateAmenityConfiguration(amenityData) {
    const errors = [];
    const warnings = [];

    const isLounge = this.isLounge(amenityData);

    // Lounge-specific configuration validation
    if (isLounge) {
      // Lounge should never have auto-approval rules
      if (amenityData.autoApprovalRules) {
        warnings.push('Community Lounge should not have auto-approval rules - will be ignored');
      }

      // Lounge should always require approval
      if (amenityData.requiresApproval === false) {
        errors.push('Community Lounge must always require administrator approval');
      }

      // Recommended max duration for lounge
      const maxDuration = amenityData.maxDurationMinutes || amenityData.maxDuration;
      if (!maxDuration || maxDuration > 480) {
        warnings.push('Recommended maximum duration for Community Lounge is 4 hours (240 minutes)');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

module.exports = AmenityValidationUtils;