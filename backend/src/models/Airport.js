// backend/src/models/Airport.js
const mongoose = require('mongoose');

const airportSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    length: 3
  },
  name: {
    type: String,
    required: true
  },
  city: {
    type: String,
    required: true
  },
  country: {
    type: String,
    required: true
  },
  timezone: {
    type: String,
    required: true
  },
  coordinates: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
  },
  facilities: {
    terminals: { type: Number, default: 1 },
    runways: { type: Number, default: 1 },
    gates: { type: Number, default: 10 },
    parkingSpaces: { type: Number, default: 1000 }
  },
  services: [String], // ['wifi', 'lounge', 'duty-free', 'restaurants']
  isActive: {
    type: Boolean,
    default: true
  },
  isInternational: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
airportSchema.index({ code: 1 });
airportSchema.index({ city: 1 });
airportSchema.index({ country: 1 });
airportSchema.index({ isActive: 1 });

module.exports = mongoose.model('Airport', airportSchema);