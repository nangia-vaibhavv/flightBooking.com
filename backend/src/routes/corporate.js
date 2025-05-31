// backend/src/routes/corporate.js
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Booking = require('../models/Booking');
const Flight = require('../models/Flight');
const Route = require('../models/Route');
const User = require('../models/User');
const cacheService = require('../services/cacheService');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiting for corporate operations
const corporateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute
  message: 'Too many corporate requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware to check corporate/admin access
const requireCorporateAccess = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'corporate') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Corporate or admin role required.'
    });
  }
  next();
};

// Dashboard Overview
router.get('/dashboard', auth, requireCorporateAccess, corporateLimiter, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    // Calculate date range based on period
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const cacheKey = `corporate:dashboard:${period}:${startDate.toISOString()}`;
    const cachedData = await cacheService.get(cacheKey);
    
    if (cachedData) {
      return res.json({
        success: true,
        data: JSON.parse(cachedData),
        cached: true
      });
    }

    // Booking statistics
    const bookingStats = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          cancelledBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          pendingBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          averageBookingValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    // Daily booking trends
    const dailyTrends = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          bookings: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Top routes by bookings
    const topRoutes = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['confirmed', 'completed'] }
        }
      },
      {
        $lookup: {
          from: 'flights',
          localField: 'flight',
          foreignField: '_id',
          as: 'flightInfo'
        }
      },
      {
        $unwind: '$flightInfo'
      },
      {
        $lookup: {
          from: 'routes',
          localField: 'flightInfo.route',
          foreignField: '_id',
          as: 'routeInfo'
        }
      },
      {
        $unwind: '$routeInfo'
      },
      {
        $group: {
          _id: '$flightInfo.route',
          routeName: { $first: { $concat: ['$routeInfo.from', ' → ', '$routeInfo.to'] } },
          bookings: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
          passengers: { $sum: { $size: '$passengers' } }
        }
      },
      {
        $sort: { bookings: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Flight utilization
    const flightUtilization = await Flight.aggregate([
      {
        $lookup: {
          from: 'bookings',
          let: { flightId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$flight', '$$flightId'] },
                status: { $in: ['confirmed', 'completed'] },
                createdAt: { $gte: startDate }
              }
            }
          ],
          as: 'bookings'
        }
      },
      {
        $addFields: {
          bookedSeats: {
            $reduce: {
              input: '$bookings',
              initialValue: 0,
              in: { $add: ['$$value', { $size: '$$this.passengers' }] }
            }
          }
        }
      },
      {
        $addFields: {
          utilizationRate: {
            $multiply: [
              { $divide: ['$bookedSeats', '$totalSeats'] },
              100
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          averageUtilization: { $avg: '$utilizationRate' },
          totalFlights: { $sum: 1 },
          highUtilizationFlights: {
            $sum: { $cond: [{ $gte: ['$utilizationRate', 80] }, 1, 0] }
          },
          lowUtilizationFlights: {
            $sum: { $cond: [{ $lte: ['$utilizationRate', 50] }, 1, 0] }
          }
        }
      }
    ]);

    // User statistics
    const userStats = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          newUsers: { $sum: 1 },
          verifiedUsers: {
            $sum: { $cond: ['$isVerified', 1, 0] }
          }
        }
      }
    ]);

    // Revenue by class
    const revenueByClass = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['confirmed', 'completed'] }
        }
      },
      {
        $group: {
          _id: '$class',
          revenue: { $sum: '$totalAmount' },
          bookings: { $sum: 1 }
        }
      }
    ]);

    const dashboardData = {
      period,
      dateRange: {
        start: startDate,
        end: now
      },
      overview: bookingStats[0] || {
        totalBookings: 0,
        totalRevenue: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        pendingBookings: 0,
        averageBookingValue: 0
      },
      trends: {
        daily: dailyTrends
      },
      topRoutes,
      flightUtilization: flightUtilization[0] || {
        averageUtilization: 0,
        totalFlights: 0,
        highUtilizationFlights: 0,
        lowUtilizationFlights: 0
      },
      userStats: userStats[0] || {
        newUsers: 0,
        verifiedUsers: 0
      },
      revenueByClass
    };

    // Cache for 10 minutes
    await cacheService.set(cacheKey, JSON.stringify(dashboardData), 600);

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    logger.error('Corporate dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Revenue Analytics
router.get('/analytics/revenue', auth, requireCorporateAccess, corporateLimiter, [
  query('startDate').optional().isISO8601().withMessage('Valid start date required'),
  query('endDate').optional().isISO8601().withMessage('Valid end date required'),
  query('groupBy').optional().isIn(['day', 'week', 'month']).withMessage('Invalid groupBy value')
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

    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate = new Date(),
      groupBy = 'day'
    } = req.query;

    let groupByStage;
    switch (groupBy) {
      case 'week':
        groupByStage = {
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        };
        break;
      case 'month':
        groupByStage = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
      default: // day
        groupByStage = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
    }

    const revenueAnalytics = await Booking.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          },
          status: { $in: ['confirmed', 'completed'] }
        }
      },
      {
        $group: {
          _id: groupByStage,
          revenue: { $sum: '$totalAmount' },
          bookings: { $sum: 1 },
          passengers: { $sum: { $size: '$passengers' } }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        analytics: revenueAnalytics,
        summary: {
          totalRevenue: revenueAnalytics.reduce((sum, item) => sum + item.revenue, 0),
          totalBookings: revenueAnalytics.reduce((sum, item) => sum + item.bookings, 0),
          totalPassengers: revenueAnalytics.reduce((sum, item) => sum + item.passengers, 0),
          averageRevenuePerBooking: revenueAnalytics.length > 0 
            ? revenueAnalytics.reduce((sum, item) => sum + item.revenue, 0) / 
              revenueAnalytics.reduce((sum, item) => sum + item.bookings, 0)
            : 0
        }
      }
    });

  } catch (error) {
    logger.error('Revenue analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Route Performance
router.get('/analytics/routes', auth, requireCorporateAccess, corporateLimiter, [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('sortBy').optional().isIn(['bookings', 'revenue', 'utilization']).withMessage('Invalid sortBy value')
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

    const { limit = 20, sortBy = 'bookings' } = req.query;