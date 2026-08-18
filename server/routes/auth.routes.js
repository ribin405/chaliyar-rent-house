const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db } = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const loginSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().required(),
});

router.post('/login', validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;

  const result = await db.execute({
    sql: 'SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?',
    args: [username],
  });
  const user = result.rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
  if (!user.is_active) {
    return res.status(403).json({ success: false, message: 'Account has been deactivated' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' });
  const safeUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };

  res.json({ success: true, message: 'Login successful', token, user: safeUser, data: { token, user: safeUser } });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, data: req.user });
});

module.exports = router;
