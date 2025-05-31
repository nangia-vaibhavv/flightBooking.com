// backend/src/routes/flights.js
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Flight = require('../models/Flight');
const Route = require('../models/Route');
const flightService = require('../services/flightService');
const cacheService = require('../services/cacheService');
const pricingService = require('../services/pricingService');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiting for flight search
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 search requests per minute
  message: 'Too many search requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for flight management (admin operations)
const flightManagementLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 management requests per 15 minutes
  message: 'Too many flight management requests, please try again later.',
});

// Validation middleware
const searchValidation = [
  query('from').notEmpty().withMessage('From location is required'),
  query('to').notEmpty().withMessage('To location is required'),
  query('departureDate').isISO8601().withMessage('Valid departure date is required'),
  query('returnDate').optional().isISO8601().withMessage('Valid return date is required'),
  query('passengers').optional().isInt({ min: 1, max: 9 }).withMessage('Passengers must be between 1 and 9'),
  query('class').optional().isIn(['economy', 'business', 'first']).withMessage('Invalid class type')
];

const flightValidation = [
  body('flightNumber').notEmpty().withMessage('Flight number is required'),
  body('airline').notEmpty().withMessage('Airline is required'),
  body('aircraft').notEmpty().withMessage('Aircraft type is required'),
  body('route').isMongoId().withMessage('Valid route ID is required'),
  body('departureTime').isISO8601().withMessage('Valid departure time is required'),
  body('arrivalTime').isISO8601().withMessage('Valid arrival time is required'),
  body('basePrice').isFloat({ min: 0 }).withMessage('Valid base price is required'),
  body('totalSeats').isInt({ min: 1 }).withMessage('Valid total seats is required'),
  body('availableSeats').isInt({ min: 0 }).withMessage('Valid available seats is required')
];

// Search flights
router.get('/search', searchLimiter, searchValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      from,
      to,
      departureDate,
      returnDate,
      passengers = 1,
      class: travelClass = 'economy',
      sortBy = 'price',
      sortOrder = 'asc'
    } = req.query;

    // Create cache key
    const cacheKey = `flights:search:${from}:${to}:${departureDate}:${passengers}:${travelClass}:${sortBy}:${sortOrder}`;
    
    // Check cache first
    const cachedResults = await cacheService.get(cacheKey);
    if (cachedResults) {
      logger.info(`Cache hit for flight search: ${cacheKey}`);
      return res.json({
        success: true,
        data: JSON.parse(cachedResults),
        cached: true
      });
    }

    // Search flights
    const searchParams = {
      from,
      to,
      departureDate,
      returnDate,
      passengers: parseInt(passengers),
      class: travelClass,
      sortBy,
      sortOrder
    };

    const flights = await flightService.searchFlights(searchParams);

    // Apply dynamic pricing
    const flightsWithPricing = await Promise.all(
      flights.map(async (flight) => {
        const dynamicPrice = await pricingService.calculateDynamicPrice(
          flight,
          travelClass,
          parseInt(passengers)
        );
        
        return {
          ...flight.toObject(),
          currentPrice: dynamicPrice,
          priceBreakdown: await pricingService.getPriceBreakdown(flight, travelClass, parseInt(passengers))
        };
      })
    );

    // Cache results for 5 minutes
    await cacheService.set(cacheKey, JSON.stringify(flightsWithPricing), 300);

    res.json({
      success: true,
      data: flightsWithPricing,
      totalResults: flightsWithPricing.length,
      searchParams
    });

  } catch (error) {
    logger.error('Flight search error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during flight search'
    });
  }
});

// Get flight details by ID
router.get('/:flightId', async (req, res) => {
  try {
    const { flightId } = req.params;
    const { passengers = 1, class: travelClass = 'economy' } = req.query;

    if (!flightId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid flight ID'
      });
    }

    // Check cache first
    const cacheKey = `flight:${flightId}:${passengers}:${travelClass}`;
    const cachedFlight = await cacheService.get(cacheKey);
    
    if (cachedFlight) {
      return res.json({
        success: true,
        data: JSON.parse(cachedFlight),
        cached: true
      });
    }

    const flight = await Flight.findById(flightId)
      .populate('route', 'from to fromCode toCode distance duration')
      .populate('aircraft', 'name manufacturer totalSeats seatConfiguration');

    if (!flight) {
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    // Calculate dynamic pricing
    const currentPrice = await pricingService.calculateDynamicPrice(
      flight,
      travelClass,
      parseInt(passengers)
    );

    const priceBreakdown = await pricingService.getPriceBreakdown(
      flight,
      travelClass,
      parseInt(passengers)
    );

    const flightWithPricing = {
      ...flight.toObject(),
      currentPrice,
      priceBreakdown,
      seatMap: await flightService.getSeatMap(flightId)
    };

    // Cache for 2 minutes
    await cacheService.set(cacheKey, JSON.stringify(flightWithPricing), 120);

    res.json({
      success: true,
      data: flightWithPricing
    });

  } catch (error) {
    logger.error('Get flight details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get available seats for a flight
router.get('/:flightId/seats', async (req, res) => {
  try {
    const { flightId } = req.params;
    const { class: travelClass = 'economy' } = req.query;

    if (!flightId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid flight ID'
      });
    }

    const seatMap = await flightService.getSeatMap(flightId, travelClass);

    res.json({
      success: true,
      data: {
        flightId,
        class: travelClass,
        seatMap,
        totalSeats: seatMap.length,
        availableSeats: seatMap.filter(seat => seat.status === 'available').length,
        blockedSeats: seatMap.filter(seat => seat.status === 'blocked').length,
        bookedSeats: seatMap.filter(seat => seat.status === 'booked').length
      }
    });

  } catch (error) {
    logger.error('Get seats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get popular routes
router.get('/routes/popular', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const cacheKey = `routes:popular:${limit}`;
    const cachedRoutes = await cacheService.get(cacheKey);

    if (cachedRoutes) {
      return res.json({
        success: true,
        data: JSON.parse(cachedRoutes),
        cached: true
      });
    }

    const popularRoutes = await Route.find({ status: 'active' })
      .sort({ popularity: -1, bookingCount: -1 })
      .limit(parseInt(limit))
      .select('from to fromCode toCode distance duration basePrice popularity');

    // Cache for 1 hour
    await cacheService.set(cacheKey, JSON.stringify(popularRoutes), 3600);

    res.json({
      success: true,
      data: popularRoutes
    });

  } catch (error) {
    logger.error('Get popular routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get airports/cities for autocomplete
router.get('/airports/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const cacheKey = `airports:search:${q.toLowerCase()}`;
    const cachedResults = await cacheService.get(cacheKey);

    if (cachedResults) {
      return res.json({
        success: true,
        data: JSON.parse(cachedResults),
        cached: true
      });
    }

    // Search in routes collection for unique cities/airports
    const routes = await Route.aggregate([
      {
        $match: {
          $or: [
            { from: { $regex: q, $options: 'i' } },
            { to: { $regex: q, $options: 'i' } },
            { fromCode: { $regex: q, $options: 'i' } },
            { toCode: { $regex: q, $options: 'i' } }
          ],
          status: 'active'
        }
      },
      {
        $group: {
          _id: null,
          cities: {
            $addToSet: {
              $cond: [
                { $regexMatch: { input: '$from', regex: q, options: 'i' } },
                { city: '$from', code: '$fromCode' },
                { city: '$to', code: '$toCode' }
              ]
            }
          }
        }
      },
      {
        $unwind: '$cities'
      },
      {
        $replaceRoot: { newRoot: '$cities' }
      },
      {
        $limit: 10
      }
    ]);

    // Cache for 1 hour
    await cacheService.set(cacheKey, JSON.stringify(routes), 3600);

    res.json({
      success: true,
      data: routes
    });

  } catch (error) {
    logger.error('Airport search error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Admin routes (protected)
// Create new flight
router.post('/', auth, flightManagementLimiter, flightValidation, async (req, res) => {
  try {
    // Check if user has admin/corporate role
    if (req.user.role !== 'admin' && req.user.role !== 'corporate') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin or corporate role required.'
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const flightData = req.body;
    
    // Check if flight number already exists for the same date
    const existingFlight = await Flight.findOne({
      flightNumber: flightData.flightNumber,
      departureTime: {
        $gte: new Date(flightData.departureTime).setHours(0, 0, 0, 0),
        $lt: new Date(flightData.departureTime).setHours(23, 59, 59, 999)
      }
    });

    if (existingFlight) {
      return res.status(409).json({
        success: false,
        message: 'Flight with this number already exists for the selected date'
      });
    }

    // Verify route exists
    const route = await Route.findById(flightData.route);
    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    }

    const flight = new Flight({
      ...flightData,
      createdBy: req.user.userId,
      status: 'scheduled'
    });

    await flight.save();

    // Invalidate related caches
    await cacheService.invalidatePattern(`flights:search:*`);
    await cacheService.invalidatePattern(`routes:popular:*`);

    logger.info(`Flight ${flight.flightNumber} created by user ${req.user.userId}`);

    res.status(201).json({
      success: true,
      message: 'Flight created successfully',
      data: flight
    });

  } catch (error) {
    logger.error('Create flight error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update flight
router.put('/:flightId', auth, flightManagementLimiter, async (req, res) => {
  try {
    // Check if user has admin/corporate role
    if (req.user.role !== 'admin' && req.user.role !== 'corporate') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin or corporate role required.'
      });
    }

    const { flightId } = req.params;
    
    if (!flightId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid flight ID'
      });
    }

    const flight = await Flight.findById(flightId);
    if (!flight) {
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    // Prevent updating flights that are already departed
    if (flight.status === 'departed' || flight.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update flight that has already departed'
      });
    }

    const updateData = req.body;
    delete updateData._id; // Remove _id if present
    delete updateData.createdBy; // Prevent changing creator

    const updatedFlight = await Flight.findByIdAndUpdate(
      flightId,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    // Invalidate related caches
    await cacheService.invalidatePattern(`flight:${flightId}:*`);
    await cacheService.invalidatePattern(`flights:search:*`);

    logger.info(`Flight ${updatedFlight.flightNumber} updated by user ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Flight updated successfully',
      data: updatedFlight
    });

  } catch (error) {
    logger.error('Update flight error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete flight
router.delete('/:flightId', auth, flightManagementLimiter, async (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    const { flightId } = req.params;
    
    if (!flightId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid flight ID'
      });
    }

    const flight = await Flight.findById(flightId);
    if (!flight) {
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    // Check if flight has bookings
    const bookingCount = await require('../models/Booking').countDocuments({ flight: flightId });
    if (bookingCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete flight with existing bookings. Cancel flight instead.'
      });
    }

    await Flight.findByIdAndDelete(flightId);

    // Invalidate related caches
    await cacheService.invalidatePattern(`flight:${flightId}:*`);
    await cacheService.invalidatePattern(`flights:search:*`);

    logger.info(`Flight ${flight.flightNumber} deleted by user ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Flight deleted successfully'
    });

  } catch (error) {
    logger.error('Delete flight error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;