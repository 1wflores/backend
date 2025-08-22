const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const databaseService = require('./databaseService');
const logger = require('../utils/logger');

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
  }

  // ===== CORE AUTH METHODS =====

  async login(username, password) {
    try {
      logger.info('=== AUTH SERVICE LOGIN DEBUG ===');
      logger.info('Looking up user:', username);
      logger.info('Password provided:', !!password);
      
      // Get user by username
      const user = await this.getUserByUsername(username);
      
      if (!user) {
        logger.warn('User not found:', username);
        throw new Error('Invalid username or password');
      }

      logger.info('User found:', user.username);
      logger.info('User role:', user.role);
      logger.info('User active:', user.isActive);

      // Check if user is active
      if (!user.isActive) {
        logger.warn('User account is deactivated:', username);
        throw new Error('Account is deactivated');
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      
      if (!isValidPassword) {
        logger.warn('Password mismatch for user:', username);
        throw new Error('Invalid username or password');
      }

      logger.info('Password verified successfully');

      // Update last login
      await this.updateLastLogin(user.id);

      // Generate JWT token
      const token = this.generateToken(user);

      logger.info(`User logged in successfully: ${username}`);
      
      return {
        token,
        user: this.sanitizeUser(user)
      };
    } catch (error) {
      logger.error('Login error:', error.message);
      throw error;
    }
  }

  generateToken(user) {
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
      issuer: 'amenity-reservation-api',
      audience: 'amenity-reservation-app'
    });
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret, {
        issuer: 'amenity-reservation-api',
        audience: 'amenity-reservation-app'
      });
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  // ===== USER MANAGEMENT METHODS =====

  async createUser({ username, password, role = 'resident' }) {
    try {
      // Validate username format for non-admin users
      if (role !== 'admin' && !username.match(/^apartment\d+$/i)) {
        throw new Error('Username must be in format: apartment + number (e.g., apartment204)');
      }

      // Check if user already exists
      const existingUser = await this.getUserByUsername(username);
      if (existingUser) {
        throw new Error('Username already exists');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user object
      const user = {
        id: uuidv4(),
        username,
        passwordHash,
        role,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save to database
      const createdUser = await databaseService.createItem('Users', user);
      
      logger.info(`User created: ${username} (${role})`);
      return this.sanitizeUser(createdUser);
    } catch (error) {
      logger.error('Create user error:', error);
      throw error;
    }
  }

  async createApartmentUsers(apartmentNumbers, defaultPassword = 'Resident123!') {
    try {
      const users = [];
      const errors = [];

      for (const apartmentNumber of apartmentNumbers) {
        try {
          const username = `apartment${apartmentNumber}`;
          const user = await this.createUser({
            username,
            password: defaultPassword,
            role: 'resident'
          });
          users.push(user);
        } catch (error) {
          errors.push({ apartmentNumber, error: error.message });
        }
      }

      if (errors.length > 0) {
        logger.warn('Some apartment users failed to create:', errors);
      }

      logger.info(`Created ${users.length} apartment users`);
      return users;
    } catch (error) {
      logger.error('Create apartment users error:', error);
      throw error;
    }
  }

  async getUserById(id) {
    try {
      const user = await databaseService.getItem('Users', id);
      return user;
    } catch (error) {
      logger.error('Get user by ID error:', error);
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      const query = 'SELECT * FROM c WHERE c.username = @username';
      const parameters = [{ name: '@username', value: username }];
      
      const users = await databaseService.queryItems('Users', query, parameters);
      return users.length > 0 ? users[0] : null;
    } catch (error) {
      logger.error('Get user by username error:', error);
      throw error;
    }
  }

  // ✅ FIXED: Complete getAllUsers with proper filtering and pagination
  async getAllUsers({ page = 1, limit = 50, search, role, isActive } = {}) {
    try {
      let query = 'SELECT * FROM c WHERE 1=1';
      const parameters = [];

      // Add search filter
      if (search) {
        query += ' AND CONTAINS(LOWER(c.username), @search)';
        parameters.push({ name: '@search', value: search.toLowerCase() });
      }

      // Add role filter
      if (role) {
        query += ' AND c.role = @role';
        parameters.push({ name: '@role', value: role });
      }

      // Add active status filter
      if (isActive !== undefined) {
        query += ' AND c.isActive = @isActive';
        parameters.push({ name: '@isActive', value: isActive });
      }

      // Add ordering
      query += ' ORDER BY c.createdAt DESC';

      const allUsers = await databaseService.queryItems('Users', query, parameters);
      
      // Calculate pagination
      const total = allUsers.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedUsers = allUsers.slice(startIndex, endIndex);

      return {
        users: paginatedUsers.map(user => this.sanitizeUser(user)),
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          count: paginatedUsers.length,
          totalCount: total
        }
      };
    } catch (error) {
      logger.error('Get all users error:', error);
      throw error;
    }
  }

  async changeUserPassword(userId, newPassword) {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      
      const updatedUser = {
        ...user,
        passwordHash,
        updatedAt: new Date().toISOString()
      };

      await databaseService.updateItem('Users', updatedUser);
      
      logger.info(`Password changed for user: ${user.username}`);
    } catch (error) {
      logger.error('Change password error:', error);
      throw error;
    }
  }

  async deactivateUser(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const updatedUser = {
        ...user,
        isActive: false,
        updatedAt: new Date().toISOString()
      };

      await databaseService.updateItem('Users', updatedUser);
      
      logger.info(`User deactivated: ${user.username}`);
      return this.sanitizeUser(updatedUser);
    } catch (error) {
      logger.error('Deactivate user error:', error);
      throw error;
    }
  }

  // ✅ NEW: Missing activateUser method
  async activateUser(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const updatedUser = {
        ...user,
        isActive: true,
        updatedAt: new Date().toISOString()
      };

      await databaseService.updateItem('Users', updatedUser);
      
      logger.info(`User activated: ${user.username}`);
      return this.sanitizeUser(updatedUser);
    } catch (error) {
      logger.error('Activate user error:', error);
      throw error;
    }
  }

  // ===== UTILITY METHODS =====

  async updateLastLogin(userId) {
    try {
      const user = await this.getUserById(userId);
      if (user) {
        const updatedUser = {
          ...user,
          lastLogin: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await databaseService.updateItem('Users', updatedUser);
      }
    } catch (error) {
      logger.error('Update last login error:', error);
      // Don't throw error for login timestamp update failure
    }
  }

  async updateLastActivity(userId, ipAddress) {
    try {
      const user = await this.getUserById(userId);
      if (user) {
        const updatedUser = {
          ...user,
          lastActivity: new Date().toISOString(),
          lastKnownIp: ipAddress,
          updatedAt: new Date().toISOString()
        };
        await databaseService.updateItem('Users', updatedUser);
      }
    } catch (error) {
      logger.error('Update last activity error:', error);
      // Don't throw error for activity update failure
      // This is a non-critical operation that shouldn't break the request
    }
  }

  sanitizeUser(user) {
    if (!user) return null;
    const { passwordHash, ...sanitizedUser } = user;
    return sanitizedUser;
  }

  // ===== INITIALIZATION METHODS =====

  async createDefaultAdmin() {
    try {
      const adminQuery = 'SELECT * FROM c WHERE c.role = @role';
      const adminParams = [{ name: '@role', value: 'admin' }];
      const existingAdmins = await databaseService.queryItems('Users', adminQuery, adminParams);

      if (existingAdmins.length === 0) {
        const defaultAdmin = await this.createUser({
          username: 'admin',
          password: 'Admin123!',
          role: 'admin'
        });
        
        logger.info('Default admin user created');
        return defaultAdmin;
      }
      
      logger.info('Admin user already exists');
      return null;
    } catch (error) {
      logger.error('Create default admin error:', error);
      throw error;
    }
  }
}

module.exports = new AuthService();