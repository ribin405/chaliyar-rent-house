const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'rental-erp.sqlite');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rental_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    payment_type TEXT NOT NULL DEFAULT 'rent',
    payment_date TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT NOT NULL
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

// Add columns to tables that pre-date this migration, one at a time (SQLite
// has no "ADD COLUMN IF NOT EXISTS", so each addition is guarded manually).
function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = existing.some((col) => col.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('rentals', 'actual_return_date', 'TEXT');
ensureColumn('rentals', 'actual_return_time', 'TEXT');
ensureColumn('rentals', 'late_fee', "REAL NOT NULL DEFAULT 0");
ensureColumn('rentals', 'damage_charge', "REAL NOT NULL DEFAULT 0");
ensureColumn('rentals', 'refund_amount', "REAL NOT NULL DEFAULT 0");
ensureColumn('rentals', 'return_notes', "TEXT DEFAULT ''");
ensureColumn('payments', 'discount', 'REAL NOT NULL DEFAULT 0');
ensureColumn('payments', 'invoice_number', 'TEXT');

// One invoice can cover several equipment items (rentals rows). Payments settle
// the whole invoice at once, so backfill invoice_number for any pre-existing
// payment rows that only recorded a single rental_id.
db.prepare(`
  UPDATE payments SET invoice_number = (SELECT invoice_number FROM rentals WHERE rentals.id = payments.rental_id)
  WHERE invoice_number IS NULL
`).run();

// Rentals resolve customers by phone number, so this lookup runs on every create/edit.
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number)');
db.exec('CREATE INDEX IF NOT EXISTS idx_rentals_invoice ON rentals(invoice_number)');
db.exec('CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_number)');

function ensureSeedData() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('admin', hash, 'System Administrator', 'owner', 1, new Date().toISOString(), new Date().toISOString());
  }

  const existingSettings = db.prepare('SELECT id FROM shop_settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO shop_settings (id, shop_name, shop_address, shop_phone, shop_email, shop_logo_path, invoice_prefix, currency_symbol, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 'Electrical Equipment Rentals', '123 Main Street, City', '+91 9876543210', null, null, 'INV', '₹', new Date().toISOString());
  }

  const defaultCategories = ['Generator', 'Drill Machine', 'Welding Machine', 'Compressor', 'Cutting Machine', 'Mixer', 'Vibrator', 'Other'];
  for (const name of defaultCategories) {
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (!existing) {
      db.prepare('INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, ?, ?)')
        .run(name, null, 1, new Date().toISOString());
    }
  }
}

ensureSeedData();

module.exports = db;
