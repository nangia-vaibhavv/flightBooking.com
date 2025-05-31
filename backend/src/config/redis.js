// backend/src/config/redis.js
const redis = require('redis');
const logger = require('../utils/logger');

class RedisClient {
  constructor() {
    this.client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });
    
    this.client.on('connect', () => {
      logger.info('Redis Client Connected');
    });
    
    this.connect();
  }
  
  async connect() {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('Redis connection error:', error);
    }
  }
  
  async get(key) {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis GET error:', error);
      return null;
    }
  }
  
  async set(key, value, ttl = null) {
    try {
      if (ttl) {
        return await this.client.setEx(key, ttl, JSON.stringify(value));
      }
      return await this.client.set(key, JSON.stringify(value));
    } catch (error) {
      logger.error('Redis SET error:', error);
      return false;
    }
  }
  
  async del(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error('Redis DEL error:', error);
      return false;
    }
  }
  
  async keys(pattern) {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error('Redis KEYS error:', error);
      return [];
    }
  }
  
  async incr(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error('Redis INCR error:', error);
      return 0;
    }
  }
  
  async expire(key, ttl) {
    try {
      return await this.client.expire(key, ttl);
    } catch (error) {
      logger.error('Redis EXPIRE error:', error);
      return false;
    }
  }
}

module.exports = new RedisClient();