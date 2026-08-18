const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');

const db = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const createUserSchema = Joi.object({
  username: Joi.string().trim().lowercase().required(),
  password: Joi.string().min(6).required(),
  full_name: Joi.string().trim().required(),
  role: Joi.string().valid('owner', 'staff').default('staff'),
});

const updateUserSchema = Joi.object({
  full_name: Joi.string().trim().required(),
  role: Joi.string().valid('owner', 'staff').required(),
  is_active: Joi.boolean().default(true),
});

router.use(authenticate, requireRole('owner'));

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY id ASC').all();
  res.json({ success: true, data: rows });
});

router.post('/', validate(createUserSchema), (req, res) => {
  const value = req.body;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(value.username);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Username already exists' });
  }

  const hash = bcrypt.hashSync(value.password, 10);
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(value.username, hash, value.full_name, value.role, now, now);

  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

router.put('/:id', validate(updateUserSchema), (req, res) => {
  const value = req.body;
  const result = db.prepare(`
    UPDATE users SET full_name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?
  `).run(value.full_name, value.role, value.is_active ? 1 : 0, new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
  }
  const result = db.prepare("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

module.exports = router;
