const authService = require('../services/authService');
const logger = require('../utils/logger');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify token
    const decoded = authService.verifyToken(token);
    
    // Get user from database to ensure user still exists and is active
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
        message: 'Account is deactivated'
      });
    }

    // Add user info to request
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

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

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = authService.verifyToken(token);
        const user = await authService.getUserById(decoded.id);
        
        if (user && user.isActive) {
          req.user = {
            id: user.id,
            username: user.username,
            role: user.role
          };
        }
      } catch (error) {
        // Invalid token, but continue without user
        logger.warn('Invalid token in optional auth:', error.message);
      }
    }

    next();
  } catch (error) {
    logger.error('Optional authentication error:', error);
    next(); // Continue without user
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireResident,
  optionalAuth
};