// routes/flights.js
const { Flight } = require('../models');

async function flightRoutes(fastify, options) {
  
  // Search flights (public route with rate limiting)
  fastify.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', minLength: 2 },
          to: { type: 'string', minLength: 2 },
          date: { type: 'string', format: 'date' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
        }
      }
    },
    preHandler: async (request, reply) => {
      await fastify.rateLimit({ max: 50, timeWindow: '5 minutes' })(request, reply);
    }
  }, async (request, reply) => {
    try {
      const { from, to, date, page = 1, limit = 10 } = request.query;
      
      // Build search query
      const searchQuery = {};
      if (from) searchQuery.from = { $regex: from, $options: 'i' };
      if (to) searchQuery.to = { $regex: to, $options: 'i' };
      if (date) {
        const searchDate = new Date(date);
        const nextDay = new Date(searchDate);
        nextDay.setDate(nextDay.getDate() + 1);
        searchQuery.date = { $gte: searchDate, $lt: nextDay };
      }
      
      // Only show bookable flights
      searchQuery.status = 'scheduled';
      searchQuery.date = { ...searchQuery.date, $gte: new Date() };

      const flights = await Flight.find(searchQuery)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .sort({ date: 1, departureTime: 1 });

      // Add dynamic pricing to each flight
      const flightsWithPricing = flights.map(flight => {
        const flightObj = flight.toObject();
        flightObj.currentPrice = flight.calculatePrice();
        flightObj.availableSeatsCount = flight.availableSeats.length;
        flightObj.isBookable = flight.isBookable();
        return flightObj;
      });

      const total = await Flight.countDocuments(searchQuery);

      reply.send({
        success: true,
        data: {
          flights: flightsWithPricing,
          pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total,
            hasNext: page < Math.ceil(total / limit),
            hasPrev: page > 1
          }
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error searching flights'
      });
    }
  });

  // Get flight by ID
  fastify.get('/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }
        },
        required: ['id']
      }
    }
  }, async (request, reply) => {
    try {
      const flight = await Flight.findById(request.params.id);
      
      if (!flight) {
        return reply.code(404).send({
          success: false,
          message: 'Flight not found'
        });
      }

      const flightData = flight.toObject();
      flightData.currentPrice = flight.calculatePrice();
      flightData.availableSeatsCount = flight.availableSeats.length;
      flightData.isBookable = flight.isBookable();

      reply.send({
        success: true,
        data: { flight: flightData }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching flight'
      });
    }
  });

  // Get available seats for a flight
  fastify.get('/:id/seats', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }
        },
        required: ['id']
      }
    }
  }, async (request, reply) => {
    try {
      const flight = await Flight.findById(request.params.id);
      
      if (!flight) {
        return reply.code(404).send({
          success: false,
          message: 'Flight not found'
        });
      }

      reply.send({
        success: true,
        data: {
          availableSeats: flight.availableSeats,
          bookedSeats: flight.bookedSeats,
          totalSeats: flight.totalSeats
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching seats'
      });
    }
  });

  // Admin: Get all flights
  fastify.get('/', {
    preHandler: fastify.requireAdmin,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['scheduled', 'boarding', 'departed', 'arrived', 'cancelled'] },
          airline: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { page = 1, limit = 20, status, airline, from, to } = request.query;
      
      const query = {};
      if (status) query.status = status;
      if (airline) query.airline = { $regex: airline, $options: 'i' };
      if (from) query.from = { $regex: from, $options: 'i' };
      if (to) query.to = { $regex: to, $options: 'i' };

      const flights = await Flight.find(query)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .sort({ date: -1, departureTime: -1 });

      const total = await Flight.countDocuments(query);

      reply.send({
        success: true,
        data: {
          flights,
          pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total
          }
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching flights'
      });
    }
  });

  // Admin: Create new flight
  fastify.post('/', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['airline', 'flightNumber', 'from', 'to', 'date', 'departureTime', 'arrivalTime', 'basePrice', 'totalSeats'],
        properties: {
          airline: { type: 'string', minLength: 2, maxLength: 50 },
          flightNumber: { type: 'string', pattern: '^[A-Z0-9]{2,3}-?\\d{3,4}$' },
          from: { type: 'string', minLength: 2, maxLength: 50 },
          to: { type: 'string', minLength: 2, maxLength: 50 },
          date: { type: 'string', format: 'date' },
          departureTime: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
          arrivalTime: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
          basePrice: { type: 'number', minimum: 0, maximum: 100000 },
          totalSeats: { type: 'number', minimum: 1, maximum: 500 },
          aircraft: { type: 'string' },
          gate: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const flightData = request.body;
      
      // Check if flight number already exists
      const existingFlight = await Flight.findOne({ flightNumber: flightData.flightNumber });
      if (existingFlight) {
        return reply.code(400).send({
          success: false,
          message: 'Flight number already exists'
        });
      }

      // Create new flight
      const flight = new Flight(flightData);
      
      // Generate seat configuration
      flight.generateSeats();
      
      await flight.save();

      reply.code(201).send({
        success: true,
        message: 'Flight created successfully',
        data: { flight }
      });

    } catch (error) {
      fastify.log.error(error);
      
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return reply.code(400).send({
          success: false,
          message: 'Validation error',
          errors: messages
        });
      }

      reply.code(500).send({
        success: false,
        message: 'Server error creating flight'
      });
    }
  });

  // Admin: Update flight
  fastify.put('/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }
        },
        required: ['id']
      },
      body: {
        type: 'object',
        properties: {
          airline: { type: 'string', minLength: 2, maxLength: 50 },
          from: { type: 'string', minLength: 2, maxLength: 50 },
          to: { type: 'string', minLength: 2, maxLength: 50 },
          date: { type: 'string', format: 'date' },
          departureTime: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
          arrivalTime: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
          basePrice: { type: 'number', minimum: 0, maximum: 100000 },
          status: { type: 'string', enum: ['scheduled', 'boarding', 'departed', 'arrived', 'cancelled'] },
          aircraft: { type: 'string' },
          gate: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const flight = await Flight.findByIdAndUpdate(
        request.params.id,
        request.body,
        { new: true, runValidators: true }
      );

      if (!flight) {
        return reply.code(404).send({
          success: false,
          message: 'Flight not found'
        });
      }

      reply.send({
        success: true,
        message: 'Flight updated successfully',
        data: { flight }
      });

    } catch (error) {
      fastify.log.error(error);
      
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return reply.code(400).send({
          success: false,
          message: 'Validation error',
          errors: messages
        });
      }

      reply.code(500).send({
        success: false,
        message: 'Server error updating flight'
      });
    }
  });

  // Admin: Delete flight
  fastify.delete('/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }
        },
        required: ['id']
      }
    }
  }, async (request, reply) => {
    try {
      const flight = await Flight.findById(request.params.id);
      
      if (!flight) {
        return reply.code(404).send({
          success: false,
          message: 'Flight not found'
        });
      }

      // Check if flight has bookings
      const { Booking } = require('../models');
      const bookingCount = await Booking.countDocuments({ flight: flight._id });
      
      if (bookingCount > 0) {
        return reply.code(400).send({
          success: false,
          message: 'Cannot delete flight with existing bookings'
        });
      }

      await Flight.findByIdAndDelete(request.params.id);

      reply.send({
        success: true,
        message: 'Flight deleted successfully'
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error deleting flight'
      });
    }
  });

  // Admin: Get flight statistics
  fastify.get('/stats/dashboard', {
    preHandler: fastify.requireAdmin
  }, async (request, reply) => {
    try {
      const totalFlights = await Flight.countDocuments();
      const activeFlights = await Flight.countDocuments({ status: 'scheduled' });
      const todayFlights = await Flight.countDocuments({
        date: {
          $gte: new Date().setHours(0, 0, 0, 0),
          $lt: new Date().setHours(23, 59, 59, 999)
        }
      });

      // Get flights by status
      const flightsByStatus = await Flight.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Get popular routes
      const popularRoutes = await Flight.aggregate([
        {
          $group: {
            _id: { from: '$from', to: '$to' },
            count: { $sum: 1 },
            avgPrice: { $avg: '$basePrice' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      reply.send({
        success: true,
        data: {
          totalFlights,
          activeFlights,
          todayFlights,
          flightsByStatus,
          popularRoutes
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching flight statistics'
      });
    }
  });
}

module.exports = flightRoutes;