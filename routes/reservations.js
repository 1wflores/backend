// routes/reservations.js - UPDATED WITH HEALTH CHECK AND BETTER VALIDATION

const express = require('express');
const { body, param, query } = require('express-validator');
const reservationController = require('../controllers/reservationController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Enhanced validation rules
const createReservationValidation = [
  body('amenityId').isString().notEmpty().withMessage('Amenity ID is required'),
  body('startTime').isISO8601().withMessage('Valid start time is required'),
  body('endTime').isISO8601().withMessage('Valid end time is required'),
  body('notes').optional().isString().isLength({ max: 500 }).withMessage('Notes must be less than 500 characters'),
];

const updateStatusValidation = [
  param('id').isString().notEmpty().withMessage('Reservation ID is required'),
  body('status').isIn(['approved', 'denied', 'cancelled']).withMessage('Valid status is required'),
  body('denialReason').optional().isString().isLength({ max: 500 }).withMessage('Denial reason must be less than 500 characters'),
];

const reservationIdValidation = [
  param('id').isString().notEmpty().withMessage('Reservation ID is required'),
];

const availableSlotsValidation = [
  query('amenityId').isString().notEmpty().withMessage('Amenity ID is required'),
  query('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be in YYYY-MM-DD format'),
  query('duration').optional().isInt({ min: 30, max: 480 }).withMessage('Duration must be between 30 and 480 minutes'),
];

const amenityReservationsValidation = [
  param('amenityId').isString().notEmpty().withMessage('Amenity ID is required'),
  query('startDate').optional().isISO8601().withMessage('Start date must be valid ISO date'),
  query('endDate').optional().isISO8601().withMessage('End date must be valid ISO date'),
];

// All routes require authentication
router.use(authenticateToken);

// ✅ NEW: Health check endpoint (accessible to all authenticated users)
router.get('/health', reservationController.getReservationHealth);

// Public routes (authenticated users)
router.post('/', validate(createReservationValidation), reservationController.createReservation);
router.get('/user', reservationController.getUserReservations);
router.get('/available-slots', validate(availableSlotsValidation), reservationController.getAvailableSlots);
router.get('/:id', validate(reservationIdValidation), reservationController.getReservationById);

// ✅ ENHANCED: Cancel reservation route with better error handling
router.delete('/:id', validate(reservationIdValidation), reservationController.cancelReservation);

// Admin routes
router.get('/', requireAdmin, reservationController.getAllReservations);

// ✅ FIXED: Both PATCH and PUT methods for status update (admin only)
router.patch('/:id/status', requireAdmin, validate(updateStatusValidation), reservationController.updateReservationStatus);
router.put('/:id/status', requireAdmin, validate(updateStatusValidation), reservationController.updateReservationStatus);

// ✅ ENHANCED: Get reservations by amenity with better validation
router.get('/amenity/:amenityId', requireAdmin, validate(amenityReservationsValidation), reservationController.getReservationsByAmenity);

// ✅ NEW: Bulk operations (admin only)
router.post('/bulk-cancel', requireAdmin, [
  body('reservationIds').isArray({ min: 1 }).withMessage('At least one reservation ID is required'),
  body('reservationIds.*').isString().withMessage('Each reservation ID must be a string'),
  body('reason').optional().isString().isLength({ max: 500 }).withMessage('Reason must be less than 500 characters')
], async (req, res) => {
  try {
    const { reservationIds, reason } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log(`🚫 Bulk cancelling ${reservationIds.length} reservations by admin ${userId}`);

    const results = [];
    const errors = [];

    for (const reservationId of reservationIds) {
      try {
        const cancelled = await reservationService.cancelReservation(reservationId, userId, userRole);
        results.push({
          reservationId,
          success: true,
          reservation: cancelled
        });
      } catch (error) {
        console.error(`❌ Failed to cancel reservation ${reservationId}:`, error);
        errors.push({
          reservationId,
          success: false,
          error: error.message
        });
      }
    }

    console.log(`✅ Bulk cancellation completed: ${results.length} successful, ${errors.length} failed`);

    res.json({
      success: true,
      message: `Bulk cancellation completed: ${results.length} successful, ${errors.length} failed`,
      data: {
        successful: results,
        failed: errors,
        summary: {
          total: reservationIds.length,
          successful: results.length,
          failed: errors.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Bulk cancellation error:', error);
    res.status(500).json({
      success: false,
      message: 'Bulk cancellation failed',
      error: error.message
    });
  }
});

module.exports = router;