const express = require('express');
const authRoutes = require('./auth');
const amenityRoutes = require('./amenities');
const reservationRoutes = require('./reservations');
const healthRoutes = require('./health');
const router = express.Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/amenities', amenityRoutes);
router.use('/reservations', reservationRoutes);
router.use('/health', healthRoutes);

module.exports = router;