const express = require('express');
const Joi = require('joi');

const { db } = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const categorySchema = Joi.object({
  name: Joi.string().trim().required(),
  description: Joi.string().trim().allow('').default(''),
});

router.use(authenticate);

router.get('/', async (req, res) => {
  const result = await db.execute('SELECT id, name, description, is_active FROM categories WHERE is_active = 1 ORDER BY name ASC');
  res.json({ success: true, data: result.rows });
});

router.post('/', requireRole('owner'), validate(categorySchema), async (req, res) => {
  const { name, description } = req.body;
  const existing = await db.execute({ sql: 'SELECT id FROM categories WHERE name = ?', args: [name] });
  if (existing.rows.length) {
    return res.status(409).json({ success: false, message: 'A category with this name already exists' });
  }
  const result = await db.execute({
    sql: 'INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, 1, ?) RETURNING id',
    args: [name, description || null, new Date().toISOString()],
  });
  res.status(201).json({ success: true, data: { id: Number(result.lastInsertRowid) } });
});

router.put('/:id', requireRole('owner'), validate(categorySchema), async (req, res) => {
  const { name, description } = req.body;
  const result = await db.execute({
    sql: 'UPDATE categories SET name = ?, description = ? WHERE id = ?',
    args: [name, description || null, req.params.id],
  });
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', requireRole('owner'), async (req, res) => {
  const result = await db.execute({ sql: 'UPDATE categories SET is_active = 0 WHERE id = ?', args: [req.params.id] });
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

module.exports = router;
