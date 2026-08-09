const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');

const db = require('./config/database');
const { authenticate, requireRole } = require('./middleware/auth');
const validate = require('./middleware/validate');
const errorHandler = require('./middleware/errorHandler');
const upload = require('./middleware/upload');
const Joi = require('joi');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const DEFAULT_PORT = 5000;
const requestedPort = Number(process.env.PORT);
const candidatePorts = [requestedPort || DEFAULT_PORT, DEFAULT_PORT, 5001].filter((port, index, ports) => port && ports.indexOf(port) === index);

app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running' });
});

app.post('/api/auth/login', (req, res, next) => {
  const schema = Joi.object({
    username: Joi.string().trim().required(),
    password: Joi.string().required(),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') })) });
  }

  const user = db.prepare('SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?').get(value.username);
  if (!user || !require('bcryptjs').compareSync(value.password, user.password_hash)) {
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
  if (!user.is_active) {
    return res.status(403).json({ success: false, message: 'Account has been deactivated' });
  }

  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' });
  const safeUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };

  res.json({ success: true, message: 'Login successful', token, user: safeUser, data: { token, user: safeUser } });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.get('/api/customers', authenticate, (req, res) => {
  const rows = db.prepare('SELECT id, full_name, phone_number, alternate_phone, address, registration_date, status, notes FROM customers WHERE is_deleted = 0 ORDER BY id DESC').all();
  res.json({ success: true, data: rows });
});

app.post('/api/customers', authenticate, (req, res) => {
  const schema = Joi.object({
    full_name: Joi.string().trim().required(),
    phone_number: Joi.string().trim().required(),
    alternate_phone: Joi.string().trim().allow(''),
    address: Joi.string().trim().allow(''),
    status: Joi.string().valid('active', 'blocked').default('active'),
    notes: Joi.string().trim().allow(''),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') })) });
  }

  const stmt = db.prepare(`
    INSERT INTO customers (full_name, phone_number, alternate_phone, address, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(value.full_name, value.phone_number, value.alternate_phone, value.address, value.status, value.notes);
  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

app.put('/api/customers/:id', authenticate, (req, res) => {
  const schema = Joi.object({
    full_name: Joi.string().trim().required(),
    phone_number: Joi.string().trim().required(),
    alternate_phone: Joi.string().trim().allow(''),
    address: Joi.string().trim().allow(''),
    status: Joi.string().valid('active', 'blocked').default('active'),
    notes: Joi.string().trim().allow(''),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') })) });
  }

  const stmt = db.prepare(`
    UPDATE customers SET full_name = ?, phone_number = ?, alternate_phone = ?, address = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?
  `);
  const result = stmt.run(value.full_name, value.phone_number, value.alternate_phone, value.address, value.status, value.notes, new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }

  res.json({ success: true, data: { id: Number(req.params.id) } });
});

app.delete('/api/customers/:id', authenticate, (req, res) => {
  const stmt = db.prepare('DELETE FROM customers WHERE id = ?');
  const result = stmt.run(req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Customer not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

app.get('/api/equipment', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.name, c.name AS category_name, e.daily_rent, e.security_deposit, e.current_status AS status, e.current_location AS location, e.notes
    FROM equipment e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.is_deleted = 0
    ORDER BY e.id DESC
  `).all();
  res.json({ success: true, data: rows });
});

const resolveEquipmentCategoryId = (categoryId, categoryName) => {
  if (categoryId) return categoryId;
  const name = categoryName?.trim();
  if (!name) return null;
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, ?, ?)')
    .run(name, null, 1, new Date().toISOString()).lastInsertRowid;
};

app.post('/api/equipment', authenticate, (req, res) => {
  const schema = Joi.object({
    name: Joi.string().trim().required(),
    category_id: Joi.number().integer().positive().allow(null),
    category: Joi.string().trim().max(100).allow(''),
    daily_rent: Joi.number().min(0).required(),
    security_deposit: Joi.number().min(0).required(),
    status: Joi.string().valid('available', 'reserved', 'rented', 'maintenance').default('available'),
    location: Joi.string().trim().allow(''),
    notes: Joi.string().trim().allow(''),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') })) });
  }

  const stmt = db.prepare(`
    INSERT INTO equipment (name, category_id, daily_rent, security_deposit, current_status, current_location, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const categoryId = resolveEquipmentCategoryId(value.category_id, value.category);
  const result = stmt.run(value.name, categoryId, value.daily_rent, value.security_deposit, value.status, value.location, value.notes);
  res.status(201).json({ success: true, data: { id: result.lastInsertRowid } });
});

app.put('/api/equipment/:id', authenticate, (req, res) => {
  const schema = Joi.object({
    name: Joi.string().trim().required(),
    category_id: Joi.number().integer().positive().allow(null),
    category: Joi.string().trim().max(100).allow(''),
    daily_rent: Joi.number().min(0).required(),
    security_deposit: Joi.number().min(0).required(),
    status: Joi.string().valid('available', 'reserved', 'rented', 'maintenance').default('available'),
    location: Joi.string().trim().allow(''),
    notes: Joi.string().trim().allow(''),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') })) });
  }

  const stmt = db.prepare(`
    UPDATE equipment SET name = ?, category_id = ?, daily_rent = ?, security_deposit = ?, current_status = ?, current_location = ?, notes = ?, updated_at = ? WHERE id = ?
  `);
  const categoryId = resolveEquipmentCategoryId(value.category_id, value.category);
  const result = stmt.run(value.name, categoryId, value.daily_rent, value.security_deposit, value.status, value.location, value.notes, new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }

  res.json({ success: true, data: { id: Number(req.params.id) } });
});

app.delete('/api/equipment/:id', authenticate, (req, res) => {
  const stmt = db.prepare('DELETE FROM equipment WHERE id = ?');
  const result = stmt.run(req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Equipment not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

app.get('/api/rentals', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.invoice_number, c.full_name AS customer_name, e.name AS equipment_name, r.rental_date, r.expected_return_date, r.rental_status AS status, r.final_amount AS amount
    FROM rentals r
    JOIN customers c ON c.id = r.customer_id
    JOIN equipment e ON e.id = r.equipment_id
    ORDER BY r.id DESC
  `).all();
  res.json({ success: true, data: rows });
});

app.post('/api/rentals', authenticate, (req, res) => {
  const schema = Joi.object({
    customer_id: Joi.number().integer().positive().required(),
    equipment_id: Joi.number().integer().positive().required(),
    rental_date: Joi.string().trim().required(),
    expected_return_date: Joi.string().trim().required(),
    rental_days: Joi.number().integer().min(1).default(1),
    daily_rate: Joi.number().min(0).required(),
    deposit: Joi.number().min(0).default(0),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') })) });
  }

  const invoiceNumber = `INV-${Date.now()}`;
  const totalRent = value.daily_rate * value.rental_days;
  const stmt = db.prepare(`
    INSERT INTO rentals (invoice_number, customer_id, equipment_id, rental_date, rental_time, expected_return_date, expected_return_time, rental_days, daily_rate, deposit, total_rent, final_amount, payment_status, rental_status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(invoiceNumber, value.customer_id, value.equipment_id, value.rental_date, '00:00', value.expected_return_date, '00:00', value.rental_days, value.daily_rate, value.deposit, totalRent, totalRent + value.deposit, 'pending', 'active', req.user.id);
  res.status(201).json({ success: true, data: { id: result.lastInsertRowid, invoice_number: invoiceNumber } });
});

app.put('/api/rentals/:id', authenticate, (req, res) => {
  const schema = Joi.object({
    customer_id: Joi.number().integer().positive().required(),
    equipment_id: Joi.number().integer().positive().required(),
    rental_date: Joi.string().trim().required(),
    expected_return_date: Joi.string().trim().required(),
    rental_days: Joi.number().integer().min(1).default(1),
    daily_rate: Joi.number().min(0).required(),
    deposit: Joi.number().min(0).default(0),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') })) });
  }

  const invoiceNumber = `INV-${req.params.id}`;
  const totalRent = value.daily_rate * value.rental_days;
  const stmt = db.prepare(`
    UPDATE rentals SET invoice_number = ?, customer_id = ?, equipment_id = ?, rental_date = ?, rental_time = ?, expected_return_date = ?, expected_return_time = ?, rental_days = ?, daily_rate = ?, deposit = ?, total_rent = ?, final_amount = ?, payment_status = ?, rental_status = ?, updated_at = ? WHERE id = ?
  `);
  const result = stmt.run(invoiceNumber, value.customer_id, value.equipment_id, value.rental_date, '00:00', value.expected_return_date, '00:00', value.rental_days, value.daily_rate, value.deposit, totalRent, totalRent + value.deposit, 'pending', 'active', new Date().toISOString(), req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }

  res.json({ success: true, data: { id: Number(req.params.id), invoice_number: invoiceNumber } });
});

app.delete('/api/rentals/:id', authenticate, (req, res) => {
  const stmt = db.prepare('DELETE FROM rentals WHERE id = ?');
  const result = stmt.run(req.params.id);
  if (!result.changes) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

app.get('/api/settings', authenticate, (req, res) => {
  const row = db.prepare('SELECT shop_name, shop_address, shop_phone, shop_email, invoice_prefix, currency_symbol FROM shop_settings WHERE id = 1').get();
  res.json({ success: true, data: row });
});

app.use(errorHandler);

if (require.main === module) {
  const tryListen = (index = 0) => {
    const port = candidatePorts[index];
    const server = app.listen(port, () => {
      console.log(`[SERVER] Running on http://localhost:${port}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && index + 1 < candidatePorts.length) {
        console.warn(`[SERVER] Port ${port} is busy. Trying ${candidatePorts[index + 1]} instead.`);
        server.close(() => tryListen(index + 1));
      } else {
        throw error;
      }
    });
  };

  tryListen();
}

module.exports = app;
