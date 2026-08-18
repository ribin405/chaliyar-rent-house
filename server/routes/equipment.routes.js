const express = require('express');
const Joi = require('joi');

const { db } = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const equipmentSchema = Joi.object({
  name: Joi.string().trim().required(),
  category_id: Joi.number().integer().positive().allow(null),
  category: Joi.string().trim().max(100).allow('').default(''),
  daily_rent: Joi.number().min(0).required(),
  security_deposit: Joi.number().min(0).required(),
  status: Joi.string().valid('available', 'reserved', 'rented', 'maintenance').default('available'),
  location: Joi.string().trim().allow('').default(''),
  notes: Joi.string().trim().allow('').default(''),
});

router.use(authenticate);

const resolveCategoryId = async (categoryId, categoryName) => {
  if (categoryId) return categoryId;
  const name = categoryName?.trim();
  if (!name) return null;
  const existing = await db.execute({ sql: 'SELECT id FROM categories WHERE name = ?', args: [name] });
  if (existing.rows[0]) return existing.rows[0].id;
  const result = await db.execute({
    sql: 'INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, 1, ?)',
    args: [name, null, new Date().toISOString()],
  });
  return Number(result.lastInsertRowid);
};

router.get('/', async (req, res) => {
  const result = await db.execute(`
    SELECT e.id, e.name, e.category_id, c.name AS category_name, e.daily_rent, e.security_deposit,
           e.current_status AS status, e.current_location AS location, e.notes
    FROM equipment e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.is_deleted = 0
    ORDER BY e.id DESC
  `);
  res.json({ success: true, data: result.rows });
});

router.get('/:id', async (req, res) => {
  const result = await db.execute({
    sql: `SELECT e.id, e.name, e.category_id, c.name AS category_name, e.daily_rent, e.security_deposit,
                 e.current_status AS status, e.current_location AS location, e.notes
          FROM equipment e
          LEFT JOIN categories c ON c.id = e.category_id
          WHERE e.id = ? AND e.is_deleted = 0`,
    args: [req.params.id],
  });
  const row = result.rows[0];
  if (!row) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  res.json({ success: true, data: row });
});

router.post('/', validate(equipmentSchema), async (req, res) => {
  const value = req.body;
  const categoryId = await resolveCategoryId(value.category_id, value.category);
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO equipment (name, category_id, daily_rent, security_deposit, current_status, current_location, notes, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    args: [value.name, categoryId, value.daily_rent, value.security_deposit, value.status, value.location, value.notes, now, now],
  });
  res.status(201).json({ success: true, data: { id: Number(result.lastInsertRowid) } });
});

router.put('/:id', validate(equipmentSchema), async (req, res) => {
  const value = req.body;

  // Block hand-editing status away from "rented" while an open rental still
  // holds this equipment — otherwise it becomes selectable for a second rental
  // while the first one is still out, i.e. a double-booking.
  if (value.status !== 'rented') {
    const openRental = await db.execute({
      sql: `SELECT id FROM rentals WHERE equipment_id = ? AND rental_status IN ('active', 'overdue') LIMIT 1`,
      args: [req.params.id],
    });
    if (openRental.rows.length) {
      return res.status(409).json({ success: false, message: 'This equipment has an active rental. Process the return before changing its status.' });
    }
  }

  const categoryId = await resolveCategoryId(value.category_id, value.category);
  const result = await db.execute({
    sql: `UPDATE equipment SET name = ?, category_id = ?, daily_rent = ?, security_deposit = ?, current_status = ?, current_location = ?, notes = ?, updated_at = ?
          WHERE id = ? AND is_deleted = 0`,
    args: [value.name, categoryId, value.daily_rent, value.security_deposit, value.status, value.location, value.notes, new Date().toISOString(), req.params.id],
  });
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', requireRole('owner'), async (req, res) => {
  const result = await db.execute({
    sql: 'UPDATE equipment SET is_deleted = 1, updated_at = ? WHERE id = ?',
    args: [new Date().toISOString(), req.params.id],
  });
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

module.exports = router;
