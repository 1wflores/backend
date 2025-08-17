const express = require('express');
const { body, param, query } = require('express-validator');
const reservationController = require('../controllers/reservationController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Validation rules
const createReservationValidation = [
  body('amenityId').isString().notEmpty().withMessage('Amenity ID is required'),
  body('startTime')
    .isISO8601()
    .withMessage('Start time must be a valid ISO 8601 date')
    .custom((value) => {
      const startTime = new Date(value);
      const now = new Date();
      if (startTime <= now) {
        throw new Error('Start time must be in the future');
      }
      return true;
    }),
  body('endTime')
    .isISO8601()
    .withMessage('End time must be a valid ISO 8601 date')
    .custom((value, { req }) => {
      const endTime = new Date(value);
      const startTime = new Date(req.body.startTime);
      if (endTime <= startTime) {
        throw new Error('End time must be after start time');
      }
      const durationHours = (endTime - startTime) / (1000 * 60 * 60);
      if (durationHours > 8) {
        throw new Error('Reservation cannot exceed 8 hours');
      }
      return true;
    }),
  body('specialRequests.visitorCount')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Visitor count must be between 1 and 50'),
  body('specialRequests.grillUsage')
    .optional()
    .isBoolean()
    .withMessage('Grill usage must be a boolean'),
  body('specialRequests.notes')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Notes must be less than 1000 characters'),
];

const updateStatusValidation = [
  param('id').isString().notEmpty().withMessage('Reservation ID is required'),
  body('status').isIn(['approved', 'denied', 'cancelled']).withMessage('Invalid status'),
  body('denialReason')
    .if(body('status').equals('denied'))
    .isString()
    .isLength({ min: 1, max: 500 })
    .withMessage('Denial reason is required when denying reservation'),
];

const reservationIdValidation = [
  param('id').isString().notEmpty().withMessage('Reservation ID is required'),
];

const availableSlotsValidation = [
  query('amenityId').isString().notEmpty().withMessage('Amenity ID is required'),
  query('date').isISO8601().withMessage('Date must be in ISO 8601 format'),
];

const amenityReservationsValidation = [
  param('amenityId').isString().notEmpty().withMessage('Amenity ID is required'),
];

// All routes require authentication
router.use(authenticateToken);

// Public routes (authenticated users)
router.post('/', validate(createReservationValidation), reservationController.createReservation);
router.get('/user', reservationController.getUserReservations);
router.get('/available-slots', validate(availableSlotsValidation), reservationController.getAvailableSlots);
router.get('/:id', validate(reservationIdValidation), reservationController.getReservationById);
router.delete('/:id', validate(reservationIdValidation), reservationController.cancelReservation);

// Admin routes
router.get('/', requireAdmin, reservationController.getAllReservations);

// ✅ FIXED: Added both PATCH and PUT methods for status update
router.patch('/:id/status', requireAdmin, validate(updateStatusValidation), reservationController.updateReservationStatus);
router.put('/:id/status', requireAdmin, validate(updateStatusValidation), reservationController.updateReservationStatus);

router.get('/amenity/:amenityId', requireAdmin, validate(amenityReservationsValidation), reservationController.getReservationsByAmenity);

module.exports = router;