const express = require('express');
const { body, param, query } = require('express-validator');
const amenityController = require('../controllers/amenityController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Validation rules
const createAmenityValidation = [
  body('name').isString().isLength({ min: 1, max: 100 }).withMessage('Name is required and must be 1-100 characters'),
  body('type').isIn(['jacuzzi', 'cold-tub', 'yoga-deck', 'lounge']).withMessage('Type must be one of: jacuzzi, cold-tub, yoga-deck, lounge'),
  body('description').optional().isString().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('capacity').isInt({ min: 1, max: 100 }).withMessage('Capacity must be between 1 and 100'),
  body('operatingHours.start').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:MM format'),
  body('operatingHours.end').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:MM format'),
  body('operatingHours.days').isArray().withMessage('Operating days must be an array'),
  body('operatingHours.days.*').isInt({ min: 0, max: 6 }).withMessage('Each day must be between 0 (Sunday) and 6 (Saturday)'),
  body('autoApprovalRules.maxDurationMinutes').isInt({ min: 15, max: 480 }).withMessage('Max duration must be between 15 minutes and 8 hours'),
  body('autoApprovalRules.maxReservationsPerDay').isInt({ min: 1, max: 10 }).withMessage('Max reservations per day must be between 1 and 10'),
];

const updateAmenityValidation = [
  body('name').optional().isString().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
  body('type').optional().isIn(['jacuzzi', 'cold-tub', 'yoga-deck', 'lounge']).withMessage('Type must be one of: jacuzzi, cold-tub, yoga-deck, lounge'),
  body('description').optional().isString().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('capacity').optional().isInt({ min: 1, max: 100 }).withMessage('Capacity must be between 1 and 100'),
];

const amenityIdValidation = [
  param('id').isString().notEmpty().withMessage('Amenity ID is required'),
];

const availabilityValidation = [
  param('id').isString().notEmpty().withMessage('Amenity ID is required'),
  query('date').isISO8601().withMessage('Date must be in ISO 8601 format'),
  query('duration').optional().isInt({ min: 15, max: 480 }).withMessage('Duration must be between 15 minutes and 8 hours'),
];

// All routes require authentication
router.use(authenticateToken);

// Public routes (authenticated users)
router.get('/', amenityController.getAllAmenities);
router.get('/:id', validate(amenityIdValidation), amenityController.getAmenityById);
router.get('/:id/availability', validate(availabilityValidation), amenityController.getAmenityAvailability);

// Admin only routes
router.post('/', requireAdmin, validate(createAmenityValidation), amenityController.createAmenity);
router.put('/:id', requireAdmin, validate([...amenityIdValidation, ...updateAmenityValidation]), amenityController.updateAmenity);
router.delete('/:id', requireAdmin, validate(amenityIdValidation), amenityController.deleteAmenity);

module.exports = router;