require('dotenv').config();

const databaseService = require('../services/databaseService');
const authService = require('../services/authService');
const amenityService = require('../services/amenityService');
const logger = require('../utils/logger');

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function initializeDatabase() {
  try {
    logger.info('🔄 Initializing database...');
    
    // Test database connection
    const connected = await databaseService.testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }
    logger.success('✅ Database connected successfully');

    // Create admin user with apartment format
    try {
      await authService.createUser({
        username: 'apartment000',  // Admin with apartment format
        password: process.env.ADMIN_PASSWORD || 'Eptc-1794',
        role: 'admin'
      });
      logger.success('✅ Default admin user created: apartment000');
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('already exists')) {
        logger.info('ℹ️  Admin user already exists: apartment000');
      } else {
        throw error;
      }
    }

    // Create default amenities
    const defaultAmenities = [
      {
        name: 'Jacuzzi',
        type: 'jacuzzi',
        description: 'Relaxing hot tub with jets for up to 6 people',
        capacity: 6,
        operatingHours: {
          start: '07:00',
          end: '21:00',
          days: [0, 1, 2, 3, 4, 5, 6]
        },
        autoApprovalRules: {
          maxDurationMinutes: 60,
          maxReservationsPerDay: 1
        }
      },
      {
        name: 'Cold Tub',
        type: 'cold-tub',
        description: 'Cold therapy tub for recovery and wellness',
        capacity: 4,
        operatingHours: {
          start: '07:00',
          end: '21:00',
          days: [0, 1, 2, 3, 4, 5, 6]
        },
        autoApprovalRules: {
          maxDurationMinutes: 60,
          maxReservationsPerDay: 1
        }
      },
      {
        name: 'Yoga Deck',
        type: 'yoga-deck',
        description: 'Peaceful outdoor space for yoga and meditation',
        capacity: 10,
        operatingHours: {
          start: '07:00',
          end: '21:00',
          days: [0, 1, 2, 3, 4, 5, 6]
        },
        autoApprovalRules: {
          maxDurationMinutes: 60,
          maxReservationsPerDay: 1
        }
      },
      {
        name: 'Community Lounge',
        type: 'lounge',
        description: 'Community lounge with grill access for gatherings',
        capacity: 20,
        operatingHours: {
          start: '08:00',
          end: '23:00',
          days: [0, 1, 2, 3, 4, 5, 6]
        },
        // **CRITICAL CHANGE: NO autoApprovalRules for lounge**
        // **The lounge will ALWAYS require administrator approval**
        requiresApproval: true, // Always requires admin approval
        maxDurationMinutes: 240, // 4 hours max
        specialRequirements: {
          maxVisitors: 20,
          advanceBookingHours: 24, // 24-hour advance booking required
          consecutiveBookingRestrictions: {
            weekendDaysOnly: true, // Only restrict consecutive weekend days
            restrictedDays: [5, 6, 0], // Friday, Saturday, Sunday
            message: 'Consecutive weekend bookings (Friday, Saturday, Sunday) are not allowed'
          }
        }
      }
    ];

    // Create amenities
    logger.info('🏢 Creating default amenities...');
    for (const amenityData of defaultAmenities) {
      try {
        await amenityService.createAmenity(amenityData);
        logger.success(`✅ Amenity created: ${amenityData.name}`);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        if (errorMessage.includes('already exists')) {
          logger.info(`ℹ️  Amenity already exists: ${amenityData.name}`);
        } else {
          logger.error(`❌ Error creating amenity ${amenityData.name}:`, error);
        }
      }
    }

    // Create sample apartment users
    logger.info('🏠 Creating sample apartment users...');
    const apartmentNumbers = ['101', '102', '103', '104', '105','106', '107', '108', '109', '110' , '201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '301', '302', '303', '304', '305', '306', '307', '308', '309', '310'];
    try {
      const createdUsers = await authService.createApartmentUsers(apartmentNumbers, 'Resident123!');
      logger.success(`✅ ${createdUsers.length} sample apartment users created`);
    } catch (error) {
      logger.info('ℹ️  Some sample users may already exist');
    }

    // Success message
    logger.success('🎉 Database initialization completed successfully!');
    logger.info('');
    logger.info('📋 SETUP COMPLETE - Your API is ready!');
    logger.info('');
    logger.info('🔑 Default login credentials:');
    logger.info('   👤 Admin: username="apartment000", password="Admin123!"');
    logger.info('   🏠 Sample residents: username="apartment101", password="Resident123!"');
    logger.info('   🏠 More residents: apartment102, apartment103, etc. (all with "Resident123!")');
    logger.info('');
    logger.info('🏢 Available amenities:');
    logger.info('   🛁 Jacuzzi (7 AM - 9 PM, max 60 min, auto-approved)');
    logger.info('   🧊 Cold Tub (7 AM - 9 PM, max 60 min, auto-approved)');
    logger.info('   🧘 Yoga Deck (7 AM - 9 PM, max 60 min, auto-approved)');
    logger.info('   🏡 Community Lounge (8 AM - 11 PM, max 12 hours, 🚨 ALWAYS REQUIRES ADMIN APPROVAL 🚨)');  
    logger.info('');
    logger.info('🚫 LOUNGE BOOKING RESTRICTIONS:');
    logger.info('   ❌ NO consecutive weekend bookings (Fri+Sat, Fri+Sun, Sat+Sun)');
    logger.info('   ✋ ALWAYS requires administrator approval');
    logger.info('   ⏰ 24-hour advance booking required');
    logger.info('   👀 Administrators see requests in chronological order');
    logger.info('');
    logger.info('🚀 API Endpoints ready:');
    logger.info('   🔐 POST /api/auth/login');
    logger.info('   🏢 GET /api/amenities');
    logger.info('   📅 POST /api/reservations');
    logger.info('   🔍 GET /api/reservations/available-slots');
    logger.info('   ❤️  GET /api/health');
    logger.info('');
    
    if (process.env.NODE_ENV === 'production') {
      logger.info('🌐 Production URLs:');
      logger.info('   API: https://amenity-reservation-api-ffbqc3b2hkh3d8d0.centralus-01.azurewebsites.net');
      logger.info('   Health: https://amenity-reservation-api-ffbqc3b2hkh3d8d0.centralus-01.azurewebsites.net/api/health');
    } else {
      logger.info('🏠 Local URLs:');
      logger.info('   API: http://localhost:8080');
      logger.info('   Health: http://localhost:8080/api/health');
    }
    
    logger.info('');
    logger.info('📱 Ready for React Native integration!');

  } catch (error) {
    logger.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase().then(() => {
    process.exit(0);
  });
}

module.exports = { initializeDatabase };