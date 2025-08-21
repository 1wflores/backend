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

  async login(username, password) {
    try {
      logger.info('=== AUTH SERVICE LOGIN DEBUG ===');
      logger.info('Looking up user:', username);
      logger.info('Password provided:', !!password);
      logger.info('Password length:', password?.length);
      
      // Get user by username
      const user = await this.getUserByUsername(username);
      
      logger.info('Database query completed');
      logger.info('User found:', !!user);
      
      if (!user) {
        logger.warn('User not found in database:', username);
        throw new Error('Invalid username or password');
      }

      logger.info('User details found:');
      logger.info('- Username:', user.username);
      logger.info('- Role:', user.role);
      logger.info('- IsActive:', user.isActive);
      logger.info('- Has password hash:', !!user.passwordHash);
      logger.info('- Password hash starts with:', user.passwordHash?.substring(0, 20) + '...');

      // Check if user is active
      if (!user.isActive) {
        logger.warn('User account is deactivated:', username);
        throw new Error('Account is deactivated');
      }

      // Verify password
      logger.info('Starting password comparison...');
      logger.info('Input password:', password);
      logger.info('Stored hash:', user.passwordHash);
      
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      
      logger.info('Password comparison result:', isValidPassword);
      
      if (!isValidPassword) {
        logger.warn('Password mismatch for user:', username);
        logger.warn('Input password length:', password.length);
        logger.warn('Input password chars:', password.split('').map(c => c.charCodeAt(0)));
        throw new Error('Invalid username or password');
      }

      logger.info('Password verified successfully');

      // Update last login
      await this.updateLastLogin(user.id);

      // Generate JWT token
      const token = this.generateToken(user);

      logger.info(`User logged in successfully: ${username}`);
      logger.info('=== AUTH SERVICE LOGIN SUCCESS ===');
      
      return {
        token,
        user: this.sanitizeUser(user)
      };
    } catch (error) {
      logger.error('=== AUTH SERVICE LOGIN FAILED ===');
      logger.error('Login error message:', error.message);
      logger.error('Full error:', error);
      logger.error('===================================');
      throw error;
    }
  }

  async getUserByUsername(username) {
    try {
      logger.info('=== DATABASE USER LOOKUP ===');
      logger.info('Searching for username:', username);
      
      const query = 'SELECT * FROM c WHERE c.username = @username';
      const parameters = [{ name: '@username', value: username }];
      
      logger.info('Query:', query);
      logger.info('Parameters:', JSON.stringify(parameters));
      
      const users = await databaseService.queryItems('Users', query, parameters);
      
      logger.info('Query returned', users.length, 'users');
      
      if (users.length > 0) {
        logger.info('Found user:', users[0].username);
        logger.info('User role:', users[0].role);
        logger.info('User active:', users[0].isActive);
        logger.info('=== END DATABASE USER LOOKUP ===');
      }
      
      return users.length > 0 ? users[0] : null;
    } catch (error) {
      logger.error('Get user by username error:', error);
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

  async getAllUsers() {
    try {
      const users = await databaseService.getAllItems('Users');
      return users.map(user => this.sanitizeUser(user));
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
    } catch (error) {
      logger.error('Deactivate user error:', error);
      throw error;
    }
  }

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

  // NEW METHOD - FIX FOR THE AUTHENTICATION ERROR
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

  sanitizeUser(user) {
    const { passwordHash, ...sanitizedUser } = user;
    return sanitizedUser;
  }

    // Add these methods to your existing services/authService.js

    // Get all users with filtering and pagination (Admin only)
    async getAllUsers({ page = 1, limit = 50, search, role, isActive } = {}) {
      try {
        let query = 'SELECT * FROM c WHERE c.type = @type';
        const parameters = [
          { name: '@type', value: 'user' }
        ];

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

        query += ' ORDER BY c.createdAt DESC';

        const results = await databaseService.queryItems('Users', query, parameters);
        
        // Calculate pagination
        const total = results.length;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedResults = results.slice(startIndex, endIndex);

        return {
          items: paginatedResults.map(user => this.sanitizeUser(user)),
          total,
          page,
          limit
        };
      } catch (error) {
        logger.error('Get all users error:', error);
        throw error;
      }
    }

    // Update user (Admin only)
    async updateUser(userId, updates) {
      try {
        const user = await this.getUserById(userId);
        if (!user) {
          throw new Error('User not found');
        }

        // Validate updates
        const allowedUpdates = ['username', 'role', 'isActive'];
        const filteredUpdates = {};
        
        for (const key of allowedUpdates) {
          if (updates.hasOwnProperty(key)) {
            filteredUpdates[key] = updates[key];
          }
        }

        // If updating username, check for conflicts
        if (filteredUpdates.username && filteredUpdates.username !== user.username) {
          const existingUser = await this.getUserByUsername(filteredUpdates.username);
          if (existingUser) {
            throw new Error('Username already exists');
          }
        }

        // If updating to resident role, validate username format
        if (filteredUpdates.role === 'resident' && filteredUpdates.username) {
          if (!filteredUpdates.username.match(/^apartment\d+$/i)) {
            throw new Error('Resident username must be in format: apartment + number (e.g., apartment204)');
          }
        }

        const updatedUser = {
          ...user,
          ...filteredUpdates,
          updatedAt: new Date().toISOString()
        };

        // Use the same update method from reservationService
        const result = await this.updateUserByQuery(userId, updatedUser);
        
        logger.info(`User updated: ${userId}`);
        return this.sanitizeUser(result);
      } catch (error) {
        logger.error('Update user error:', error);
        throw error;
      }
    }

    // Query-based update method (similar to reservationService fix)
    async updateUserByQuery(id, updatedData) {
      try {
        logger.info(`Performing query-based update for user ${id}`);
        
        // First, get the current item to ensure we have the latest version
        const query = 'SELECT * FROM c WHERE c.id = @id';
        const parameters = [{ name: '@id', value: id }];
        
        const results = await databaseService.queryItems('Users', query, parameters);
        
        if (results.length === 0) {
          logger.warn(`User ${id} not found for update`);
          return null;
        }
        
        const currentItem = results[0];
        logger.info(`Found current user for update: ${currentItem.id}`);
        
        // Create the updated item with all required Cosmos DB properties
        const itemToUpdate = {
          ...updatedData,
          id: id, // Ensure ID is preserved
          type: 'user', // Ensure type is preserved
          _rid: currentItem._rid, // Preserve Cosmos DB internal properties
          _self: currentItem._self,
          _etag: currentItem._etag,
          _attachments: currentItem._attachments,
          _ts: currentItem._ts
        };
        
        // Use the working databaseService.createItem to "upsert" (will replace if exists)
        const result = await databaseService.createItem('Users', itemToUpdate);
        
        logger.info(`Query-based update completed for user ${id}`);
        return result;
      } catch (error) {
        logger.error(`Update user by query error for ${id}:`, error);
        throw error;
      }
    }

    // Deactivate user (Admin only)
    async deactivateUser(userId) {
      try {
        const updatedUser = await this.updateUser(userId, { isActive: false });
        logger.info(`User deactivated: ${userId}`);
        return updatedUser;
      } catch (error) {
        logger.error('Deactivate user error:', error);
        throw error;
      }
    }

    // Activate user (Admin only)
    async activateUser(userId) {
      try {
        const updatedUser = await this.updateUser(userId, { isActive: true });
        logger.info(`User activated: ${userId}`);
        return updatedUser;
      } catch (error) {
        logger.error('Activate user error:', error);
        throw error;
      }
    }

    // Get user's reservations (Admin only)
    async getUserReservations(userId, { page = 1, limit = 20 } = {}) {
      try {
        const user = await this.getUserById(userId);
        if (!user) {
          throw new Error('User not found');
        }

        const query = 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC';
        const parameters = [{ name: '@userId', value: userId }];

        const results = await databaseService.queryItems('Reservations', query, parameters);
        
        // Calculate pagination
        const total = results.length;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedResults = results.slice(startIndex, endIndex);

        return {
          reservations: paginatedResults,
          total,
          page,
          limit,
          user: this.sanitizeUser(user)
        };
      } catch (error) {
        logger.error('Get user reservations error:', error);
        throw error;
      }
    }

    // Helper method to sanitize user data
    sanitizeUser(user) {
      if (!user) return null;
      
      const { passwordHash, ...sanitizedUser } = user;
      return sanitizedUser;
    }

    // Create default admin user if none exists
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