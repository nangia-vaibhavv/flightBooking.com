// backend/src/models/Route.js
const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
  routeCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  source: {
    code: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    timezone: { type: String, required: true }
  },
  destination: {
    code: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    timezone: { type: String, required: true }
  },
  distance: {
    type: Number,
    required: true // in kilometers
  },
  averageFlightTime: {
    type: Number,
    required: true // in minutes
  },
  popularity: {
    type: Number,
    default: 1,
    min: 0.1,
    max: 5
  },
  pricing: {
    baseMultiplier: { type: Number, default: 1 },
    seasonalMultipliers: [{
      season: String,
      multiplier: Number,
      startDate: String, // MM-DD format
      endDate: String
    }],
    weekdayMultiplier: { type: Number, default: 1 },
    weekendMultiplier: { type: Number, default: 1.2 }
  },
  restrictions: {
    visaRequired: { type: Boolean, default: false },
    covidRestrictions: { type: Boolean, default: false },
    customsInfo: String
  },
  statistics: {
    totalFlights: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    averageOccupancy: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
routeSchema.index({ routeCode: 1 });
routeSchema.index({ 'source.code': 1, 'destination.code': 1 });
routeSchema.index({ isActive: 1 });
routeSchema.index({ popularity: -1 });

// Generate route code
routeSchema.pre('save', function(next) {
  if (!this.routeCode) {
    this.routeCode = `${this.source.code}-${this.destination.code}`;
  }
  next();
});

// Update statistics
routeSchema.methods.updateStatistics = async function() {
  const Flight = mongoose.model('Flight');
  const Booking = mongoose.model('Booking');
  
  try {
    // Count total flights for this route
    const totalFlights = await Flight.countDocuments({
      'route.source': this.source.code,
      'route.destination': this.destination.code
    });
    
    // Count total bookings
    const flights = await Flight.find({
      'route.source': this.source.code,
      'route.destination': this.destination.code
    }).select('_id');
    
    const flightIds = flights.map(f => f._id);
    const totalBookings = await Booking.countDocuments({
      flight: { $in: flightIds },
      status: { $in: ['confirmed', 'checked-in', 'boarded', 'completed'] }
    });
    
    // Calculate average occupancy
    const flightsWithCapacity = await Flight.aggregate([
      {
        $match: {
          'route.source': this.source.code,
          'route.destination': this.destination.code
        }
      },
      {
        $project: {
          occupancyRate: {
            $multiply: [
              { $divide: [
                { $subtract: ['$capacity.total', '$availability.total'] },
                '$capacity.total'
              ]},
              100
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          averageOccupancy: { $avg: '$occupancyRate' }
        }
      }
    ]);
    
    this.statistics = {
      totalFlights,
      totalBookings,
      averageOccupancy: flightsWithCapacity[0]?.averageOccupancy || 0,
      lastUpdated: new Date()
    };
    
    await this.save();
  } catch (error) {
    console.error('Error updating route statistics:', error);
  }
};

module.exports = mongoose.model('Route', routeSchema);