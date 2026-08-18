const express = require('express');
const Joi = require('joi');

const db = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { recomputeForInvoice } = require('../utils/paymentStatus');

const router = express.Router();

// Payments settle a whole invoice (which may cover several equipment items),
// not a single rental line item — a customer paying for a multi-item rental
// makes one payment, not one per item.
const paymentSchema = Joi.object({
  invoice_number: Joi.string().trim().required(),
  amount: Joi.number().min(0).default(0),
  discount: Joi.number().min(0).default(0),
  payment_method: Joi.string().valid('cash', 'card', 'upi', 'bank_transfer', 'other').default('cash'),
  payment_type: Joi.string().valid('rent', 'deposit', 'refund').default('rent'),
  notes: Joi.string().trim().allow(''),
});

router.use(authenticate);

router.get('/', (req, res) => {
  const { invoice_number: invoiceNumber, customer_id: customerId } = req.query;

  let query = `
    SELECT p.id, p.invoice_number, c.full_name AS customer_name, p.amount, p.discount, p.payment_method, p.payment_type, p.payment_date, p.notes, p.created_at
    FROM payments p
    JOIN rentals r ON r.id = p.rental_id
    JOIN customers c ON c.id = r.customer_id
  `;
  const clauses = [];
  const params = [];
  if (invoiceNumber) {
    clauses.push('p.invoice_number = ?');
    params.push(invoiceNumber);
  }
  if (customerId) {
    clauses.push('r.customer_id = ?');
    params.push(customerId);
  }
  if (clauses.length) {
    query += ` WHERE ${clauses.join(' AND ')}`;
  }
  query += ' ORDER BY p.id DESC';

  const rows = db.prepare(query).all(...params);
  res.json({ success: true, data: rows });
});

router.post('/', validate(paymentSchema), (req, res) => {
  const value = req.body;

  if (value.amount <= 0 && value.discount <= 0) {
    return res.status(400).json({ success: false, message: 'Enter a payment amount or a discount.' });
  }

  // Any rental row sharing this invoice number works as the anchor for the
  // NOT NULL rental_id column; the payment itself applies to the whole invoice.
  const invoiceItems = db.prepare('SELECT id FROM rentals WHERE invoice_number = ? ORDER BY id ASC').all(value.invoice_number);
  if (!invoiceItems.length) {
    return res.status(404).json({ success: false, message: 'Invoice not found' });
  }

  const now = new Date();
  const recordPayment = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO payments (rental_id, invoice_number, amount, discount, payment_method, payment_type, payment_date, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceItems[0].id, value.invoice_number, value.amount, value.discount, value.payment_method, value.payment_type, now.toISOString().slice(0, 10), value.notes || '', req.user.id, now.toISOString());
    recomputeForInvoice(value.invoice_number);
    return result;
  });

  const result = recordPayment();
  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

module.exports = router;
