require('dotenv').config();
const fastify = require('fastify')({ 
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    }
  }
});

const mongoose = require('mongoose');

// Register plugins
async function start() {
  try {
    // Register CORS
    await fastify.register(require('@fastify/cors'), {
      origin: ['http://localhost:3000', 'https://your-frontend-url.netlify.app'],
      credentials: true
    });

    // Register JWT
    await fastify.register(require('@fastify/jwt'), {
      secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production'
    });

    // Register Rate Limiting
    await fastify.register(require('@fastify/rate-limit'), {
      max: 100,
      timeWindow: '15 minutes'
    });

    // Connect to MongoDB using Mongoose
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/flight-booking', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    fastify.log.info('Connected to MongoDB');

    // Auth middleware
    fastify.decorate('authenticate', async function(request, reply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: 'Authentication required' });
      }
    });

    // Admin middleware
    fastify.decorate('requireAdmin', async function(request, reply) {
      try {
        await request.jwtVerify();
        if (request.user.role !== 'admin') {
          reply.code(403).send({ error: 'Admin access required' });
        }
      } catch (err) {
        reply.code(401).send({ error: 'Authentication required' });
      }
    });

    // Register routes
    await fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
    await fastify.register(require('./routes/flights'), { prefix: '/api/flights' });
    await fastify.register(require('./routes/bookings'), { prefix: '/api/bookings' });

    // Health check
    fastify.get('/health', async (request, reply) => {
      return { status: 'OK', timestamp: new Date().toISOString() };
    });

    // Start server
    const port = process.env.PORT || 5000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server running on port ${port}`);
    
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();