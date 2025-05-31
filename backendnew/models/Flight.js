const mongoose = require('mongoose');

const flightSchema = new mongoose.Schema({
  airline: {
    type: String,
    required: [true, 'Airline is required'],
    trim: true,
    maxlength: [50, 'Airline name cannot exceed 50 characters']
  },
  flightNumber: {
    type: String,
    required: [true, 'Flight number is required'],
    unique: true,
    trim: true,
    uppercase: true,
    match: [/^[A-Z0-9]{2,3}-?\d{3,4}$/, 'Please enter a valid flight number (e.g., 6E-123)']
  },
  from: {
    type: String,
    required: [true, 'Departure city is required'],
    trim: true,
    maxlength: [50, 'City name cannot exceed 50 characters']
  },
  to: {
    type: String,
    required: [true, 'Destination city is required'],
    trim: true,
    maxlength: [50, 'City name cannot exceed 50 characters']
  },
  date: {
    type: Date,
    required: [true, 'Flight date is required'],
    validate: {
      validator: function(date) {
        return date >= new Date().setHours(0, 0, 0, 0);
      },
      message: 'Flight date cannot be in the past'
    }
  },
  departureTime: {
    type: String,
    required: [true, 'Departure time is required'],
    match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter valid time format (HH:MM)']
  },
  arrivalTime: {
    type: String,
    required: [true, 'Arrival time is required'],
    match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter valid time format (HH:MM)']
  },
  basePrice: {
    type: Number,
    required: [true, 'Base price is required'],
    min: [0, 'Price cannot be negative'],
    max: [100000, 'Price seems too high']
  },
  totalSeats: {
    type: Number,
    required: [true, 'Total seats is required'],
    min: [1, 'Must have at least 1 seat'],
    max: [500, 'Too many seats for a single flight']
  },
  availableSeats: [{
    type: String,
    trim: true
  }],
  bookedSeats: [{
    type: String,
    trim: true
  }],
  status: {
    type: String,
    enum: ['scheduled', 'boarding', 'departed', 'arrived', 'cancelled'],
    default: 'scheduled'
  },
  aircraft: {
    type: String,
    trim: true
  },
  gate: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate seat numbers based on aircraft configuration
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
  
  // Dynamic pricing: base price + up to 50% increase based on demand
  const demandMultiplier = 1 + (demandRatio * 0.5);
  
  // Additional factors
  const dateMultiplier = this.getDatePriceMultiplier();
  
  const dynamicPrice = this.basePrice * demandMultiplier * dateMultiplier;
  return Math.round(dynamicPrice);
};

// Get price multiplier based on how close the flight date is
flightSchema.methods.getDatePriceMultiplier = function() {
  const now = new Date();
  const flightDate = new Date(this.date);
  const daysUntilFlight = (flightDate - now) / (1000 * 60 * 60 * 24);
  
  if (daysUntilFlight <= 1) return 1.5; // Last minute booking
  if (daysUntilFlight <= 7) return 1.2; // Within a week
  if (daysUntilFlight <= 30) return 1.0; // Normal price
  return 0.9; // Early bird discount
};

// Book a seat
flightSchema.methods.bookSeat = function(seatNumber) {
  const seatIndex = this.availableSeats.indexOf(seatNumber);
  if (seatIndex === -1) {
    throw new Error('Seat not available or already booked');
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
  
  // Sort available seats
  this.availableSeats.sort((a, b) => {
    const aRow = parseInt(a.slice(0, -1));
    const bRow = parseInt(b.slice(0, -1));
    if (aRow !== bRow) return aRow - bRow;
    return a.slice(-1).localeCompare(b.slice(-1));
  });
  
  return this.save();
};

// Check if flight is bookable
flightSchema.methods.isBookable = function() {
  const now = new Date();
  const flightDateTime = new Date(this.date + ' ' + this.departureTime);
  const hoursUntilFlight = (flightDateTime - now) / (1000 * 60 * 60);
  
  return this.status === 'scheduled' && 
         hoursUntilFlight > 2 && // Must book at least 2 hours before departure
         this.availableSeats.length > 0;
};

// Indexes for better query performance
flightSchema.index({ from: 1, to: 1, date: 1 });
flightSchema.index({ flightNumber: 1 });
flightSchema.index({ date: 1 });
flightSchema.index({ airline: 1 });

module.exports = mongoose.model('Flight', flightSchema);