const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Validation rules
const loginValidation = [
  body('username').isString().notEmpty().withMessage('Username is required'),
  body('password').isString().notEmpty().withMessage('Password is required'),
];

const createUserValidation = [
  body('username')
    .isString()
    .matches(/^apartment\d+$/i)
    .withMessage('Username must be in format: apartment + number (e.g., apartment204)'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, and number'),
  body('role').optional().isIn(['resident', 'admin']).withMessage('Role must be resident or admin'),
];

const bulkCreateValidation = [
  body('apartmentNumbers').isArray({ min: 1 }).withMessage('Apartment numbers array is required'),
  body('apartmentNumbers.*').isString().matches(/^\d+$/).withMessage('Each apartment number must be numeric'),
  body('defaultPassword').optional().isLength({ min: 8 }).withMessage('Default password must be at least 8 characters'),
];

// Public routes
router.post('/login', validate(loginValidation), authController.login);

// Protected routes (require authentication)
router.use(authenticateToken);
router.post('/logout', authController.logout);
router.get('/profile', authController.getProfile);

// Admin only routes
router.post('/register', requireAdmin, validate(createUserValidation), authController.createUser);
router.post('/bulk-create', requireAdmin, validate(bulkCreateValidation), authController.createApartmentUsers);
router.get('/users', requireAdmin, authController.getAllUsers);
router.put('/users/:userId/password', requireAdmin, authController.changeUserPassword);
router.delete('/users/:userId', requireAdmin, authController.deactivateUser);

module.exports = router;