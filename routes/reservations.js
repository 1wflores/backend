const express = require('express');
const { body, query, param } = require('express-validator');
const reservationController = require('../controllers/reservationController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// ============================================
// VALIDATION RULES
// ============================================

// Create reservation validation
const createReservationValidation = [
  body('amenityId')
    .isString()
    .notEmpty()
    .withMessage('Amenity ID is required'),
  body('startTime')
    .isISO8601()
    .withMessage('Valid start time is required'),
  body('endTime')
    .isISO8601()
    .withMessage('Valid end time is required'),
  body('notes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notes must be less than 500 characters'),
  body('specialRequests')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Special requests must be less than 500 characters'),
  body('visitorCount')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Visitor count must be between 1 and 100'),
  body('willUseGrill')
    .optional()
    .isBoolean()
    .withMessage('Grill usage must be a boolean'),
];

// Update reservation validation
const updateReservationValidation = [
  param('id')
    .isString()
    .notEmpty()
    .withMessage('Reservation ID is required'),
  body('startTime')
    .optional()
    .isISO8601()
    .withMessage('Valid start time is required'),
  body('endTime')
    .optional()
    .isISO8601()
    .withMessage('Valid end time is required'),
  body('notes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notes must be less than 500 characters'),
  body('specialRequests')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Special requests must be less than 500 characters'),
  body('amenityId')
    .optional()
    .isString()
    .withMessage('Amenity ID must be a string'),
  body('visitorCount')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Visitor count must be between 1 and 100'),
  body('willUseGrill')
    .optional()
    .isBoolean()
    .withMessage('Grill usage must be a boolean'),
];

// Update status validation
const updateStatusValidation = [
  param('id')
    .isString()
    .notEmpty()
    .withMessage('Reservation ID is required'),
  body('status')
    .isIn(['approved', 'denied', 'cancelled'])
    .withMessage('Valid status is required (approved, denied, or cancelled)'),
  body('denialReason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Denial reason must be less than 500 characters'),
];

// Reservation ID validation
const reservationIdValidation = [
  param('id')
    .isString()
    .notEmpty()
    .withMessage('Reservation ID is required'),
];

// Available slots validation
const availableSlotsValidation = [
  query('amenityId')
    .isString()
    .notEmpty()
    .withMessage('Amenity ID is required'),
  query('date')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('Date must be in YYYY-MM-DD format'),
  query('duration')
    .optional()
    .isInt({ min: 30, max: 480 })
    .withMessage('Duration must be between 30 and 480 minutes'),
];

// Amenity reservations validation
const amenityReservationsValidation = [
  param('amenityId')
    .isString()
    .notEmpty()
    .withMessage('Amenity ID is required'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be valid ISO date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be valid ISO date'),
];

// Get reservations query validation
const getReservationsValidation = [
  query('status')
    .optional()
    .isIn(['pending', 'approved', 'denied', 'cancelled', 'completed'])
    .withMessage('Invalid status filter'),
  query('amenityId')
    .optional()
    .isString()
    .withMessage('Amenity ID must be a string'),
  query('userId')
    .optional()
    .isString()
    .withMessage('User ID must be a string'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be valid ISO date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be valid ISO date'),
  query('upcoming')
    .optional()
    .isBoolean()
    .withMessage('Upcoming must be a boolean'),
];

// ============================================
// ROUTES
// ============================================

// All routes require authentication
router.use(authenticateToken);

// ============================================
// PUBLIC ROUTES (Authenticated users)
// ============================================

// Create new reservation
router.post(
  '/', 
  validate(createReservationValidation), 
  reservationController.createReservation
);

// Get user's reservations
router.get(
  '/user', 
  validate(getReservationsValidation),
  reservationController.getUserReservations
);

// Get available slots for an amenity
router.get(
  '/available-slots', 
  validate(availableSlotsValidation), 
  reservationController.getAvailableSlots
);

// Get specific reservation by ID
router.get(
  '/:id', 
  validate(reservationIdValidation), 
  reservationController.getReservationById
);

// Update reservation (edit date, time, notes, lounge fields)
router.put(
  '/:id', 
  validate(updateReservationValidation), 
  reservationController.updateReservation
);

// Cancel reservation (delete)
router.delete(
  '/:id', 
  validate(reservationIdValidation), 
  reservationController.cancelReservation
);

// ============================================
// ADMIN ROUTES
// ============================================

// Get all reservations (admin only)
router.get(
  '/', 
  requireAdmin,
  validate(getReservationsValidation),
  reservationController.getAllReservations
);

// Update reservation status (admin only - approve/deny)
router.patch(
  '/:id/status', 
  requireAdmin,
  validate(updateStatusValidation), 
  reservationController.updateReservationStatus
);

// Get reservations by amenity (admin only)
router.get(
  '/amenity/:amenityId', 
  requireAdmin,
  validate(amenityReservationsValidation), 
  reservationController.getReservationsByAmenity
);

module.exports = router;