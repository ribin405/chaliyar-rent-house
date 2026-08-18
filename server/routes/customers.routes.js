const express = require('express');
const Joi = require('joi');

const db = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const customerSchema = Joi.object({
  full_name: Joi.string().trim().required(),
  phone_number: Joi.string().trim().required(),
  alternate_phone: Joi.string().trim().allow(''),
  address: Joi.string().trim().allow(''),
  status: Joi.string().valid('active', 'blocked').default('active'),
  notes: Joi.string().trim().allow(''),
});

router.use(authenticate);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, full_name, phone_number, alternate_phone, address, registration_date, status, notes
    FROM customers WHERE is_deleted = 0 ORDER BY id DESC
  `).all();
  res.json({ success: true, data: rows });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT id, full_name, phone_number, alternate_phone, address, registration_date, status, notes
    FROM customers WHERE id = ? AND is_deleted = 0
  `).get(req.params.id);
  if (!row) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: row });
});

router.post('/', validate(customerSchema), (req, res) => {
  const value = req.body;
  const now = new Date();
  const stmt = db.prepare(`
    INSERT INTO customers (full_name, phone_number, alternate_phone, address, registration_date, registration_time, status, notes, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const result = stmt.run(
    value.full_name, value.phone_number, value.alternate_phone, value.address,
    now.toISOString().slice(0, 10), now.toTimeString().slice(0, 5),
    value.status, value.notes, now.toISOString(), now.toISOString(),
  );
  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

router.put('/:id', validate(customerSchema), (req, res) => {
  const value = req.body;
  const stmt = db.prepare(`
    UPDATE customers SET full_name = ?, phone_number = ?, alternate_phone = ?, address = ?, status = ?, notes = ?, updated_at = ?
    WHERE id = ? AND is_deleted = 0
  `);
  const result = stmt.run(value.full_name, value.phone_number, value.alternate_phone, value.address, value.status, value.notes, new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', (req, res) => {
  const stmt = db.prepare('UPDATE customers SET is_deleted = 1, updated_at = ? WHERE id = ?');
  const result = stmt.run(new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

module.exports = router;
