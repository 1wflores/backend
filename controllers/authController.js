const authService = require('../services/authService');
const logger = require('../utils/logger');

class AuthController {
  // ===== PUBLIC ENDPOINTS =====

  async login(req, res) {
    try {
      const { username, password } = req.body;
      
      logger.info('=== LOGIN ATTEMPT ===');
      logger.info('Username:', username);
      logger.info('Request IP:', req.ip);
      logger.info('User Agent:', req.get('User-Agent'));
      
      const result = await authService.login(username, password);
      
      logger.info('=== LOGIN SUCCESS ===');
      logger.info('User authenticated:', result.user.username);
      logger.info('User role:', result.user.role);
      logger.info('User ID:', result.user.id);
      
      res.json({
        success: true,
        message: 'Login successful',
        data: {
          token: result.token,
          user: {
            id: result.user.id,
            username: result.user.username,
            role: result.user.role,
            isActive: result.user.isActive,
            createdAt: result.user.createdAt,
            lastLogin: result.user.lastLogin
          }
        }
      });
    } catch (error) {
      logger.error('=== LOGIN FAILED ===');
      logger.error('Error message:', error.message);
      logger.error('Username attempted:', req.body.username);
      logger.error('Request IP:', req.ip);
      
      // Don't reveal specific error details for security
      const isCredentialError = error.message.includes('Invalid') || 
                               error.message.includes('not found') ||
                               error.message.includes('incorrect');
      
      res.status(401).json({
        success: false,
        message: isCredentialError ? 'Invalid username or password' : 'Login failed'
      });
    }
  }

  // ===== PROTECTED ENDPOINTS =====

  async logout(req, res) {
    try {
      const username = req.user?.username;
      logger.info('Logout request from user:', username);
      
      // Update last activity/logout time if needed
      if (req.user?.id) {
        try {
          await authService.updateLastActivity(req.user.id, req.ip);
        } catch (updateError) {
          logger.warn('Failed to update last activity on logout:', updateError.message);
        }
      }
      
      res.json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      logger.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async verifyToken(req, res) {
    try {
      // If we reach here, the token is valid (passed authenticateToken middleware)
      const user = await authService.getUserById(req.user.id);
      
      if (!user) {
        logger.warn('Token verification failed: User not found', req.user.id);
        return res.status(401).json({
          success: false,
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      if (!user.isActive) {
        logger.warn('Token verification failed: User inactive', user.username);
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated',
          code: 'ACCOUNT_DEACTIVATED'
        });
      }

      logger.info('Token verification successful for user:', user.username);

      res.json({
        success: true,
        message: 'Token is valid',
        data: {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            apartmentNumber: user.username.replace(/apartment/i, ''),
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
          }
        }
      });
    } catch (error) {
      logger.error('Token verification error:', error);
      res.status(401).json({
        success: false,
        message: 'Token verification failed'
      });
    }
  }

  async getProfile(req, res) {
    try {
      const user = await authService.getUserById(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            apartmentNumber: user.username.replace(/apartment/i, '')
          }
        }
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // ===== ADMIN ONLY ENDPOINTS =====

  async createUser(req, res) {
    try {
      const { username, password, role } = req.body;
      
      logger.info('Admin creating user:', { username, role, adminUser: req.user.username });
      
      const user = await authService.createUser({
        username,
        password,
        role: role || 'resident'
      });
      
      logger.info('User created successfully:', user.username);
      
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            apartmentNumber: user.username.replace(/apartment/i, '')
          }
        }
      });
    } catch (error) {
      logger.error('Create user error:', error);
      
      // Handle specific errors
      if (error.message.includes('already exists')) {
        return res.status(409).json({
          success: false,
          message: 'Username already exists'
        });
      }
      
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to create user'
      });
    }
  }

  async createApartmentUsers(req, res) {
    try {
      const { apartmentNumbers, defaultPassword } = req.body;
      
      logger.info('Admin creating bulk apartment users:', { 
        count: apartmentNumbers.length, 
        adminUser: req.user.username 
      });
      
      const users = await authService.createApartmentUsers(
        apartmentNumbers, 
        defaultPassword || 'Resident123!'
      );
      
      logger.info('Bulk apartment users created:', users.length);
      
      res.status(201).json({
        success: true,
        message: `${users.length} apartment users created successfully`,
        data: {
          users: users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            apartmentNumber: user.username.replace(/apartment/i, '')
          }))
        }
      });
    } catch (error) {
      logger.error('Create apartment users error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to create apartment users'
      });
    }
  }

  async getAllUsers(req, res) {
    try {
      const { page = 1, limit = 50, search, role, isActive } = req.query;
      
      logger.info('Admin fetching users:', { 
        page, 
        limit, 
        search, 
        role, 
        isActive,
        adminUser: req.user.username 
      });
      
      const filters = {};
      if (search) filters.search = search;
      if (role) filters.role = role;
      if (isActive !== undefined) filters.isActive = isActive === 'true';
      
      const result = await authService.getAllUsers({
        page: parseInt(page),
        limit: parseInt(limit),
        ...filters
      });
      
      res.json({
        success: true,
        data: {
          users: result.users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            apartmentNumber: user.username.replace(/apartment/i, '')
          })),
          pagination: result.pagination
        }
      });
    } catch (error) {
      logger.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async getUserById(req, res) {
    try {
      const { userId } = req.params;
      
      logger.info('Admin fetching user by ID:', { userId, adminUser: req.user.username });
      
      const user = await authService.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            apartmentNumber: user.username.replace(/apartment/i, '')
          }
        }
      });
    } catch (error) {
      logger.error('Get user by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async changeUserPassword(req, res) {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body;
      
      logger.info('Admin changing password for user:', { userId, adminUser: req.user.username });
      
      await authService.changeUserPassword(userId, newPassword);
      
      logger.info('Password changed successfully for user:', userId);
      
      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      logger.error('Change password error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to change password'
      });
    }
  }

  async deactivateUser(req, res) {
    try {
      const { userId } = req.params;
      
      logger.info('Admin deactivating user:', { userId, adminUser: req.user.username });
      
      // Prevent admin from deactivating themselves
      if (userId === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate your own account'
        });
      }
      
      await authService.deactivateUser(userId);
      
      logger.info('User deactivated successfully:', userId);
      
      res.json({
        success: true,
        message: 'User deactivated successfully'
      });
    } catch (error) {
      logger.error('Deactivate user error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to deactivate user'
      });
    }
  }

  async activateUser(req, res) {
    try {
      const { userId } = req.params;
      
      logger.info('Admin activating user:', { userId, adminUser: req.user.username });
      
      await authService.activateUser(userId);
      
      logger.info('User activated successfully:', userId);
      
      res.json({
        success: true,
        message: 'User activated successfully'
      });
    } catch (error) {
      logger.error('Activate user error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to activate user'
      });
    }
  }
}

module.exports = new AuthController();