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
}

module.exports = new AuthService();