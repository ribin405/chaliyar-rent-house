/**
 * Authentication Middleware
 * =========================
 * JWT verification and role-based access control.
 */

const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

/**
 * Verify JWT token from Authorization header.
 * Attaches the decoded user object to req.user.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists and is active
    const result = await db.execute({
      sql: 'SELECT id, username, full_name, role, is_active FROM users WHERE id = ?',
      args: [decoded.id],
    });
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token. User not found.' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired. Please login again.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    next(err);
  }
}

/**
 * Role-based access middleware factory.
 * Usage: requireRole('owner') or requireRole('owner', 'staff')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions. Required role: ' + roles.join(' or ') });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
