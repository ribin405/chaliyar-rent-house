const express = require('express');
const Joi = require('joi');

const db = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const equipmentSchema = Joi.object({
  name: Joi.string().trim().required(),
  category_id: Joi.number().integer().positive().allow(null),
  category: Joi.string().trim().max(100).allow(''),
  daily_rent: Joi.number().min(0).required(),
  security_deposit: Joi.number().min(0).required(),
  status: Joi.string().valid('available', 'reserved', 'rented', 'maintenance').default('available'),
  location: Joi.string().trim().allow(''),
  notes: Joi.string().trim().allow(''),
});

router.use(authenticate);

const resolveCategoryId = (categoryId, categoryName) => {
  if (categoryId) return categoryId;
  const name = categoryName?.trim();
  if (!name) return null;
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, 1, ?)')
    .run(name, null, new Date().toISOString()).lastInsertRowid;
};

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.name, e.category_id, c.name AS category_name, e.daily_rent, e.security_deposit,
           e.current_status AS status, e.current_location AS location, e.notes
    FROM equipment e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.is_deleted = 0
    ORDER BY e.id DESC
  `).all();
  res.json({ success: true, data: rows });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT e.id, e.name, e.category_id, c.name AS category_name, e.daily_rent, e.security_deposit,
           e.current_status AS status, e.current_location AS location, e.notes
    FROM equipment e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.id = ? AND e.is_deleted = 0
  `).get(req.params.id);
  if (!row) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  res.json({ success: true, data: row });
});

router.post('/', validate(equipmentSchema), (req, res) => {
  const value = req.body;
  const categoryId = resolveCategoryId(value.category_id, value.category);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO equipment (name, category_id, daily_rent, security_deposit, current_status, current_location, notes, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const result = stmt.run(value.name, categoryId, value.daily_rent, value.security_deposit, value.status, value.location, value.notes, now, now);
  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

router.put('/:id', validate(equipmentSchema), (req, res) => {
  const value = req.body;

  // Block hand-editing status away from "rented" while an open rental still
  // holds this equipment — otherwise it becomes selectable for a second rental
  // while the first one is still out, i.e. a double-booking.
  if (value.status !== 'rented') {
    const openRental = db.prepare(`
      SELECT id FROM rentals WHERE equipment_id = ? AND rental_status IN ('active', 'overdue') LIMIT 1
    `).get(req.params.id);
    if (openRental) {
      return res.status(409).json({ success: false, message: 'This equipment has an active rental. Process the return before changing its status.' });
    }
  }

  const categoryId = resolveCategoryId(value.category_id, value.category);
  const stmt = db.prepare(`
    UPDATE equipment SET name = ?, category_id = ?, daily_rent = ?, security_deposit = ?, current_status = ?, current_location = ?, notes = ?, updated_at = ?
    WHERE id = ? AND is_deleted = 0
  `);
  const result = stmt.run(value.name, categoryId, value.daily_rent, value.security_deposit, value.status, value.location, value.notes, new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', requireRole('owner'), (req, res) => {
  const stmt = db.prepare('UPDATE equipment SET is_deleted = 1, updated_at = ? WHERE id = ?');
  const result = stmt.run(new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

module.exports = router;
