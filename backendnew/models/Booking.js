const mongoose = require('mongoose');
const crypto = require('crypto');

const bookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required']
  },
  flight: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Flight',
    required: [true, 'Flight reference is required']
  },
  seatNumber: {
    type: String,
    required: [true, 'Seat number is required'],
    trim: true,
    match: [/^\d+[A-F]$/, 'Invalid seat number format']
  },
  passengerName: {
    type: String,
    required: [true, 'Passenger name is required'],
    trim: true,
    maxlength: [100, 'Passenger name cannot exceed 100 characters']
  },
  passengerEmail: {
    type: String,
    required: [true, 'Passenger email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  passengerPhone: {
    type: String,
    required: [true, 'Passenger phone is required'],
    trim: true,
    match: [/^\+?[\d\s-()]+$/, 'Please enter a valid phone number']
  },
  price: {
    type: Number,
    required: [true, 'Booking price is required'],
    min: [0, 'Price cannot be negative']
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  bookingReference: {
    type: String,
    unique: true,
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['credit_card', 'debit_card', 'upi', 'net_banking', 'wallet'],
    required: function() {
      return this.paymentStatus === 'completed';
    }
  },
  transactionId: {
    type: String,
    trim: true
  },
  specialRequests: {
    type: String,
    maxlength: [500, 'Special requests cannot exceed 500 characters']
  },
  checkedIn: {
    type: Boolean,
    default: false
  },
  checkedInAt: {
    type: Date
  },
  boardingPass: {
    gate: String,
    boardingTime: String,
    sequence: Number
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Generate unique booking reference before saving
bookingSchema.pre('save', function(next) {
  if (!this.bookingReference) {
    this.bookingReference = this.generateBookingReference();
  }
  this.updatedAt = new Date();
  next();
});

// Generate booking reference
bookingSchema.methods.generateBookingReference = function() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FB${timestamp}${random}`;
};

// Confirm booking
bookingSchema.methods.confirm = function() {
  this.status = 'confirmed';
  this.paymentStatus = 'completed';
  return this.save();
};

// Cancel booking
bookingSchema.methods.cancel = async function() {
  const Flight = mongoose.model('Flight');
  
  try {
    // Return the seat to available seats
    const flight = await Flight.findById(this.flight);
    if (flight) {
      await flight.cancelSeat(this.seatNumber);
    }
    
    this.status = 'cancelled';
    return this.save();
  } catch (error) {
    throw new Error(`Failed to cancel booking: ${error.message}`);
  }
};

// Check if booking can be cancelled
bookingSchema.methods.canBeCancelled = function() {
  return this.status === 'confirmed' || this.status === 'pending';
};

// Check if passenger can check in
bookingSchema.methods.canCheckIn = async function() {
  if (this.checkedIn || this.status !== 'confirmed') {
    return false;
  }
  
  const Flight = mongoose.model('Flight');
  const flight = await Flight.findById(this.flight);
  
  if (!flight) return false;
  
  const now = new Date();
  const flightDateTime = new Date(flight.date + ' ' + flight.departureTime);
  const hoursUntilFlight = (flightDateTime - now) / (1000 * 60 * 60);
  
  // Can check in between 24 hours and 2 hours before flight
  return hoursUntilFlight <= 24 && hoursUntilFlight >= 2;
};

// Check in passenger
bookingSchema.methods.checkIn = function(gateInfo) {
  if (this.checkedIn) {
    throw new Error('Already checked in');
  }
  
  this.checkedIn = true;
  this.checkedInAt = new Date();
  
  if (gateInfo) {
    this.boardingPass = {
      gate: gateInfo.gate,
      boardingTime: gateInfo.boardingTime,
      sequence: gateInfo.sequence
    };
  }
  
  return this.save();
};

// Virtual for days until flight
bookingSchema.virtual('daysUntilFlight').get(function() {
  if (!this.flight || !this.flight.date) return null;
  
  const now = new Date();
  const flightDate = new Date(this.flight.date);
  const diffTime = flightDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
});

// Populate flight and user data by default
bookingSchema.pre(/^find/, function(next) {
  this.populate('user', 'name email phone')
      .populate('flight', 'airline flightNumber from to date departureTime arrivalTime status');
  next();
});

// Indexes for better query performance
bookingSchema.index({ user: 1 });
bookingSchema.index({ flight: 1 });
bookingSchema.index({ bookingReference: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', bookingSchema);