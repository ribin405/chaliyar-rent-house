const express = require('express');
const Joi = require('joi');

const db = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const categorySchema = Joi.object({
  name: Joi.string().trim().required(),
  description: Joi.string().trim().allow(''),
});

router.use(authenticate);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, name, description, is_active FROM categories WHERE is_active = 1 ORDER BY name ASC').all();
  res.json({ success: true, data: rows });
});

router.post('/', requireRole('owner'), validate(categorySchema), (req, res) => {
  const { name, description } = req.body;
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (existing) {
    return res.status(409).json({ success: false, message: 'A category with this name already exists' });
  }
  const result = db.prepare('INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, 1, ?)')
    .run(name, description || null, new Date().toISOString());
  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

router.put('/:id', requireRole('owner'), validate(categorySchema), (req, res) => {
  const { name, description } = req.body;
  const result = db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(name, description || null, req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', requireRole('owner'), (req, res) => {
  const result = db.prepare('UPDATE categories SET is_active = 0 WHERE id = ?').run(req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

module.exports = router;
