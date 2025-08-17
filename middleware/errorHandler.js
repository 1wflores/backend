const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Error Handler:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    user: req.user?.username
  });

  // Cosmos DB errors
  if (err.code === 409) {
    const message = 'Resource conflict - item already exists';
    return res.status(409).json({
      success: false,
      message
    });
  }

  if (err.code === 404) {
    const message = 'Resource not found';
    return res.status(404).json({
      success: false,
      message
    });
  }

  if (err.code === 400) {
    const message = 'Bad request - invalid data';
    return res.status(400).json({
      success: false,
      message
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    return res.status(401).json({
      success: false,
      message
    });
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    return res.status(401).json({
      success: false,
      message
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    const message = 'Validation failed';
    return res.status(400).json({
      success: false,
      message,
      errors: Object.values(err.errors).map(val => val.message)
    });
  }

  // Duplicate key error
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    return res.status(400).json({
      success: false,
      message
    });
  }

  // Cast error
  if (err.name === 'CastError') {
    const message = 'Invalid resource ID format';
    return res.status(400).json({
      success: false,
      message
    });
  }

  // Default to 500 server error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

const notFoundHandler = (req, res, next) => {
  const message = `Route ${req.originalUrl} not found`;
  
  logger.warn('Route not found:', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  res.status(404).json({
    success: false,
    message
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler
};