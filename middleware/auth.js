const authService = require('../services/authService');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again in 15 minutes.'
    });
  }
});

// Enhanced token verification with better error handling
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify token with additional checks
    let decoded;
    try {
      decoded = authService.verifyToken(token);
    } catch (tokenError) {
      if (tokenError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      throw tokenError;
    }

    // Verify user still exists and is active
    const user = await authService.getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Check for suspicious activity
    if (req.ip && user.lastKnownIp && req.ip !== user.lastKnownIp) {
      logger.warn(`IP change detected for user ${user.username}: ${user.lastKnownIp} -> ${req.ip}`);
    }

    // Add user info to request
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      apartmentNumber: user.username.replace(/apartment/i, '')
    };

    // Update last activity
    authService.updateLastActivity(user.id, req.ip).catch(err => {
      logger.error('Failed to update last activity:', err);
    });

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

const requireAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.role !== 'admin') {
      logger.warn(`Unauthorized admin access attempt by ${req.user.username}`);
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    next();
  } catch (error) {
    logger.error('Admin authorization error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const requireResident = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.role !== 'resident' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Resident or admin access required'
      });
    }

    next();
  } catch (error) {
    logger.error('Resident authorization error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireResident,
  loginLimiter
};