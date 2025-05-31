// routes/bookings.js
const { Booking, Flight, User } = require('../models');
const { v4: uuidv4 } = require('uuid');

async function bookingRoutes(fastify, options) {
  
  // Create a new booking
  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['flightId', 'seatNumber', 'passengerName'],
        properties: {
          flightId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          seatNumber: { type: 'string', minLength: 2, maxLength: 4 },
          passengerName: { type: 'string', minLength: 2, maxLength: 100 },
          passengerEmail: { type: 'string', format: 'email' },
          passengerPhone: { type: 'string', minLength: 10, maxLength: 15 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { flightId, seatNumber, passengerName, passengerEmail, passengerPhone } = request.body;
      const userId = request.user.id;

      // Find the flight
      const flight = await Flight.findById(flightId);
      if (!flight) {
        return reply.code(404).send({
          success: false,
          message: 'Flight not found'
        });
      }

      // Check if flight is bookable
      if (!flight.isBookable()) {
        return reply.code(400).send({
          success: false,
          message: 'Flight is not available for booking'
        });
      }

      // Check if seat is available
      if (!flight.availableSeats.includes(seatNumber)) {
        return reply.code(400).send({
          success: false,
          message: 'Selected seat is not available'
        });
      }

      // Check if user already has a booking for this flight
      const existingBooking = await Booking.findOne({
        user: userId,
        flight: flightId,
        status: { $in: ['confirmed', 'checked-in'] }
      });

      if (existingBooking) {
        return reply.code(400).send({
          success: false,
          message: 'You already have a booking for this flight'
        });
      }

      // Calculate current price with dynamic pricing
      const currentPrice = flight.calculatePrice();

      // Create booking reference
      const bookingReference = `BK${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      // Create the booking
      const booking = new Booking({
        user: userId,
        flight: flightId,
        seatNumber,
        passengerName: passengerName.trim(),
        passengerEmail: passengerEmail?.toLowerCase().trim(),
        passengerPhone: passengerPhone?.trim(),
        price: currentPrice,
        bookingReference,
        status: 'confirmed'
      });

      // Use transaction to ensure consistency
      const session = await fastify.mongoose.startSession();
      session.startTransaction();

      try {
        // Save booking
        await booking.save({ session });

        // Update flight seats
        await Flight.findByIdAndUpdate(
          flightId,
          {
            $pull: { availableSeats: seatNumber },
            $push: { bookedSeats: seatNumber }
          },
          { session }
        );

        await session.commitTransaction();
        
        // Populate flight details for response
        await booking.populate('flight', 'airline flightNumber from to date departureTime arrivalTime');

        reply.code(201).send({
          success: true,
          message: 'Booking created successfully',
          data: { booking }
        });

      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }

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
        message: 'Server error creating booking'
      });
    }
  });

  // Get user's bookings
  fastify.get('/', {
    preHandler: fastify.authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          status: { type: 'string', enum: ['confirmed', 'cancelled', 'checked-in', 'completed'] },
          upcoming: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { page = 1, limit = 10, status, upcoming } = request.query;
      const userId = request.user.id;

      // Build query
      const query = { user: userId };
      if (status) query.status = status;
      
      // Filter for upcoming flights if specified
      let flightQuery = {};
      if (upcoming) {
        flightQuery.date = { $gte: new Date() };
      }

      const bookings = await Booking.find(query)
        .populate({
          path: 'flight',
          match: flightQuery,
          select: 'airline flightNumber from to date departureTime arrivalTime status gate aircraft'
        })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .sort({ createdAt: -1 });

      // Filter out bookings where flight doesn't match the criteria
      const filteredBookings = bookings.filter(booking => booking.flight !== null);

      const total = await Booking.countDocuments(query);

      reply.send({
        success: true,
        data: {
          bookings: filteredBookings,
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
        message: 'Server error fetching bookings'
      });
    }
  });

  // Get booking by ID
  fastify.get('/:id', {
    preHandler: fastify.authenticate,
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
      const bookingId = request.params.id;
      const userId = request.user.id;
      const userRole = request.user.role;

      // Build query - users can only see their own bookings, admins can see all
      const query = { _id: bookingId };
      if (userRole !== 'admin') {
        query.user = userId;
      }

      const booking = await Booking.findOne(query)
        .populate('flight', 'airline flightNumber from to date departureTime arrivalTime status gate aircraft')
        .populate('user', 'name email');

      if (!booking) {
        return reply.code(404).send({
          success: false,
          message: 'Booking not found'
        });
      }

      reply.send({
        success: true,
        data: { booking }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching booking'
      });
    }
  });

  // Get booking by reference number
  fastify.get('/reference/:reference', {
    schema: {
      params: {
        type: 'object',
        properties: {
          reference: { type: 'string', minLength: 6, maxLength: 20 }
        },
        required: ['reference']
      }
    }
  }, async (request, reply) => {
    try {
      const bookingReference = request.params.reference.toUpperCase();

      const booking = await Booking.findOne({ bookingReference })
        .populate('flight', 'airline flightNumber from to date departureTime arrivalTime status gate aircraft')
        .populate('user', 'name email');

      if (!booking) {
        return reply.code(404).send({
          success: false,
          message: 'Booking not found'
        });
      }

      reply.send({
        success: true,
        data: { booking }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching booking'
      });
    }
  });

  // Cancel booking
  fastify.put('/:id/cancel', {
    preHandler: fastify.authenticate,
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
          reason: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const bookingId = request.params.id;
      const userId = request.user.id;
      const userRole = request.user.role;
      const { reason } = request.body || {};

      // Find booking
      const query = { _id: bookingId };
      if (userRole !== 'admin') {
        query.user = userId;
      }

      const booking = await Booking.findOne(query).populate('flight');

      if (!booking) {
        return reply.code(404).send({
          success: false,
          message: 'Booking not found'
        });
      }

      // Check if booking can be cancelled
      if (booking.status === 'cancelled') {
        return reply.code(400).send({
          success: false,
          message: 'Booking is already cancelled'
        });
      }

      if (booking.status === 'completed') {
        return reply.code(400).send({
          success: false,
          message: 'Cannot cancel completed booking'
        });
      }

      // Check cancellation policy (e.g., can't cancel within 2 hours of departure)
      const flightDateTime = new Date(`${booking.flight.date.toISOString().split('T')[0]}T${booking.flight.departureTime}`);
      const now = new Date();
      const timeDifference = flightDateTime.getTime() - now.getTime();
      const hoursDifference = timeDifference / (1000 * 3600);

      if (hoursDifference < 2 && userRole !== 'admin') {
        return reply.code(400).send({
          success: false,
          message: 'Cannot cancel booking within 2 hours of departure'
        });
      }

      // Use transaction for consistency
      const session = await fastify.mongoose.startSession();
      session.startTransaction();

      try {
        // Update booking status
        await Booking.findByIdAndUpdate(
          bookingId,
          {
            status: 'cancelled',
            cancellationReason: reason,
            cancelledAt: new Date()
          },
          { session }
        );

        // Release the seat back to available seats
        await Flight.findByIdAndUpdate(
          booking.flight._id,
          {
            $pull: { bookedSeats: booking.seatNumber },
            $push: { availableSeats: booking.seatNumber }
          },
          { session }
        );

        await session.commitTransaction();

        reply.send({
          success: true,
          message: 'Booking cancelled successfully'
        });

      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error cancelling booking'
      });
    }
  });

  // Check-in for booking
  fastify.put('/:id/checkin', {
    preHandler: fastify.authenticate,
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
      const bookingId = request.params.id;
      const userId = request.user.id;
      const userRole = request.user.role;

      // Find booking
      const query = { _id: bookingId };
      if (userRole !== 'admin') {
        query.user = userId;
      }

      const booking = await Booking.findOne(query).populate('flight');

      if (!booking) {
        return reply.code(404).send({
          success: false,
          message: 'Booking not found'
        });
      }

      // Check if booking can be checked in
      if (booking.status !== 'confirmed') {
        return reply.code(400).send({
          success: false,
          message: 'Only confirmed bookings can be checked in'
        });
      }

      // Check if check-in is allowed (e.g., 24 hours before to 1 hour before departure)
      const flightDateTime = new Date(`${booking.flight.date.toISOString().split('T')[0]}T${booking.flight.departureTime}`);
      const now = new Date();
      const timeDifference = flightDateTime.getTime() - now.getTime();
      const hoursDifference = timeDifference / (1000 * 3600);

      if (hoursDifference > 24) {
        return reply.code(400).send({
          success: false,
          message: 'Check-in opens 24 hours before departure'
        });
      }

      if (hoursDifference < 1) {
        return reply.code(400).send({
          success: false,
          message: 'Check-in closes 1 hour before departure'
        });
      }

      // Update booking status
      await Booking.findByIdAndUpdate(bookingId, {
        status: 'checked-in',
        checkedInAt: new Date()
      });

      reply.send({
        success: true,
        message: 'Check-in successful'
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error during check-in'
      });
    }
  });

  // Admin: Get all bookings
  fastify.get('/admin/all', {
    preHandler: fastify.requireAdmin,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['confirmed', 'cancelled', 'checked-in', 'completed'] },
          flightId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          userId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
          search: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { page = 1, limit = 20, status, flightId, userId, search } = request.query;
      
      // Build query
      const query = {};
      if (status) query.status = status;
      if (flightId) query.flight = flightId;
      if (userId) query.user = userId;

      let bookings;
      if (search) {
        // Search by booking reference or passenger name
        bookings = await Booking.find({
          ...query,
          $or: [
            { bookingReference: { $regex: search, $options: 'i' } },
            { passengerName: { $regex: search, $options: 'i' } }
          ]
        })
        .populate('flight', 'airline flightNumber from to date departureTime')
        .populate('user', 'name email')
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .sort({ createdAt: -1 });
      } else {
        bookings = await Booking.find(query)
          .populate('flight', 'airline flightNumber from to date departureTime')
          .populate('user', 'name email')
          .limit(limit * 1)
          .skip((page - 1) * limit)
          .sort({ createdAt: -1 });
      }

      const total = await Booking.countDocuments(query);

      reply.send({
        success: true,
        data: {
          bookings,
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
        message: 'Server error fetching bookings'
      });
    }
  });

  // Admin: Get booking statistics
  fastify.get('/admin/stats', {
    preHandler: fastify.requireAdmin
  }, async (request, reply) => {
    try {
      const totalBookings = await Booking.countDocuments();
      const confirmedBookings = await Booking.countDocuments({ status: 'confirmed' });
      const cancelledBookings = await Booking.countDocuments({ status: 'cancelled' });
      const checkedInBookings = await Booking.countDocuments({ status: 'checked-in' });

      // Bookings by status
      const bookingsByStatus = await Booking.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Revenue calculation
      const revenueData = await Booking.aggregate([
        {
          $match: { status: { $in: ['confirmed', 'checked-in', 'completed'] } }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$price' },
            averagePrice: { $avg: '$price' }
          }
        }
      ]);

      // Recent bookings
      const recentBookings = await Booking.find()
        .populate('flight', 'airline flightNumber from to')
        .populate('user', 'name email')
        .limit(10)
        .sort({ createdAt: -1 });

      reply.send({
        success: true,
        data: {
          totalBookings,
          confirmedBookings,
          cancelledBookings,
          checkedInBookings,
          bookingsByStatus,
          revenue: revenueData[0] || { totalRevenue: 0, averagePrice: 0 },
          recentBookings
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching booking statistics'
      });
    }
  });

  // Get flight bookings (for flight management)
  fastify.get('/flight/:flightId', {
    preHandler: fastify.requireAdmin,
    schema: {
      params: {
        type: 'object',
        properties: {
          flightId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }
        },
        required: ['flightId']
      },
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['confirmed', 'cancelled', 'checked-in', 'completed'] }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { flightId } = request.params;
      const { status } = request.query;

      const query = { flight: flightId };
      if (status) query.status = status;

      const bookings = await Booking.find(query)
        .populate('user', 'name email')
        .sort({ seatNumber: 1 });

      const bookingStats = {
        total: bookings.length,
        confirmed: bookings.filter(b => b.status === 'confirmed').length,
        checkedIn: bookings.filter(b => b.status === 'checked-in').length,
        cancelled: bookings.filter(b => b.status === 'cancelled').length
      };

      reply.send({
        success: true,
        data: {
          bookings,
          stats: bookingStats
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching flight bookings'
      });
    }
  });
}

module.exports = bookingRoutes;