const databaseService = require('./databaseService');
const logger = require('../utils/logger');

class ReservationExpiryService {
  constructor() {
    this.intervalId = null;
    this.CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
  }

  // Start the automatic expiry checker
  startAutoExpiry() {
    logger.info('🕒 Starting reservation expiry service...');
    
    // Run immediately on start
    this.checkExpiredReservations();
    
    // Then run every 5 minutes
    this.intervalId = setInterval(() => {
      this.checkExpiredReservations();
    }, this.CHECK_INTERVAL);
    
    logger.info(`✅ Reservation expiry service started (checking every ${this.CHECK_INTERVAL / 1000}s)`);
  }

  // Stop the automatic expiry checker
  stopAutoExpiry() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('⏹️ Reservation expiry service stopped');
    }
  }

  // Check for and handle expired reservations
  async checkExpiredReservations() {
    try {
      const now = new Date();
      logger.info(`🔍 Checking for expired reservations at ${now.toISOString()}`);

      // Find pending reservations where start time has passed
      const query = `
        SELECT * FROM c 
        WHERE c.status = 'pending' 
        AND c.startTime < @now
        ORDER BY c.startTime ASC
      `;
      
      const parameters = [
        { name: '@now', value: now.toISOString() }
      ];

      const expiredReservations = await databaseService.queryItems('Reservations', query, parameters);
      
      if (expiredReservations.length === 0) {
        logger.info('✅ No expired pending reservations found');
        return;
      }

      logger.warn(`⚠️ Found ${expiredReservations.length} expired pending reservations`);

      // Process each expired reservation
      for (const reservation of expiredReservations) {
        await this.handleExpiredReservation(reservation);
      }

    } catch (error) {
      logger.error('❌ Error checking expired reservations:', error);
    }
  }

  // Handle a single expired reservation
  async handleExpiredReservation(reservation) {
    try {
      const hoursOverdue = (new Date().getTime() - new Date(reservation.startTime).getTime()) / (1000 * 60 * 60);
      
      logger.warn(`⚠️ Processing expired reservation ${reservation.id} (${hoursOverdue.toFixed(1)}h overdue)`);

      // Auto-deny reservations that are past their start time
      const updatedReservation = {
        ...reservation,
        status: 'denied',
        denialReason: `Automatically denied - reservation expired without admin review. Start time was ${reservation.startTime}.`,
        processedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await databaseService.updateItem('Reservations', reservation.id, updatedReservation);
      
      logger.info(`✅ Expired reservation ${reservation.id} automatically denied`);

    } catch (error) {
      logger.error(`❌ Error processing expired reservation ${reservation.id}:`, error);
    }
  }

  // Clean up old expired reservations (run on startup)
  async cleanupOldExpiredReservations() {
    try {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const query = `
        SELECT * FROM c 
        WHERE c.status = 'pending' 
        AND c.startTime < @oneDayAgo
      `;
      
      const parameters = [
        { name: '@oneDayAgo', value: oneDayAgo.toISOString() }
      ];

      const oldExpiredReservations = await databaseService.queryItems('Reservations', query, parameters);
      
      logger.info(`Found ${oldExpiredReservations.length} old expired reservations to cleanup`);

      for (const reservation of oldExpiredReservations) {
        await this.handleExpiredReservation(reservation);
      }

      logger.info('✅ Cleanup completed');
      return oldExpiredReservations.length;

    } catch (error) {
      logger.error('Error during cleanup:', error);
      throw error;
    }
  }
}

module.exports = new ReservationExpiryService();