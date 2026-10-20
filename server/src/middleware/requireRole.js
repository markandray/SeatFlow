const ApiError = require('../utils/ApiError');

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Authentication required'));
  }

  if (!roles.includes(req.user.role)) {
    return next(
      new ApiError(
        403,
        'FORBIDDEN',
        `Forbidden: role '${req.user.role}' is not authorized to access this resource`
      )
    );
  }

  next();
};

module.exports = requireRole;
