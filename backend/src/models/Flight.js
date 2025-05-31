// backend/src/models/Flight.js
const mongoose = require('mongoose');

const seatSchema = new mongoose.Schema({
  seatNumber: {
    type: String,
    required: true
  },
  class: {
    type: String,
    enum: ['economy', 'business', 'first'],
    required: true
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  price: {
    type: Number,
    required: true
  },
  features: [String] // ['window', 'aisle', 'extra-legroom']
});

const flightSchema = new mongoose.Schema({
  flightNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  airline: {
    type: String,
    required: true
  },
  aircraft: {
    type: String,
    required: true
  },
  route: {
    source: {
      type: String,
      required: true,
      uppercase: true
    },
    destination: {
      type: String,
      required: true,
      uppercase: true
    }
  },
  schedule: {
    departureTime: {
      type: Date,
      required: true
    },
    arrivalTime: {
      type: Date,
      required: true
    },
    duration: {
      type: Number, // minutes
      required: true
    }
  },
  pricing: {
    basePrice: {
      type: Number,
      required: true,
      min: 0
    },
    currentPrice: {
      type: Number,
      required: true,
      min: 0
    },
    dynamicPricing: {
      enabled: { type: Boolean, default: true },
      factors: {
        timeMultiplier: { type: Number, default: 1 },
        demandMultiplier: { type: Number, default: 1 },
        routeMultiplier: { type: Number, default: 1 }
      }
    }
  },
  seats: [seatSchema],
  capacity: {
    total: { type: Number, required: true },
    economy: { type: Number, required: true },
    business: { type: Number, default: 0 },
    first: { type: Number, default: 0 }
  },
  availability: {
    total: { type: Number, required: true },
    economy: { type: Number, required: true },
    business: { type: Number, default: 0 },
    first: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: ['scheduled', 'boarding', 'departed', 'arrived', 'cancelled', 'delayed'],
    default: 'scheduled'
  },
  gate: String,
  terminal: String,
  checkinCounter: String,
  baggage: {
    allowance: { type: Number, default: 20 }, // kg
    maxWeight: { type: Number, default: 32 }  // kg per bag
  },
  amenities: [String], // ['wifi', 'meal', 'entertainment']
  restrictions: [String] // ['no-liquids', 'id-required']
}, {
  timestamps: true
});

// Indexes for better query performance
flightSchema.index({ flightNumber: 1 });
flightSchema.index({ 'route.source': 1, 'route.destination': 1 });
flightSchema.index({ 'schedule.departureTime': 1 });
flightSchema.index({ status: 1 });
flightSchema.index({ 'route.source': 1, 'route.destination': 1, 'schedule.departureTime': 1 });

// Calculate duration before saving
flightSchema.pre('save', function(next) {
  if (this.schedule.departureTime && this.schedule.arrivalTime) {
    this.schedule.duration = Math.round(
      (this.schedule.arrivalTime - this.schedule.departureTime) / (1000 * 60)
    );
  }
  next();
});

// Update availability when seats change
flightSchema.methods.updateAvailability = function() {
  const availability = {
    total: 0,
    economy: 0,
    business: 0,
    first: 0
  };
  
  this.seats.forEach(seat => {
    if (seat.isAvailable) {
      availability.total++;
      availability[seat.class]++;
    }
  });
  
  this.availability = availability;
};

// Get available seats by class
flightSchema.methods.getAvailableSeats = function(seatClass = null) {
  if (seatClass) {
    return this.seats.filter(seat => seat.isAvailable && seat.class === seatClass);
  }
  return this.seats.filter(seat => seat.isAvailable);
};

// Check if flight is full
flightSchema.methods.isFull = function() {
  return this.availability.total === 0;
};

// Get occupancy rate
flightSchema.methods.getOccupancyRate = function() {
  return ((this.capacity.total - this.availability.total) / this.capacity.total) * 100;
};

module.exports = mongoose.model('Flight', flightSchema);