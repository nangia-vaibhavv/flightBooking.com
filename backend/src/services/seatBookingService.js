// ================================================================
// backend/src/services/seatBlockingService.js
const redisClient = require('../config/redis');
const Flight = require('../models/Flight');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class SeatBlockingService {
  constructor() {
    this.defaultHoldTime = 300; // 5 minutes in seconds
    this.maxRetries = 3;
  }

  /**
   * Block seat for a user
   * @param {String} flightId - Flight ID
   * @param {String} seatNumber - Seat number
   * @param {String} userId - User ID
   * @param {Number} holdTime - Hold time in seconds (optional)
   * @returns {Object} - Block result
   */
  async blockSeat(flightId, seatNumber, userId, holdTime = this.defaultHoldTime) {
    const lockKey = `seat_block:${flightId}:${seatNumber}`;
    const sessionId = uuidv4();
    const blockData = {
      userId,
      sessionId,
      blockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + holdTime * 1000).toISOString()
    };

    try {
      // Try to acquire the lock (NX = only set if not exists)
      const result = await redisClient.client.set(
        lockKey, 
        JSON.stringify(blockData), 
        {
          EX: holdTime,
          NX: true
        }
      );

      if (result === 'OK') {
        // Successfully blocked the seat
        await this.updateSeatStatus(flightId, seatNumber, false);
        
        logger.info(`Seat ${seatNumber} blocked for user ${userId} on flight ${flightId}`);
        
        return {
          success: true,
          sessionId,
          expiresAt: blockData.expiresAt,
          holdTime
        };
      } else {
        // Seat is already blocked
        const existingBlock = await this.getSeatBlock(flightId, seatNumber);
        return {
          success: false,
          error: 'Seat is already blocked',
          blockedBy: existingBlock?.userId,
          expiresAt: existingBlock?.expiresAt
        };
      }
    } catch (error) {
      logger.error('Error blocking seat:', error);
      return {
        success: false,
        error: 'Failed to block seat',
        details: error.message
      };
    }
  }

  /**
   * Release seat block
   * @param {String} flightId - Flight ID
   * @param {String} seatNumber - Seat number
   * @param {String} userId - User ID
   * @param {String} sessionId - Session ID for verification
   * @returns {Object} - Release result
   */
  async releaseSeat(flightId, seatNumber, userId, sessionId = null) {
    const lockKey = `seat_block:${flightId}:${seatNumber}`;

    try {
      const existingBlock = await this.getSeatBlock(flightId, seatNumber);
      
      if (!existingBlock) {
        return {
          success: false,
          error: 'No active block found for this seat'
        };
      }

      // Verify ownership
      if (existingBlock.userId !== userId) {
        return {
          success: false,
          error: 'You do not own this seat block'
        };
      }

      // Verify session if provided
      if (sessionId && existingBlock.sessionId !== sessionId) {
        return {
          success: false,
          error: 'Invalid session ID'
        };
      }

      // Release the lock
      await redisClient.del(lockKey);
      await this.updateSeatStatus(flightId, seatNumber, true);

      logger.info(`Seat ${seatNumber} released by user ${userId} on flight ${flightId}`);

      return {
        success: true,
        message: 'Seat block released successfully'
      };
    } catch (error) {
      logger.error('Error releasing seat:', error);
      return {
        success: false,
        error: 'Failed to release seat block',
        details: error.message
      };
    }
  }

  /**
   * Get seat block information
   * @param {String} flightId - Flight ID
   * @param {String} seatNumber - Seat number
   * @returns {Object|null} - Block information
   */
  async getSeatBlock(flightId, seatNumber) {
    const lockKey = `seat_block:${flightId}:${seatNumber}`;
    
    try {
      const blockData = await redisClient.get(lockKey);
      return blockData ? JSON.parse(blockData) : null;
    } catch (error) {
      logger.error('Error getting seat block:', error);
      return null;
    }
  }

  /**
   * Extend seat block time
   * @param {String} flightId - Flight ID
   * @param {String} seatNumber - Seat number
   * @param {String} userId - User ID
   * @param {String} sessionId - Session ID
   * @param {Number} additionalTime - Additional time in seconds
   * @returns {Object} - Extension result
   */
  async extendSeatBlock(flightId, seatNumber, userId, sessionId, additionalTime = 300) {
    const lockKey = `seat_block:${flightId}:${seatNumber}`;

    try {
      const existingBlock = await this.getSeatBlock(flightId, seatNumber);
      
      if (!existingBlock) {
        return {
          success: false,
          error: 'No active block found'
        };
      }

      if (existingBlock.userId !== userId || existingBlock.sessionId !== sessionId) {
        return {
          success: false,
          error: 'Unauthorized to extend this block'
        };
      }

      // Extend the TTL
      await redisClient.expire(lockKey, additionalTime);
      
      const newExpiresAt = new Date(Date.now() + additionalTime * 1000).toISOString();
      existingBlock.expiresAt = newExpiresAt;
      
      await redisClient.set(lockKey, JSON.stringify(existingBlock), additionalTime);

      return {
        success: true,
        newExpiresAt,
        additionalTime
      };
    } catch (error) {
      logger.error('Error extending seat block:', error);
      return {
        success: false,
        error: 'Failed to extend seat block'
      };
    }
  }

  /**
   * Block multiple seats atomically
   * @param {String} flightId - Flight ID
   * @param {Array} seatNumbers - Array of seat numbers
   * @param {String} userId - User ID
   * @param {Number} holdTime - Hold time in seconds
   * @returns {Object} - Block result
   */
  async blockMultipleSeats(flightId, seatNumbers, userId, holdTime = this.defaultHoldTime) {
    const sessionId = uuidv4();
    const blocked = [];
    const failed = [];

    try {
      // Try to block all seats
      for (const seatNumber of seatNumbers) {
        const result = await this.blockSeat(flightId, seatNumber, userId, holdTime);
        
        if (result.success) {
          blocked.push({ seatNumber, sessionId: result.sessionId });
        } else {
          failed.push({ seatNumber, error: result.error });
        }
      }

      // If any seat failed to block, release all blocked seats
      if (failed.length > 0) {
        for (const { seatNumber } of blocked) {
          await this.releaseSeat(flightId, seatNumber, userId);
        }

        return {
          success: false,
          error: 'Failed to block all requested seats',
          failed,
          blockedAndReleased: blocked
        };
      }

      return {
        success: true,
        blocked,
        sessionId,
        expiresAt: new Date(Date.now() + holdTime * 1000).toISOString()
      };
    } catch (error) {
      logger.error('Error blocking multiple seats:', error);
      
      // Clean up any successful blocks
      for (const { seatNumber } of blocked) {
        await this.releaseSeat(flightId, seatNumber, userId);
      }

      return {
        success: false,
        error: 'Failed to block seats due to system error'
      };
    }
  }

  /**
   * Get all blocked seats for a flight
   * @param {String} flightId - Flight ID
   * @returns {Array} - Array of blocked seats
   */
  async getFlightBlockedSeats(flightId) {
    try {
      const pattern = `seat_block:${flightId}:*`;
      const keys = await redisClient.keys(pattern);
      
      const blockedSeats = [];
      for (const key of keys) {
        const blockData = await redisClient.get(key);
        if (blockData) {
          const seatNumber = key.split(':').pop();
          blockedSeats.push({
            seatNumber,
            ...JSON.parse(blockData)
          });
        }
      }

      return blockedSeats;
    } catch (error) {
      logger.error('Error getting flight blocked seats:', error);
      return [];
    }
  }

  /**
   * Update seat status in database
   * @param {String} flightId - Flight ID
   * @param {String} seatNumber - Seat number
   * @param {Boolean} isAvailable - Availability status
   */
  async updateSeatStatus(flightId, seatNumber, isAvailable) {
    try {
      await Flight.updateOne(
        { 
          _id: flightId,
          'seats.seatNumber': seatNumber
        },
        {
          $set: { 'seats.$.isAvailable': isAvailable }
        }
      );

      // Update flight availability counts
      const flight = await Flight.findById(flightId);
      if (flight) {
        flight.updateAvailability();
        await flight.save();
      }
    } catch (error) {
      logger.error('Error updating seat status:', error);
    }
  }

  /**
   * Clean up expired blocks (should be run periodically)
   */
  async cleanupExpiredBlocks() {
    try {
      const pattern = 'seat_block:*';
      const keys = await redisClient.keys(pattern);
      
      let cleaned = 0;
      for (const key of keys) {
        const ttl = await redisClient.client.ttl(key);
        if (ttl === -2) { // Key doesn't exist (expired)
          cleaned++;
        }
      }

      logger.info(`Cleaned up ${cleaned} expired seat blocks`);
      return cleaned;
    } catch (error) {
      logger.error('Error cleaning up expired blocks:', error);
      return 0;
    }
  }
  /**
   * Retry blocking a seat if it fails
   * @param {String} flightId - Flight ID
   * @param {String} seatNumber - Seat number
   * @param {String} userId - User ID
   * @param {Number} holdTime - Hold time in seconds
   * @returns {Object} - Retry result
   */
  async retryBlockSeat(flightId, seatNumber, userId, holdTime = this.defaultHoldTime) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const result = await this.blockSeat(flightId, seatNumber, userId, holdTime);
      
      if (result.success) {
        return result; // Successfully blocked the seat
      }

      logger.warn(`Attempt ${attempt} to block seat ${seatNumber} failed: ${result.error}`);
    }

    return {
      success: false,
      error: 'Failed to block seat after multiple attempts'
    };
  }
  /**
   * Retry releasing a seat block if it fails
   * @param {String} flightId - Flight ID
   * @param {String} seatNumber - Seat number
   * @param {String} userId - User ID
   * @param {String} sessionId - Session ID for verification
   * @returns {Object} - Retry result
   */
  async retryReleaseSeat(flightId, seatNumber, userId, sessionId = null) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const result = await this.releaseSeat(flightId, seatNumber, userId, sessionId);
      
      if (result.success) {
        return result; // Successfully released the seat
      }

      logger.warn(`Attempt ${attempt} to release seat ${seatNumber} failed: ${result.error}`);
    }

    return {
      success: false,
      error: 'Failed to release seat after multiple attempts'
    };
  }
}
module.exports = new SeatBlockingService();
// This service handles seat blocking, releasing, and management for flight bookings.
// It uses Redis for fast access and locking mechanisms to ensure atomic operations.
// The service includes methods for blocking, releasing, extending blocks, and cleaning up expired blocks.
// It also provides retry mechanisms for blocking and releasing seats in case of failures.  