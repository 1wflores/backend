const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticateToken, requireAdmin, loginLimiter } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Validation rules
const loginValidation = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Username must be between 1 and 50 characters'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Password must be between 1 and 100 characters'),
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

const changePasswordValidation = [
  body('newPassword')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, and number'),
];

// ===== PUBLIC ROUTES =====
// ✅ FIXED: Apply rate limiting to login
router.post('/login', loginLimiter, validate(loginValidation), authController.login);

// ===== PROTECTED ROUTES (require authentication) =====
router.use(authenticateToken);

// Core auth endpoints
router.post('/logout', authController.logout);
router.get('/profile', authController.getProfile);
router.get('/verify', authController.verifyToken); // ✅ NEW: Token verification endpoint

// ===== ADMIN ONLY ROUTES =====
router.use(requireAdmin);

// User management
router.post('/register', validate(createUserValidation), authController.createUser);
router.post('/bulk-create', validate(bulkCreateValidation), authController.createApartmentUsers);
router.get('/users', authController.getAllUsers);
router.get('/users/:userId', authController.getUserById); // ✅ NEW: Get single user
router.put('/users/:userId/password', validate(changePasswordValidation), authController.changeUserPassword);
router.delete('/users/:userId', authController.deactivateUser);
router.put('/users/:userId/activate', authController.activateUser); // ✅ NEW: Activate user

module.exports = router;