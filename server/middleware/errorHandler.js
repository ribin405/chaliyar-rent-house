/**
 * Global Error Handler Middleware
 * ================================
 * Catches all errors and returns consistent JSON responses.
 * Handles Joi validation errors, Multer errors, and Postgres constraint errors.
 */

function errorHandler(err, req, res, _next) {
  // Log errors in development
  if (process.env.NODE_ENV === 'development') {
    console.error('[ERROR]', err);
  }

  // ── Joi Validation Error ─────────────────────────────────────────────────
  if (err.isJoi || err.name === 'ValidationError') {
    const errors = (err.details || []).map(d => ({
      field: d.path ? d.path.join('.') : 'unknown',
      message: d.message ? d.message.replace(/"/g, '') : d
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // ── Multer Errors ────────────────────────────────────────────────────────
  if (err instanceof require('multer').MulterError) {
    let message = 'File upload error';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File size exceeds the 5MB limit.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = err.field || 'Unexpected file type.';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded.';
    }
    return res.status(400).json({ success: false, message });
  }

  // ── Postgres Constraint Errors ────────────────────────────────────────────
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'A record with the given unique value already exists.'
    });
  }
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Referenced record does not exist.'
    });
  }

  // ── JWT Errors (catch-all) ───────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired.' });
  }

  // ── Default Server Error ─────────────────────────────────────────────────
  const statusCode = err.statusCode || 500;
  const message = err.statusCode ? err.message : 'Internal server error';
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = errorHandler;
