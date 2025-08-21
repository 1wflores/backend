// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const authService = require('../services/authService');
const logger = require('../utils/logger');

// Validation schemas
const createUserSchema = {
  username: {
    type: 'string',
    required: true,
    minLength: 3,
    maxLength: 50
  },
  password: {
    type: 'string',
    required: true,
    minLength: 8
  },
  role: {
    type: 'string',
    required: false,
    enum: ['admin', 'resident']
  }
};

const updateUserSchema = {
  username: {
    type: 'string',
    required: false,
    minLength: 3,
    maxLength: 50
  },
  role: {
    type: 'string',
    required: false,
    enum: ['admin', 'resident']
  },
  isActive: {
    type: 'boolean',
    required: false
  }
};

// GET /api/auth/users - Get all users (Admin only)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, role, isActive } = req.query;
    
    logger.info('Fetching users with filters:', { search, role, isActive });
    
    const users = await authService.getAllUsers({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      role,
      isActive: isActive !== undefined ? isActive === 'true' : undefined
    });
    
    res.json({
      success: true,
      data: {
        users: users.items,
        pagination: {
          total: users.total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(users.total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// POST /api/auth/users - Create new user (Admin only)
router.post('/users', authenticateToken, requireAdmin, validate(createUserSchema), async (req, res) => {
  try {
    const { username, password, role = 'resident' } = req.body;
    
    logger.info(`Admin ${req.user.username} creating user: ${username} with role: ${role}`);
    
    const newUser = await authService.createUser({
      username: username.trim().toLowerCase(),
      password,
      role
    });
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user: newUser }
    });
  } catch (error) {
    logger.error('Create user error:', error);
    
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    if (error.message.includes('format')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
});

// PUT /api/auth/users/:id - Update user (Admin only)
router.put('/users/:id', authenticateToken, requireAdmin, validate(updateUserSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    logger.info(`Admin ${req.user.username} updating user ${id}:`, updates);
    
    // Don't allow admins to deactivate themselves
    if (id === req.user.id && updates.isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account'
      });
    }
    
    const updatedUser = await authService.updateUser(id, updates);
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: updatedUser }
    });
  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

// DELETE /api/auth/users/:id - Deactivate user (Admin only)
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    logger.info(`Admin ${req.user.username} deactivating user ${id}`);
    
    // Don't allow admins to deactivate themselves
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account'
      });
    }
    
    const deactivatedUser = await authService.deactivateUser(id);
    
    if (!deactivatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'User deactivated successfully',
      data: { user: deactivatedUser }
    });
  } catch (error) {
    logger.error('Deactivate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate user'
    });
  }
});

// POST /api/auth/users/:id/activate - Reactivate user (Admin only)
router.post('/users/:id/activate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    logger.info(`Admin ${req.user.username} activating user ${id}`);
    
    const activatedUser = await authService.activateUser(id);
    
    if (!activatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'User activated successfully',
      data: { user: activatedUser }
    });
  } catch (error) {
    logger.error('Activate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to activate user'
    });
  }
});

// GET /api/auth/users/:id/reservations - Get user's reservations (Admin only)
router.get('/users/:id/reservations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    logger.info(`Admin ${req.user.username} fetching reservations for user ${id}`);
    
    const reservations = await authService.getUserReservations(id, {
      page: parseInt(page),
      limit: parseInt(limit)
    });
    
    res.json({
      success: true,
      data: reservations
    });
  } catch (error) {
    logger.error('Get user reservations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user reservations'
    });
  }
});

// POST /api/auth/users/bulk-create - Create multiple apartment users (Admin only)
router.post('/users/bulk-create', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { apartmentNumbers, defaultPassword = 'Resident123!' } = req.body;
    
    if (!Array.isArray(apartmentNumbers) || apartmentNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Apartment numbers array is required'
      });
    }
    
    logger.info(`Admin ${req.user.username} bulk creating users for apartments:`, apartmentNumbers);
    
    const results = await authService.createApartmentUsers(apartmentNumbers, defaultPassword);
    
    res.status(201).json({
      success: true,
      message: `Successfully created ${results.length} apartment users`,
      data: { users: results }
    });
  } catch (error) {
    logger.error('Bulk create users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create apartment users'
    });
  }
});

module.exports = router;