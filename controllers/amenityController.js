const amenityService = require('../services/amenityService');
const logger = require('../utils/logger');

class AmenityController {
  async getAllAmenities(req, res) {
    try {
      const amenities = await amenityService.getAllAmenities();
      
      res.json({
        success: true,
        data: {
          amenities
        }
      });
    } catch (error) {
      logger.error('Get all amenities error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async getAmenityById(req, res) {
    try {
      const { id } = req.params;
      const amenity = await amenityService.getAmenityById(id);
      
      if (!amenity) {
        return res.status(404).json({
          success: false,
          message: 'Amenity not found'
        });
      }
      
      res.json({
        success: true,
        data: {
          amenity
        }
      });
    } catch (error) {
      logger.error('Get amenity by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async createAmenity(req, res) {
    try {
      const amenityData = req.body;
      const amenity = await amenityService.createAmenity(amenityData);
      
      res.status(201).json({
        success: true,
        message: 'Amenity created successfully',
        data: {
          amenity
        }
      });
    } catch (error) {
      logger.error('Create amenity error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async updateAmenity(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const amenity = await amenityService.updateAmenity(id, updateData);
      
      if (!amenity) {
        return res.status(404).json({
          success: false,
          message: 'Amenity not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Amenity updated successfully',
        data: {
          amenity
        }
      });
    } catch (error) {
      logger.error('Update amenity error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async deleteAmenity(req, res) {
    try {
      const { id } = req.params;
      const deleted = await amenityService.deleteAmenity(id);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Amenity not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Amenity deleted successfully'
      });
    } catch (error) {
      logger.error('Delete amenity error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async getAmenityAvailability(req, res) {
    try {
      const { id } = req.params;
      const { date, duration } = req.query;
      
      const availability = await amenityService.getAmenityAvailability(
        id, 
        date, 
        parseInt(duration) || 60
      );
      
      res.json({
        success: true,
        data: {
          availability
        }
      });
    } catch (error) {
      logger.error('Get amenity availability error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}

module.exports = new AmenityController();