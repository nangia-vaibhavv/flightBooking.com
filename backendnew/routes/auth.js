// routes/auth.js
const bcrypt = require('bcryptjs');
const { User } = require('../models');

async function authRoutes(fastify, options) {
  // Register route
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 50 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6, maxLength: 100 },
          role: { type: 'string', enum: ['customer', 'admin'] }
        }
      }
    },
    preHandler: async (request, reply) => {
      await fastify.rateLimit({ max: 5, timeWindow: '15 minutes' })(request, reply);
    }
  }, async (request, reply) => {
    try {
      const { name, email, password, role } = request.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return reply.code(400).send({
          success: false,
          message: 'User with this email already exists'
        });
      }

      // Create new user
      const user = new User({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password,
        role: role || 'customer'
      });

      await user.save();

      // Generate JWT token
      const token = fastify.jwt.sign(
        { 
          id: user._id, 
          email: user.email, 
          role: user.role 
        },
        { expiresIn: '7d' }
      );

      reply.code(201).send({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
          },
          token
        }
      });

    } catch (error) {
      fastify.log.error(error);
      
      if (error.code === 11000) {
        return reply.code(400).send({
          success: false,
          message: 'Email already registered'
        });
      }

      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return reply.code(400).send({
          success: false,
          message: 'Validation error',
          errors: messages
        });
      }

      reply.code(500).send({
        success: false,
        message: 'Server error during registration'
      });
    }
  });

  // Login route
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 }
        }
      }
    },
    preHandler: async (request, reply) => {
      await fastify.rateLimit({ max: 5, timeWindow: '15 minutes' })(request, reply);
    }
  }, async (request, reply) => {
    try {
      const { email, password } = request.body;

      // Find user by email
      const user = await User.findOne({ email: email.toLowerCase().trim() });
      if (!user) {
        return reply.code(401).send({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return reply.code(401).send({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Generate JWT token
      const token = fastify.jwt.sign(
        { 
          id: user._id, 
          email: user.email, 
          role: user.role 
        },
        { expiresIn: '7d' }
      );

      reply.send({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
          },
          token
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error during login'
      });
    }
  });

  // Get current user profile
  fastify.get('/profile', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const user = await User.findById(request.user.id).select('-password');
      
      if (!user) {
        return reply.code(404).send({
          success: false,
          message: 'User not found'
        });
      }

      reply.send({
        success: true,
        data: { user }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching profile'
      });
    }
  });

  // Update user profile
  fastify.put('/profile', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 50 },
          email: { type: 'string', format: 'email' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const { name, email } = request.body;
      const userId = request.user.id;

      // Check if email is being changed and if it's already taken
      if (email) {
        const existingUser = await User.findOne({ 
          email: email.toLowerCase().trim(),
          _id: { $ne: userId }
        });
        
        if (existingUser) {
          return reply.code(400).send({
            success: false,
            message: 'Email already in use by another account'
          });
        }
      }

      const updateData = {};
      if (name) updateData.name = name.trim();
      if (email) updateData.email = email.toLowerCase().trim();

      const user = await User.findByIdAndUpdate(
        userId,
        updateData,
        { new: true, runValidators: true }
      ).select('-password');

      reply.send({
        success: true,
        message: 'Profile updated successfully',
        data: { user }
      });

    } catch (error) {
      fastify.log.error(error);
      
      if (error.code === 11000) {
        return reply.code(400).send({
          success: false,
          message: 'Email already in use'
        });
      }

      reply.code(500).send({
        success: false,
        message: 'Server error updating profile'
      });
    }
  });

  // Change password
  fastify.put('/change-password', {
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 6, maxLength: 100 }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const { currentPassword, newPassword } = request.body;
      const userId = request.user.id;

      // Get user with password
      const user = await User.findById(userId);
      if (!user) {
        return reply.code(404).send({
          success: false,
          message: 'User not found'
        });
      }

      // Verify current password
      const isCurrentPasswordValid = await user.comparePassword(currentPassword);
      if (!isCurrentPasswordValid) {
        return reply.code(400).send({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Update password
      user.password = newPassword;
      await user.save();

      reply.send({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error changing password'
      });
    }
  });

  // Logout (client-side token removal, but we can blacklist here if needed)
  fastify.post('/logout', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    reply.send({
      success: true,
      message: 'Logged out successfully'
    });
  });

  // Admin route - Get all users
  fastify.get('/users', {
    preHandler: fastify.requireAdmin
  }, async (request, reply) => {
    try {
      const { page = 1, limit = 10, role, search } = request.query;
      
      const query = {};
      if (role) query.role = role;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      const users = await User.find(query)
        .select('-password')
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .sort({ createdAt: -1 });

      const total = await User.countDocuments(query);

      reply.send({
        success: true,
        data: {
          users,
          pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total
          }
        }
      });

    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({
        success: false,
        message: 'Server error fetching users'
      });
    }
  });
}

module.exports = authRoutes;