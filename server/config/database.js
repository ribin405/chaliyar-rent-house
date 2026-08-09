const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'rental-erp.sqlite');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    alternate_phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    photo_path TEXT,
    registration_date TEXT NOT NULL,
    registration_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT DEFAULT '',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category_id INTEGER,
    daily_rent REAL NOT NULL DEFAULT 0,
    security_deposit REAL NOT NULL DEFAULT 0,
    current_status TEXT NOT NULL DEFAULT 'available',
    current_location TEXT DEFAULT '',
    image_path TEXT,
    notes TEXT DEFAULT '',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL,
    customer_id INTEGER NOT NULL,
    equipment_id INTEGER NOT NULL,
    rental_date TEXT NOT NULL,
    rental_time TEXT NOT NULL,
    expected_return_date TEXT NOT NULL,
    expected_return_time TEXT NOT NULL,
    rental_days INTEGER NOT NULL DEFAULT 1,
    daily_rate REAL NOT NULL DEFAULT 0,
    deposit REAL NOT NULL DEFAULT 0,
    total_rent REAL NOT NULL DEFAULT 0,
    final_amount REAL NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    rental_status TEXT NOT NULL DEFAULT 'active',
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shop_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_name TEXT NOT NULL,
    shop_address TEXT NOT NULL,
    shop_phone TEXT NOT NULL,
    shop_email TEXT,
    shop_logo_path TEXT,
    invoice_prefix TEXT NOT NULL DEFAULT 'INV',
    currency_symbol TEXT NOT NULL DEFAULT '₹',
    updated_at TEXT NOT NULL
  );
`);

function ensureSeedData() {
  const existingAdmin = sqlite.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    sqlite.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('admin', hash, 'System Administrator', 'owner', 1, new Date().toISOString(), new Date().toISOString());
  }

  const existingSettings = sqlite.prepare('SELECT id FROM shop_settings WHERE id = 1').get();
  if (!existingSettings) {
    sqlite.prepare(`
      INSERT INTO shop_settings (id, shop_name, shop_address, shop_phone, shop_email, shop_logo_path, invoice_prefix, currency_symbol, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 'Electrical Equipment Rentals', '123 Main Street, City', '+91 9876543210', null, null, 'INV', '₹', new Date().toISOString());
  }

  const defaultCategories = ['Generator', 'Drill Machine', 'Welding Machine', 'Compressor', 'Cutting Machine', 'Mixer', 'Vibrator', 'Other'];
  for (const name of defaultCategories) {
    const existing = sqlite.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (!existing) {
      sqlite.prepare('INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, ?, ?)')
        .run(name, null, 1, new Date().toISOString());
    }
  }
}

ensureSeedData();

function prepare(query) {
  const sql = query.trim();

  return {
    get: (...params) => {
      if (sql.startsWith('SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?')) {
        return sqlite.prepare('SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?').get(params[0]);
      }

      if (sql.startsWith('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?')) {
        return sqlite.prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?').get(params[0]);
      }

      if (sql.startsWith('SELECT id FROM users WHERE username = ?')) {
        return sqlite.prepare('SELECT id FROM users WHERE username = ?').get(params[0]);
      }

      if (sql.startsWith('SELECT id FROM categories WHERE name = ?')) {
        return sqlite.prepare('SELECT id FROM categories WHERE name = ?').get(params[0]);
      }

      if (sql.startsWith('SELECT id FROM shop_settings WHERE id = 1')) {
        return sqlite.prepare('SELECT id FROM shop_settings WHERE id = 1').get();
      }

      if (sql.startsWith('SELECT shop_name, shop_address, shop_phone, shop_email, invoice_prefix, currency_symbol FROM shop_settings WHERE id = 1')) {
        return sqlite.prepare('SELECT shop_name, shop_address, shop_phone, shop_email, invoice_prefix, currency_symbol FROM shop_settings WHERE id = 1').get();
      }

      return undefined;
    },
    all: (...params) => {
      if (sql.startsWith('SELECT id, full_name, phone_number, alternate_phone, address, registration_date, status, notes FROM customers WHERE is_deleted = 0 ORDER BY id DESC')) {
        return sqlite.prepare('SELECT id, full_name, phone_number, alternate_phone, address, registration_date, status, notes FROM customers WHERE is_deleted = 0 ORDER BY id DESC').all();
      }

      if (sql.startsWith('SELECT e.id, e.name, c.name AS category_name, e.daily_rent, e.security_deposit, e.current_status AS status, e.current_location AS location, e.notes FROM equipment e')) {
        return sqlite.prepare(`
          SELECT e.id, e.name, c.name AS category_name, e.daily_rent, e.security_deposit, e.current_status AS status, e.current_location AS location, e.notes
          FROM equipment e
          LEFT JOIN categories c ON c.id = e.category_id
          WHERE e.is_deleted = 0
          ORDER BY e.id DESC
        `).all();
      }

      if (sql.startsWith('SELECT r.id, r.invoice_number, c.full_name AS customer_name, e.name AS equipment_name, r.rental_date, r.expected_return_date, r.rental_status AS status, r.final_amount AS amount')) {
        return sqlite.prepare(`
          SELECT r.id, r.invoice_number, c.full_name AS customer_name, e.name AS equipment_name, r.rental_date, r.expected_return_date, r.rental_status AS status, r.final_amount AS amount
          FROM rentals r
          JOIN customers c ON c.id = r.customer_id
          JOIN equipment e ON e.id = r.equipment_id
          ORDER BY r.id DESC
        `).all();
      }

      return [];
    },
    run: (...params) => {
      if (sql.startsWith('UPDATE customers SET')) {
        const [fullName, phoneNumber, alternatePhone, address, status, notes, updatedAt, id] = params;
        const result = sqlite.prepare(`
          UPDATE customers
          SET full_name = ?, phone_number = ?, alternate_phone = ?, address = ?, status = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `).run(fullName, phoneNumber, alternatePhone || '', address || '', status || 'active', notes || '', updatedAt, id);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.startsWith('DELETE FROM customers WHERE id = ?')) {
        const [id] = params;
        const result = sqlite.prepare('UPDATE customers SET is_deleted = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.startsWith('UPDATE equipment SET')) {
        const [name, categoryId, dailyRent, securityDeposit, status, location, notes, updatedAt, id] = params;
        const result = sqlite.prepare(`
          UPDATE equipment
          SET name = ?, category_id = ?, daily_rent = ?, security_deposit = ?, current_status = ?, current_location = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `).run(name, categoryId || null, dailyRent, securityDeposit, status || 'available', location || '', notes || '', updatedAt, id);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.startsWith('DELETE FROM equipment WHERE id = ?')) {
        const [id] = params;
        const result = sqlite.prepare('UPDATE equipment SET is_deleted = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.startsWith('UPDATE rentals SET')) {
        const [invoiceNumber, customerId, equipmentId, rentalDate, rentalTime, expectedReturnDate, expectedReturnTime, rentalDays, dailyRate, deposit, totalRent, finalAmount, paymentStatus, rentalStatus, updatedAt, id] = params;
        const result = sqlite.prepare(`
          UPDATE rentals
          SET invoice_number = ?, customer_id = ?, equipment_id = ?, rental_date = ?, rental_time = ?, expected_return_date = ?, expected_return_time = ?, rental_days = ?, daily_rate = ?, deposit = ?, total_rent = ?, final_amount = ?, payment_status = ?, rental_status = ?, updated_at = ?
          WHERE id = ?
        `).run(invoiceNumber, customerId, equipmentId, rentalDate, rentalTime, expectedReturnDate, expectedReturnTime, rentalDays, dailyRate, deposit, totalRent, finalAmount, paymentStatus, rentalStatus, updatedAt, id);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.startsWith('DELETE FROM rentals WHERE id = ?')) {
        const [id] = params;
        const result = sqlite.prepare('DELETE FROM rentals WHERE id = ?').run(id);
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.includes('INSERT INTO customers')) {
        const [fullName, phoneNumber, alternatePhone, address, photoPath, status, notes] = params;
        const result = sqlite.prepare(`
          INSERT INTO customers (full_name, phone_number, alternate_phone, address, photo_path, registration_date, registration_time, status, notes, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(fullName, phoneNumber, alternatePhone || '', address || '', photoPath || null, new Date().toISOString().slice(0, 10), new Date().toTimeString().slice(0, 5), status || 'active', notes || '', 0, new Date().toISOString(), new Date().toISOString());
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.includes('INSERT INTO equipment')) {
        // The API insert does not include an image path.  Keep the parameter
        // order aligned with that statement so the notes value is not treated
        // as an image path.
        const [name, categoryId, dailyRent, securityDeposit, status, location, notes] = params;
        const result = sqlite.prepare(`
          INSERT INTO equipment (name, category_id, daily_rent, security_deposit, current_status, current_location, image_path, notes, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(name, categoryId || null, dailyRent, securityDeposit, status || 'available', location || '', null, notes || '', 0, new Date().toISOString(), new Date().toISOString());
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.startsWith('INSERT INTO categories')) {
        const [name, description, isActive, createdAt] = params;
        const result = sqlite.prepare('INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, ?, ?)')
          .run(name, description || null, isActive ?? 1, createdAt || new Date().toISOString());
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.includes('INSERT INTO rentals')) {
        const [invoiceNumber, customerId, equipmentId, rentalDate, rentalTime, expectedReturnDate, expectedReturnTime, rentalDays, dailyRate, deposit, totalRent, finalAmount, paymentStatus, rentalStatus, createdBy] = params;
        const result = sqlite.prepare(`
          INSERT INTO rentals (invoice_number, customer_id, equipment_id, rental_date, rental_time, expected_return_date, expected_return_time, rental_days, daily_rate, deposit, total_rent, final_amount, payment_status, rental_status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(invoiceNumber, customerId, equipmentId, rentalDate, rentalTime, expectedReturnDate, expectedReturnTime, rentalDays, dailyRate, deposit, totalRent, finalAmount, paymentStatus, rentalStatus, createdBy, new Date().toISOString(), new Date().toISOString());
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.includes('INSERT INTO shop_settings')) {
        const [shopName, shopAddress, shopPhone, invoicePrefix, currencySymbol] = params;
        const result = sqlite.prepare(`
          INSERT INTO shop_settings (shop_name, shop_address, shop_phone, shop_email, shop_logo_path, invoice_prefix, currency_symbol, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(shopName, shopAddress, shopPhone, null, null, invoicePrefix, currencySymbol, new Date().toISOString());
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      if (sql.includes('INSERT INTO users')) {
        const [username, passwordHash, fullName, role] = params;
        const result = sqlite.prepare(`
          INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(username, passwordHash, fullName, role, 1, new Date().toISOString(), new Date().toISOString());
        return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
      }

      return { lastInsertRowid: 0, changes: 0 };
    }
  };
}

function exec() {}
function pragma() {}
function transaction(fn) {
  return (...args) => fn(...args);
}

const db = {
  prepare,
  exec,
  pragma,
  transaction
};

module.exports = db;
