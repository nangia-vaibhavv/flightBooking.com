// backend/src/routes/bookings.js
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Booking = require('../models/Booking');
const Flight = require('../models/Flight');
const User = require('../models/User');
const bookingService = require('../services/bookingService');
const seatBlockingService = require('../services/seatBlockingService');
const pricingService = require('../services/pricingService');
const emailService = require('../services/emailService');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiting for booking operations
const bookingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // limit each user to 5 booking attempts per 5 minutes
  message: 'Too many booking attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each user to 3 payment attempts per 15 minutes
  message: 'Too many payment attempts, please try again later.',
});

// Validation middleware
const seatHoldValidation = [
  body('flightId').isMongoId().withMessage('Valid flight ID is required'),
  body('seats').isArray({ min: 1, max: 9 }).withMessage('Seats array is required (1-9 seats)'),
  body('seats.*').isString().withMessage('Each seat must be a string'),
  body('class').isIn(['economy', 'business', 'first']).withMessage('Invalid class type')
];

const bookingValidation = [
  body('flightId').isMongoId().withMessage('Valid flight ID is required'),
  body('passengers').isArray({ min: 1, max: 9 }).withMessage('Passengers array is required (1-9 passengers)'),
  body('passengers.*.firstName').notEmpty().withMessage('Passenger first name is required'),
  body('passengers.*.lastName').notEmpty().withMessage('Passenger last name is required'),
  body('passengers.*.dateOfBirth').isISO8601().withMessage('Valid date of birth is required'),
  body('passengers.*.gender').isIn(['male', 'female', 'other']).withMessage('Valid gender is required'),
  body('passengers.*.seatNumber').notEmpty().withMessage('Seat number is required'),
  body('class').isIn(['economy', 'business', 'first']).withMessage('Invalid class type'),
  body('contactInfo.email').isEmail().withMessage('Valid email is required'),
  body('contactInfo.phone').isMobilePhone().withMessage('Valid phone number is required')
];

const paymentValidation = [
  body('bookingId').isMongoId().withMessage('Valid booking ID is required'),
  body('paymentMethod').isIn(['card', 'upi', 'netbanking']).withMessage('Valid payment method is required'),
  body('paymentDetails').isObject().withMessage('Payment details are required')
];

// Hold seats temporarily
router.post('/hold-seats', auth, bookingLimiter, seatHoldValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { flightId, seats, class: travelClass } = req.body;
    const userId = req.user.userId;

    // Verify flight exists
    const flight = await Flight.findById(flightId);
    if (!flight) {
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    // Check if flight is still available for booking
    if (flight.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        message: 'Flight is not available for booking'
      });
    }

    // Hold seats
    const holdResult = await seatBlockingService.holdSeats(flightId, seats, userId, travelClass);

    if (!holdResult.success) {
      return res.status(400).json({
        success: false,
        message: holdResult.message,
        unavailableSeats: holdResult.unavailableSeats
      });
    }

    // Calculate pricing for held seats
    const pricing = await pricingService.calculateDynamicPrice(flight, travelClass, seats.length);
    const priceBreakdown = await pricingService.getPriceBreakdown(flight, travelClass, seats.length);

    res.json({
      success: true,
      message: 'Seats held successfully',
      data: {
        holdId: holdResult.holdId,
        flightId,
        seats: holdResult.heldSeats,
        class: travelClass,
        holdExpiresAt: holdResult.expiresAt,
        pricing: {
          totalPrice: pricing,
          breakdown: priceBreakdown
        }
      }
    });

  } catch (error) {
    logger.error('Hold seats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during seat holding'
    });
  }
});

// Release held seats
router.post('/release-seats', auth, [
  body('holdId').notEmpty().withMessage('Hold ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { holdId } = req.body;
    const userId = req.user.userId;

    const releaseResult = await seatBlockingService.releaseSeats(holdId, userId);

    if (!releaseResult.success) {
      return res.status(400).json({
        success: false,
        message: releaseResult.message
      });
    }

    res.json({
      success: true,
      message: 'Seats released successfully',
      data: {
        releasedSeats: releaseResult.releasedSeats
      }
    });

  } catch (error) {
    logger.error('Release seats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during seat release'
    });
  }
});

// Create booking
router.post('/', auth, bookingLimiter, bookingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const bookingData = {
      ...req.body,
      userId: req.user.userId
    };

    // Create booking
    const booking = await bookingService.createBooking(bookingData);

    // Send booking confirmation email
    try {
      const user = await User.findById(req.user.userId);
      const flight = await Flight.findById(booking.flight).populate('route');
      
      await emailService.sendBookingConfirmation(
        booking.contactInfo.email,
        {
          bookingReference: booking.bookingReference,
          passengerName: `${user.firstName} ${user.lastName}`,
          flight: {
            flightNumber: flight.flightNumber,
            airline: flight.airline,
            from: flight.route.from,
            to: flight.route.to,
            departureTime: flight.departureTime,
            arrivalTime: flight.arrivalTime
          },
          passengers: booking.passengers,
          totalAmount: booking.totalAmount
        }
      );
    } catch (emailError) {
      logger.error('Failed to send booking confirmation email:', emailError);
      // Continue with booking creation even if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: booking
    });

  } catch (error) {
    logger.error('Create booking error:', error);
    
    if (error.name === 'BookingError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error during booking creation'
    });
  }
});

// Process payment
router.post('/payment', auth, paymentLimiter, paymentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { bookingId, paymentMethod, paymentDetails } = req.body;
    const userId = req.user.userId;

    // Find booking
    const booking = await Booking.findOne({ 
      _id: bookingId, 
      userId: userId,
      status: 'pending'
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or already processed'
      });
    }

    // Check if payment is still valid (booking not expired)
    if (booking.expiresAt && new Date() > booking.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Booking has expired'
      });
    }

    // Process payment (mock implementation for demo)
    const paymentResult = await bookingService.processPayment({
      bookingId,
      amount: booking.totalAmount,
      paymentMethod,
      paymentDetails,
      userId
    });

    if (!paymentResult.success) {
      return res.status(400).json({
        success: false,
        message: paymentResult.message
      });
    }

    // Update booking status
    booking.status = 'confirmed';
    booking.paymentStatus = 'completed';
    booking.paymentDetails = {
      method: paymentMethod,
      transactionId: paymentResult.transactionId,
      paidAt: new Date()
    };
    await booking.save();

    // Send payment confirmation email
    try {
      const user = await User.findById(userId);
      const flight = await Flight.findById(booking.flight).populate('route');
      
      await emailService.sendPaymentConfirmation(
        booking.contactInfo.email,
        {
          bookingReference: booking.bookingReference,
          passengerName: `${user.firstName} ${user.lastName}`,
          transactionId: paymentResult.transactionId,
          amount: booking.totalAmount,
          flight: {
            flightNumber: flight.flightNumber,
            airline: flight.airline,
            from: flight.route.from,
            to: flight.route.to,
            departureTime: flight.departureTime
          }
        }
      );
    } catch (emailError) {
      logger.error('Failed to send payment confirmation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Payment processed successfully',
      data: {
        bookingReference: booking.bookingReference,
        transactionId: paymentResult.transactionId,
        status: booking.status,
        paymentStatus: booking.paymentStatus
      }
    });

  } catch (error) {
    logger.error('Payment processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during payment processing'
    });
  }
});

// Get user bookings
router.get('/my-bookings', auth, [
  query('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'completed']).withMessage('Invalid status'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { status, page = 1, limit = 10 } = req.query;
    const userId = req.user.userId;

    const filter = { userId };
    if (status) {
      filter.status = status;
    }

    const bookings = await Booking.find(filter)
      .populate('flight', 'flightNumber airline departureTime arrivalTime status')
      .populate('flight.route', 'from to fromCode toCode')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const totalBookings = await Booking.countDocuments(filter);

    res.json({
      success: true,
      data: bookings,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalBookings / parseInt(limit)),
        totalBookings,
        hasNext: page * limit < totalBookings,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get user bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get booking details by ID
router.get('/:bookingId', auth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.userId;

    if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findOne({ _id: bookingId, userId })
      .populate('flight')
      .populate('flight.route');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking
    });

  } catch (error) {
    logger.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Cancel booking
router.post('/:bookingId/cancel', auth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.userId;
    const { reason } = req.body;

    if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findOne({ 
      _id: bookingId, 
      userId,
      status: { $in: ['pending', 'confirmed'] }
    }).populate('flight');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or cannot be cancelled'
      });
    }

    // Check if flight departure is more than 2 hours away
    const now = new Date();
    const departureTime = new Date(booking.flight.departureTime);
    const timeDiff = departureTime.getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 3600);

    if (hoursDiff <= 2) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel booking less than 2 hours before departure'
      });
    }

    // Cancel booking
    const cancelResult = await bookingService.cancelBooking(bookingId, userId, reason);

    if (!cancelResult.success) {
      return res.status(400).json({
        success: false,
        message: cancelResult.message
      });
    }

    // Send cancellation email
    try {
      const user = await User.findById(userId);
      await emailService.sendBookingCancellation(
        booking.contactInfo.email,
        {
          bookingReference: booking.bookingReference,
          passengerName: `${user.firstName} ${user.lastName}`,
          flight: {
            flightNumber: booking.flight.flightNumber,
            airline: booking.flight.airline,
            departureTime: booking.flight.departureTime
          },
          refundAmount: cancelResult.refundAmount,
          refundMethod: 'Original payment method'
        }
      );
    } catch (emailError) {
      logger.error('Failed to send cancellation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        bookingReference: booking.bookingReference,
        refundAmount: cancelResult.refundAmount,
        cancellationFee: cancelResult.cancellationFee
      }
    });

  } catch (error) {
    logger.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during cancellation'
    });
  }
});

// Get booking by reference number (for guest access)
router.get('/reference/:reference', [
  body('email').optional().isEmail().withMessage('Valid email required for verification')
], async (req, res) => {
  try {
    const { reference } = req.params;
    const { email } = req.body;

    if (!reference || reference.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Valid booking reference is required'
      });
    }

    const booking = await Booking.findOne({ bookingReference: reference.toUpperCase() })
      .populate('flight')
      .populate('flight.route');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // If email is provided, verify it matches
    if (email && booking.contactInfo.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'Email verification failed'
      });
    }

    // Return limited booking information for security
    const limitedBooking = {
      bookingReference: booking.bookingReference,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      flight: {
        flightNumber: booking.flight.flightNumber,
        airline: booking.flight.airline,
        route: booking.flight.route,
        departureTime: booking.flight.departureTime,
        arrivalTime: booking.flight.arrivalTime
      },
      passengers: booking.passengers.map(p => ({
        firstName: p.firstName,
        lastName: p.lastName,
        seatNumber: p.seatNumber
      })),
      class: booking.class,
      totalAmount: booking.totalAmount,
      createdAt: booking.createdAt
    };

    res.json({
      success: true,
      data: limitedBooking
    });

  } catch (error) {
    logger.error('Get booking by reference error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Admin routes - Get all bookings (protected)
router.get('/admin/all', auth, [
  query('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'completed']).withMessage('Invalid status'),
  query('flightId').optional().isMongoId().withMessage('Valid flight ID required'),
  query('userId').optional().isMongoId().withMessage('Valid user ID required'),
  query('fromDate').optional().isISO8601().withMessage('Valid from date required'),
  query('toDate').optional().isISO8601().withMessage('Valid to date required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], async (req, res) => {
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

    const {
      status,
      flightId,
      userId,
      fromDate,
      toDate,
      page = 1,
      limit = 20
    } = req.query;

    const filter = {};
    
    if (status) filter.status = status;
    if (flightId) filter.flight = flightId;
    if (userId) filter.userId = userId;
    
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const bookings = await Booking.find(filter)
      .populate('userId', 'firstName lastName email')
      .populate('flight', 'flightNumber airline departureTime arrivalTime')
      .populate('flight.route', 'from to fromCode toCode')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const totalBookings = await Booking.countDocuments(filter);

    // Calculate summary statistics
    const stats = await Booking.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalBookings: { $sum: 1 },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          cancelledBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          pendingBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: bookings,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalBookings / parseInt(limit)),
        totalBookings,
        hasNext: page * limit < totalBookings,
        hasPrev: page > 1
      },
      statistics: stats[0] || {
        totalRevenue: 0,
        totalBookings: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        pendingBookings: 0
      }
    });

  } catch (error) {
    logger.error('Get all bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Admin route - Update booking status
router.put('/admin/:bookingId/status', auth, [
  body('status').isIn(['pending', 'confirmed', 'cancelled', 'completed']).withMessage('Invalid status'),
  body('reason').optional().isString().withMessage('Reason must be a string')
], async (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
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

    const { bookingId } = req.params;
    const { status, reason } = req.body;

    if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findById(bookingId)
      .populate('userId', 'firstName lastName email')
      .populate('flight', 'flightNumber airline departureTime');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const oldStatus = booking.status;
    booking.status = status;
    
    // Add admin action to booking history
    if (!booking.adminActions) {
      booking.adminActions = [];
    }
    
    booking.adminActions.push({
      action: `Status changed from ${oldStatus} to ${status}`,
      reason: reason || 'No reason provided',
      performedBy: req.user.userId,
      performedAt: new Date()
    });

    await booking.save();

    // Send notification email if status changed to cancelled
    if (status === 'cancelled' && oldStatus !== 'cancelled') {
      try {
        await emailService.sendBookingCancellation(
          booking.contactInfo.email,
          {
            bookingReference: booking.bookingReference,
            passengerName: `${booking.userId.firstName} ${booking.userId.lastName}`,
            flight: {
              flightNumber: booking.flight.flightNumber,
              airline: booking.flight.airline,
              departureTime: booking.flight.departureTime
            },
            reason: reason || 'Cancelled by airline',
            refundAmount: booking.totalAmount,
            refundMethod: 'Original payment method'
          }
        );
      } catch (emailError) {
        logger.error('Failed to send admin cancellation email:', emailError);
      }
    }

    logger.info(`Booking ${booking.bookingReference} status updated to ${status} by admin ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Booking status updated successfully',
      data: {
        bookingReference: booking.bookingReference,
        oldStatus,
        newStatus: status,
        updatedAt: new Date()
      }
    });

  } catch (error) {
    logger.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;