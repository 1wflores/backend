const express = require('express');
const { body, param } = require('express-validator');
const amenityController = require('../controllers/amenityController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Validation rules
const createAmenityValidation = [
  body('name').isString().isLength({ min: 1, max: 100 }).withMessage('Name is required and must be 1-100 characters'),
  body('type').isIn(['jacuzzi', 'cold-tub', 'yoga-deck', 'lounge']).withMessage('Invalid amenity type'),
  body('description').optional().isString().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('capacity').isInt({ min: 1, max: 100 }).withMessage('Capacity must be between 1 and 100'),
  body('operatingHours.start').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:MM format'),
  body('operatingHours.end').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:MM format'),
  body('operatingHours.days').isArray().withMessage('Operating days must be an array'),
  body('operatingHours.days.*').isInt({ min: 0, max: 6 }).withMessage('Days must be 0-6'),
  body('autoApprovalRules.maxDurationMinutes').optional().isInt({ min: 15, max: 480 }).withMessage('Max duration must be 15-480 minutes'),
  body('autoApprovalRules.maxReservationsPerDay').optional().isInt({ min: 1, max: 10 }).withMessage('Max reservations must be 1-10'),
];

const updateAmenityValidation = [
  param('id').isString().notEmpty().withMessage('Amenity ID is required'),
  body('name').optional().isString().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
  body('capacity').optional().isInt({ min: 1, max: 100 }).withMessage('Capacity must be between 1 and 100'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
];

const amenityIdValidation = [
  param('id').isString().notEmpty().withMessage('Amenity ID is required'),
];

// Public routes (require authentication)
router.get('/', authenticateToken, amenityController.getAllAmenities);
router.get('/:id', authenticateToken, validate(amenityIdValidation), amenityController.getAmenityById);

// Admin routes
router.post('/', authenticateToken, requireAdmin, validate(createAmenityValidation), amenityController.createAmenity);
router.put('/:id', authenticateToken, requireAdmin, validate(updateAmenityValidation), amenityController.updateAmenity);
router.delete('/:id', authenticateToken, requireAdmin, validate(amenityIdValidation), amenityController.deleteAmenity);

module.exports = router;