const express = require('express');
const Joi = require('joi');

const db = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const settingsSchema = Joi.object({
  shop_name: Joi.string().trim().required(),
  shop_address: Joi.string().trim().required(),
  shop_phone: Joi.string().trim().required(),
  shop_email: Joi.string().trim().email().allow(''),
  invoice_prefix: Joi.string().trim().default('INV'),
  currency_symbol: Joi.string().trim().default('₹'),
});

router.use(authenticate);

router.get('/', (req, res) => {
  const row = db.prepare('SELECT shop_name, shop_address, shop_phone, shop_email, invoice_prefix, currency_symbol FROM shop_settings WHERE id = 1').get();
  res.json({ success: true, data: row });
});

router.put('/', requireRole('owner'), validate(settingsSchema), (req, res) => {
  const value = req.body;
  db.prepare(`
    UPDATE shop_settings SET shop_name = ?, shop_address = ?, shop_phone = ?, shop_email = ?, invoice_prefix = ?, currency_symbol = ?, updated_at = ?
    WHERE id = 1
  `).run(value.shop_name, value.shop_address, value.shop_phone, value.shop_email || null, value.invoice_prefix, value.currency_symbol, new Date().toISOString());
  res.json({ success: true, data: value });
});

module.exports = router;
