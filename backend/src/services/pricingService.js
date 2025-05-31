// backend/src/services/pricingService.js
const moment = require('moment');
const Flight = require('../models/Flight');
const Route = require('../models/Route');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');

class PricingService {
  constructor() {
    this.priceCache = new Map(); // In-memory cache for frequently accessed prices
  }

  /**
   * Calculate dynamic price for a flight
   * @param {Object} flight - Flight object
   * @param {String} seatClass - Seat class (economy, business, first)
   * @returns {Number} - Calculated price
   */
  async calculateDynamicPrice(flight, seatClass = 'economy') {
    try {
      const cacheKey = `price:${flight._id}:${seatClass}`;
      
      // Check cache first
      const cachedPrice = await redisClient.get(cacheKey);
      if (cachedPrice) {
        return JSON.parse(cachedPrice);
      }

      const basePrice = this.getBasePriceForClass(flight, seatClass);
      let finalPrice = basePrice;

      // Apply time-based multiplier
      const timeMultiplier = this.calculateTimeMultiplier(flight.schedule.departureTime);
      finalPrice *= timeMultiplier;

      // Apply demand-based multiplier
      const demandMultiplier = this.calculateDemandMultiplier(flight, seatClass);
      finalPrice *= demandMultiplier;

      // Apply route popularity multiplier
      const routeMultiplier = await this.calculateRouteMultiplier(flight.route);
      finalPrice *= routeMultiplier;

      // Apply day-of-week multiplier
      const dayMultiplier = this.calculateDayMultiplier(flight.schedule.departureTime);
      finalPrice *= dayMultiplier;

      // Apply seasonal multiplier
      const seasonalMultiplier = await this.calculateSeasonalMultiplier(flight.route);
      finalPrice *= seasonalMultiplier;

      // Round to nearest currency unit
      finalPrice = Math.round(finalPrice * 100) / 100;

      // Cache the result for 5 minutes
      await redisClient.set(cacheKey, finalPrice, 300);

      // Update flight's current price
      await this.updateFlightPrice(flight._id, finalPrice, seatClass);

      return {
        basePrice,
        finalPrice,
        multipliers: {
          time: timeMultiplier,
          demand: demandMultiplier,
          route: routeMultiplier,
          day: dayMultiplier,
          seasonal: seasonalMultiplier
        }
      };

    } catch (error) {
      logger.error('Error calculating dynamic price:', error);
      return { finalPrice: this.getBasePriceForClass(flight, seatClass) };
    }
  }

  /**
   * Get base price for seat class
   */
  getBasePriceForClass(flight, seatClass) {
    const multipliers = {
      economy: 1,
      business: 2.5,
      first: 4
    };
    return flight.pricing.basePrice * (multipliers[seatClass] || 1);
  }

  /**
   * Calculate time-based multiplier (closer to departure = higher price)
   */
  calculateTimeMultiplier(departureTime) {
    const now = moment();
    const departure = moment(departureTime);
    const hoursUntilDeparture = departure.diff(now, 'hours');

    if (hoursUntilDeparture < 0) return 1; // Flight has departed

    // Price increases as departure approaches
    if (hoursUntilDeparture <= 6) return 1.8;      // Last 6 hours
    if (hoursUntilDeparture <= 24) return 1.5;     // Last day
    if (hoursUntilDeparture <= 72) return 1.3;     // Last 3 days
    if (hoursUntilDeparture <= 168) return 1.1;    // Last week
    
    return 1; // More than a week out
  }

  /**
   * Calculate demand-based multiplier (fewer seats = higher price)
   */
  calculateDemandMultiplier(flight, seatClass) {
    const totalSeats = flight.capacity[seatClass] || flight.capacity.total;
    const availableSeats = flight.availability[seatClass] || flight.availability.total;
    
    if (totalSeats === 0) return 1;
    
    const occupancyRate = ((totalSeats - availableSeats) / totalSeats) * 100;

    // Dynamic pricing based on occupancy
    if (occupancyRate >= 90) return 2.0;    // Almost full
    if (occupancyRate >= 80) return 1.7;    // 80%+ occupied
    if (occupancyRate >= 70) return 1.4;    // 70%+ occupied
    if (occupancyRate >= 60) return 1.2;    // 60%+ occupied
    if (occupancyRate >= 50) return 1.1;    // 50%+ occupied
    
    return 1; // Less than 50% occupied
  }

  /**
   * Calculate route popularity multiplier
   */
  async calculateRouteMultiplier(routeInfo) {
    try {
      const route = await Route.findOne({
        'source.code': routeInfo.source,
        'destination.code': routeInfo.destination
      });

      if (!route) return 1;

      // Route popularity affects pricing
      const popularity = route.popularity || 1;
      return Math.min(popularity, 2); // Cap at 2x multiplier
    } catch (error) {
      logger.error('Error calculating route multiplier:', error);
      return 1;
    }
  }

  /**
   * Calculate day-of-week multiplier
   */
  calculateDayMultiplier(departureTime) {
    const dayOfWeek = moment(departureTime).day();
    
    // Weekend flights are more expensive
    if (dayOfWeek === 0 || dayOfWeek === 6) return 1.2; // Sunday or Saturday
    if (dayOfWeek === 5) return 1.1; // Friday
    
    return 1; // Weekdays
  }

  /**
   * Calculate seasonal multiplier
   */
  async calculateSeasonalMultiplier(routeInfo) {
    try {
      const route = await Route.findOne({
        'source.code': routeInfo.source,
        'destination.code': routeInfo.destination
      });

      if (!route || !route.pricing.seasonalMultipliers) return 1;

      const currentDate = moment().format('MM-DD');
      
      for (const seasonal of route.pricing.seasonalMultipliers) {
        if (this.isDateInRange(currentDate, seasonal.startDate, seasonal.endDate)) {
          return seasonal.multiplier;
        }
      }

      return 1;
    } catch (error) {
      logger.error('Error calculating seasonal multiplier:', error);
      return 1;
    }
  }

  /**
   * Check if current date is in seasonal range
   */
  isDateInRange(currentDate, startDate, endDate) {
    const current = moment(currentDate, 'MM-DD');
    const start = moment(startDate, 'MM-DD');
    const end = moment(endDate, 'MM-DD');

    if (start.isAfter(end)) {
      // Range crosses year boundary
      return current.isAfter(start) || current.isBefore(end);
    } else {
      return current.isBetween(start, end, null, '[]');
    }
  }

  /**
   * Update flight price in database
   */
  async updateFlightPrice(flightId, price, seatClass) {
    try {
      await Flight.findByIdAndUpdate(flightId, {
        'pricing.currentPrice': price,
        [`pricing.dynamicPricing.factors.${seatClass}Price`]: price
      });
    } catch (error) {
      logger.error('Error updating flight price:', error);
    }
  }

  /**
   * Batch update prices for multiple flights
   */
  async batchUpdatePrices(flights) {
    const promises = flights.map(flight => this.calculateDynamicPrice(flight));
    await Promise.all(promises);
  }

  /**
   * Clear price cache
   */
  async clearPriceCache(flightId = null) {
    if (flightId) {
      const keys = await redisClient.keys(`price:${flightId}:*`);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } else {
      const keys = await redisClient.keys('price:*');
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    }
  }
}

module.exports = new PricingService();

