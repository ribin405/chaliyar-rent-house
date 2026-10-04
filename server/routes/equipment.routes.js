const express = require('express');
const Joi = require('joi');

const { db } = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { OPEN_STATUSES, unitsOut, syncEquipmentStatus } = require('../utils/stock');

const router = express.Router();

const equipmentSchema = Joi.object({
  name: Joi.string().trim().required(),
  category_id: Joi.number().integer().positive().allow(null),
  category: Joi.string().trim().max(100).allow('').default(''),
  daily_rent: Joi.number().min(0).required(),
  security_deposit: Joi.number().min(0).required(),
  // Identical units held, e.g. 20 belt sheets. Single machines stay at 1.
  stock_quantity: Joi.number().integer().min(1).default(1),
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
    sql: 'INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, 1, ?) RETURNING id',
    args: [name, null, new Date().toISOString()],
  });
  return Number(result.lastInsertRowid);
};

router.get('/', async (req, res) => {
  const result = await db.execute(`
    SELECT e.id, e.name, e.category_id, c.name AS category_name, e.daily_rent, e.security_deposit,
           e.current_status AS status, e.current_location AS location, e.notes,
           e.stock_quantity, COALESCE(o.units_out, 0)::int AS units_out,
           CASE WHEN e.current_status IN ('maintenance', 'reserved') THEN 0
                ELSE GREATEST(e.stock_quantity - COALESCE(o.units_out, 0), 0) END::int AS available_quantity
    FROM equipment e
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT equipment_id, SUM(quantity) AS units_out FROM rentals
      WHERE rental_status IN ${OPEN_STATUSES} GROUP BY equipment_id
    ) o ON o.equipment_id = e.id
    WHERE e.is_deleted = 0
    ORDER BY e.id DESC
  `);
  res.json({ success: true, data: result.rows });
});

router.get('/:id', async (req, res) => {
  const result = await db.execute({
    sql: `SELECT e.id, e.name, e.category_id, c.name AS category_name, e.daily_rent, e.security_deposit,
           e.current_status AS status, e.current_location AS location, e.notes,
           e.stock_quantity, COALESCE(o.units_out, 0)::int AS units_out,
           CASE WHEN e.current_status IN ('maintenance', 'reserved') THEN 0
                ELSE GREATEST(e.stock_quantity - COALESCE(o.units_out, 0), 0) END::int AS available_quantity
          FROM equipment e
          LEFT JOIN categories c ON c.id = e.category_id
          LEFT JOIN (
      SELECT equipment_id, SUM(quantity) AS units_out FROM rentals
      WHERE rental_status IN ${OPEN_STATUSES} GROUP BY equipment_id
    ) o ON o.equipment_id = e.id
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
    sql: `INSERT INTO equipment (name, category_id, daily_rent, security_deposit, stock_quantity, current_status, current_location, notes, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) RETURNING id`,
    args: [value.name, categoryId, value.daily_rent, value.security_deposit, value.stock_quantity, value.status, value.location, value.notes, now, now],
  });
  res.status(201).json({ success: true, data: { id: Number(result.lastInsertRowid) } });
});

router.put('/:id', validate(equipmentSchema), async (req, res) => {
  const value = req.body;

  // Stock can't drop below what's out on rent, and while every unit is out the
  // status can't be hand-edited away from "rented" — otherwise it becomes
  // selectable for another rental while it's all still out, a double-booking.
  const out = await unitsOut(req.params.id, db);
  if (value.stock_quantity < out) {
    return res.status(409).json({ success: false, message: `${out} unit(s) are out on rent, so stock can't be less than ${out}.` });
  }
  if (value.status !== 'rented' && out > 0 && out >= value.stock_quantity) {
    return res.status(409).json({ success: false, message: 'This equipment has an active rental. Process the return before changing its status.' });
  }

  const categoryId = await resolveCategoryId(value.category_id, value.category);
  const result = await db.execute({
    sql: `UPDATE equipment SET name = ?, category_id = ?, daily_rent = ?, security_deposit = ?, stock_quantity = ?, current_status = ?, current_location = ?, notes = ?, updated_at = ?
          WHERE id = ? AND is_deleted = 0`,
    args: [value.name, categoryId, value.daily_rent, value.security_deposit, value.stock_quantity, value.status, value.location, value.notes, new Date().toISOString(), req.params.id],
  });
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  // A stock change can free up or use up the last unit.
  await syncEquipmentStatus([req.params.id], db);
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
