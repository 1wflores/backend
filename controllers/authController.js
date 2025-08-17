const authService = require('../services/authService');
const logger = require('../utils/logger');

class AuthController {
  async login(req, res) {
    try {
      const { username, password } = req.body;
      
      // === LOGIN DEBUGGING ===
      logger.info('=== LOGIN ATTEMPT DEBUG ===');
      logger.info('Received username:', username);
      logger.info('Received password length:', password?.length);
      logger.info('Password starts with:', password?.substring(0, 3) + '...');
      logger.info('Request body:', JSON.stringify(req.body, null, 2));
      logger.info('===========================');
      
      const result = await authService.login(username, password);
      
      logger.info('=== LOGIN SUCCESS ===');
      logger.info('User authenticated:', result.user.username);
      logger.info('User role:', result.user.role);
      logger.info('=====================');
      
      res.json({
        success: true,
        message: 'Login successful',
        data: {
          token: result.token,
          user: {
            id: result.user.id,
            username: result.user.username,
            role: result.user.role
          }
        }
      });
    } catch (error) {
      logger.error('=== LOGIN FAILED ===');
      logger.error('Login error message:', error.message);
      logger.error('Full error:', error);
      logger.error('===================');
      
      res.status(401).json({
        success: false,
        message: error.message
      });
    }
  }

  async logout(req, res) {
    try {
      // In a stateless JWT system, logout is handled client-side
      // You could implement token blacklisting here if needed
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

  async getProfile(req, res) {
    try {
      const user = await authService.getUserById(req.user.id);
      
      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt
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

  async createUser(req, res) {
    try {
      const { username, password, role } = req.body;
      
      const user = await authService.createUser({
        username,
        password,
        role: role || 'resident'
      });
      
      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt
          }
        }
      });
    } catch (error) {
      logger.error('Create user error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async createApartmentUsers(req, res) {
    try {
      const { apartmentNumbers, defaultPassword } = req.body;
      
      const users = await authService.createApartmentUsers(
        apartmentNumbers, 
        defaultPassword || 'Resident123!'
      );
      
      res.status(201).json({
        success: true,
        message: `${users.length} apartment users created successfully`,
        data: {
          users: users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt
          }))
        }
      });
    } catch (error) {
      logger.error('Create apartment users error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async getAllUsers(req, res) {
    try {
      const users = await authService.getAllUsers();
      
      res.json({
        success: true,
        data: {
          users: users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
          }))
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

  async changeUserPassword(req, res) {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body;
      
      await authService.changeUserPassword(userId, newPassword);
      
      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      logger.error('Change password error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async deactivateUser(req, res) {
    try {
      const { userId } = req.params;
      
      await authService.deactivateUser(userId);
      
      res.json({
        success: true,
        message: 'User deactivated successfully'
      });
    } catch (error) {
      logger.error('Deactivate user error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new AuthController();