const mongoose = require('mongoose');

const flightSchema = new mongoose.Schema({
  airline: {
    type: String,
    required: true,
    trim: true
  },
  flightNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  from: {
    type: String,
    required: true,
    trim: true
  },
  to: {
    type: String,
    required: true,
    trim: true
  },
  date: {
    type: Date,
    required: true
  },
  departureTime: {
    type: String,
    required: true
  },
  arrivalTime: {
    type: String,
    required: true
  },
  basePrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalSeats: {
    type: Number,
    required: true,
    min: 1
  },
  availableSeats: [{
    type: String
  }],
  bookedSeats: [{
    type: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate seat numbers
flightSchema.methods.generateSeats = function() {
  const seats = [];
  const rows = Math.ceil(this.totalSeats / 6); // Assuming 6 seats per row (A-F)
  const seatLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
  
  for (let row = 1; row <= rows; row++) {
    for (let letter of seatLetters) {
      if (seats.length < this.totalSeats) {
        seats.push(`${row}${letter}`);
      }
    }
  }
  
  this.availableSeats = seats;
  return seats;
};

// Calculate dynamic price based on demand
flightSchema.methods.calculatePrice = function() {
  const seatsLeft = this.availableSeats.length;
  const demandRatio = (this.totalSeats - seatsLeft) / this.totalSeats;
  const dynamicPrice = this.basePrice * (1 + demandRatio * 0.5); // Up to 50% increase
  return Math.round(dynamicPrice);
};

// Book a seat
flightSchema.methods.bookSeat = function(seatNumber) {
  const seatIndex = this.availableSeats.indexOf(seatNumber);
  if (seatIndex === -1) {
    throw new Error('Seat not available');
  }
  
  this.availableSeats.splice(seatIndex, 1);
  this.bookedSeats.push(seatNumber);
  
  return this.save();
};

// Cancel a seat booking
flightSchema.methods.cancelSeat = function(seatNumber) {
  const seatIndex = this.bookedSeats.indexOf(seatNumber);
  if (seatIndex === -1) {
    throw new Error('Seat was not booked');
  }
  
  this.bookedSeats.splice(seatIndex, 1);
  this.availableSeats.push(seatNumber);
  
  return this.save();
};

module.exports = mongoose.model('Flight', flightSchema);