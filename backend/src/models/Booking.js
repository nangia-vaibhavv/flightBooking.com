// backend/src/models/Booking.js
const mongoose = require('mongoose');

const passengerSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, enum: ['male', 'female', 'other'] },
  seatNumber: { type: String, required: true },
  mealPreference: String,
  specialRequests: [String]
});

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  flight: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Flight',
    required: true
  },
  passengers: [passengerSchema],
  seats: [{
    seatNumber: String,
    class: String,
    price: Number
  }],
  pricing: {
    baseAmount: { type: Number, required: true },
    taxes: { type: Number, default: 0 },
    fees: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true }
  },
  payment: {
    method: {
      type: String,
      enum: ['card', 'wallet', 'upi', 'netbanking'],
      required: true
    },
    transactionId: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    paidAt: Date,
    refundAmount: { type: Number, default: 0 },
    refundReason: String
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'checked-in', 'boarded', 'completed', 'cancelled'],
    default: 'pending'
  },
  contact: {
    email: { type: String, required: true },
    phone: { type: String, required: true }
  },
  checkin: {
    isCheckedIn: { type: Boolean, default: false },
    checkedInAt: Date,
    boardingPass: String
  },
  cancellation: {
    isCancelled: { type: Boolean, default: false },
    cancelledAt: Date,
    reason: String,
    refundEligible: { type: Boolean, default: true }
  },
  metadata: {
    bookingSource: { type: String, default: 'web' },
    ipAddress: String,
    userAgent: String
  }
}, {
  timestamps: true
});

// Indexes
bookingSchema.index({ bookingId: 1 });
bookingSchema.index({ user: 1 });
bookingSchema.index({ flight: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ 'payment.status': 1 });

// Generate booking ID
bookingSchema.pre('save', function(next) {
  if (!this.bookingId) {
    this.bookingId = 'FB' + Date.now().toString().slice(-8) + Math.random().toString(36).substr(2, 4).toUpperCase();
  }
  next();
});

// Calculate total amount
bookingSchema.methods.calculateTotal = function() {
  this.pricing.totalAmount = this.pricing.baseAmount + this.pricing.taxes + this.pricing.fees - this.pricing.discount;
  return this.pricing.totalAmount;
};

// Check if cancellable
bookingSchema.methods.isCancellable = function() {
  const now = new Date();
  const departureTime = new Date(this.flight.schedule.departureTime);
  const hoursUntilDeparture = (departureTime - now) / (1000 * 60 * 60);
  
  return hoursUntilDeparture > 24 && this.status === 'confirmed' && !this.cancellation.isCancelled;
};

module.exports = mongoose.model('Booking', bookingSchema);