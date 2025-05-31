// backend/src/config/elasticsearch.js
const { Client } = require('@elastic/elasticsearch');
const logger = require('../utils/logger');

class ElasticsearchClient {
  constructor() {
    this.client = new Client({
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      auth: process.env.ELASTICSEARCH_AUTH ? {
        username: process.env.ELASTICSEARCH_USERNAME,
        password: process.env.ELASTICSEARCH_PASSWORD
      } : undefined
    });
    
    this.initializeIndex();
  }
  
  async initializeIndex() {
    try {
      const indexExists = await this.client.indices.exists({
        index: 'flights'
      });
      
      if (!indexExists) {
        await this.client.indices.create({
          index: 'flights',
          body: {
            mappings: {
              properties: {
                flightNumber: { type: 'keyword' },
                airline: { type: 'keyword' },
                source: { type: 'keyword' },
                destination: { type: 'keyword' },
                departureTime: { type: 'date' },
                arrivalTime: { type: 'date' },
                basePrice: { type: 'float' },
                currentPrice: { type: 'float' },
                availableSeats: { type: 'integer' },
                totalSeats: { type: 'integer' },
                aircraft: { type: 'keyword' },
                status: { type: 'keyword' }
              }
            }
          }
        });
        logger.info('Elasticsearch flights index created');
      }
    } catch (error) {
      logger.error('Elasticsearch initialization error:', error);
    }
  }
  
  async indexFlight(flight) {
    try {
      const response = await this.client.index({
        index: 'flights',
        id: flight._id.toString(),
        body: flight
      });
      return response;
    } catch (error) {
      logger.error('Elasticsearch index error:', error);
      throw error;
    }
  }
  
  async searchFlights(query) {
    try {
      const response = await this.client.search({
        index: 'flights',
        body: query
      });
      return response.body.hits;
    } catch (error) {
      logger.error('Elasticsearch search error:', error);
      throw error;
    }
  }
  
  async updateFlight(id, updates) {
    try {
      const response = await this.client.update({
        index: 'flights',
        id: id,
        body: {
          doc: updates
        }
      });
      return response;
    } catch (error) {
      logger.error('Elasticsearch update error:', error);
      throw error;
    }
  }
  
  async deleteFlight(id) {
    try {
      const response = await this.client.delete({
        index: 'flights',
        id: id
      });
      return response;
    } catch (error) {
      logger.error('Elasticsearch delete error:', error);
      throw error;
    }
  }
}

module.exports = new ElasticsearchClient();