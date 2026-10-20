const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const authRequired = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new ApiError(401, 'UNAUTHORIZED', 'Authentication token required'));
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new ApiError(401, 'TOKEN_EXPIRED', 'Token has expired'));
      }
      return next(new ApiError(401, 'INVALID_TOKEN', 'Invalid token'));
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new ApiError(401, 'USER_NOT_FOUND', 'User no longer exists'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = authRequired;
