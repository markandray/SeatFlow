const ApiError = require('../utils/ApiError');

const validate = (schema) => (req, res, next) => {
  try {
    // If schema is a Zod object that explicitly checks body/query/params
    if (schema.shape && (schema.shape.body || schema.shape.query || schema.shape.params)) {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      if (parsed.body) req.body = parsed.body;
      if (parsed.query) req.query = parsed.query;
      if (parsed.params) req.params = parsed.params;
    } else {
      // Direct body schema
      req.body = schema.parse(req.body);
    }
    next();
  } catch (err) {
    if (err.errors) {
      const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      return next(new ApiError(400, 'VALIDATION_ERROR', message, err.errors));
    }
    next(err);
  }
};

module.exports = validate;
