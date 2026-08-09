/**
 * Validation Middleware
 * =====================
 * Factory function that takes a Joi schema and returns Express middleware.
 * Supports validating req.body, req.query, and req.params.
 */

/**
 * Create validation middleware for the given Joi schema and request property.
 * @param {import('joi').Schema} schema - Joi schema to validate against
 * @param {'body'|'query'|'params'} property - Request property to validate (default: 'body')
 * @returns {Function} Express middleware
 */
function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,     // Report all errors, not just the first
      stripUnknown: true,    // Remove unknown fields
      allowUnknown: false    // Don't allow unknown fields
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, '')
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    // Replace the request property with the validated & sanitized value
    req[property] = value;
    next();
  };
}

module.exports = validate;
