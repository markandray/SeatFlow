const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const ApiError = require('./utils/ApiError');

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: env.CLIENT_ORIGIN,
  credentials: false,
};
app.use(cors(corsOptions));

// JSON body parser
app.use(express.json());

// Rate limiting for auth routes (disabled or relaxed in test environment)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'test' ? 1000 : 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
    },
  },
});

app.use('/api/auth', authLimiter);

// Mount API routes
app.use('/api', routes);

// 404 handler for undefined routes
app.use((req, res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
});

// Central error handler
app.use(errorHandler);

module.exports = app;
