const express = require('express');
const Joi = require('joi');

const { db } = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const customerSchema = Joi.object({
  full_name: Joi.string().trim().required(),
  phone_number: Joi.string().trim().required(),
  alternate_phone: Joi.string().trim().allow('').default(''),
  address: Joi.string().trim().allow('').default(''),
  status: Joi.string().valid('active', 'blocked').default('active'),
  notes: Joi.string().trim().allow('').default(''),
});

router.use(authenticate);

router.get('/', async (req, res) => {
  const result = await db.execute(`
    SELECT id, full_name, phone_number, alternate_phone, address, registration_date, status, notes
    FROM customers WHERE is_deleted = 0 ORDER BY id DESC
  `);
  res.json({ success: true, data: result.rows });
});

router.get('/:id', async (req, res) => {
  const result = await db.execute({
    sql: `SELECT id, full_name, phone_number, alternate_phone, address, registration_date, status, notes
          FROM customers WHERE id = ? AND is_deleted = 0`,
    args: [req.params.id],
  });
  const row = result.rows[0];
  if (!row) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: row });
});

router.post('/', validate(customerSchema), async (req, res) => {
  const value = req.body;
  const now = new Date();
  const result = await db.execute({
    sql: `INSERT INTO customers (full_name, phone_number, alternate_phone, address, registration_date, registration_time, status, notes, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    args: [
      value.full_name, value.phone_number, value.alternate_phone, value.address,
      now.toISOString().slice(0, 10), now.toTimeString().slice(0, 5),
      value.status, value.notes, now.toISOString(), now.toISOString(),
    ],
  });
  res.status(201).json({ success: true, data: { id: Number(result.lastInsertRowid) } });
});

router.put('/:id', validate(customerSchema), async (req, res) => {
  const value = req.body;
  const result = await db.execute({
    sql: `UPDATE customers SET full_name = ?, phone_number = ?, alternate_phone = ?, address = ?, status = ?, notes = ?, updated_at = ?
          WHERE id = ? AND is_deleted = 0`,
    args: [value.full_name, value.phone_number, value.alternate_phone, value.address, value.status, value.notes, new Date().toISOString(), req.params.id],
  });
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', async (req, res) => {
  const result = await db.execute({
    sql: 'UPDATE customers SET is_deleted = 1, updated_at = ? WHERE id = ?',
    args: [new Date().toISOString(), req.params.id],
  });
  if (!result.rowsAffected) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

module.exports = router;
