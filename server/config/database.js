const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { createClient } = require('@libsql/client');

// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN point at a hosted libSQL (Turso) database
// in production (needed on Vercel — no persistent local disk there). Falling
// back to a local file keeps `npm run dev` working with zero external account.
const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
const LOCAL_DB_PATH = path.join(DB_DIR, 'rental-erp.sqlite');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${LOCAL_DB_PATH}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const SCHEMA_SQL = `
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
`;

// Add columns to tables that pre-date this migration, one at a time (SQLite
// has no "ADD COLUMN IF NOT EXISTS", so each addition is guarded manually).
async function ensureColumn(table, column, definition) {
  const existing = await db.execute(`PRAGMA table_info(${table})`);
  const hasColumn = existing.rows.some((col) => col.name === column);
  if (!hasColumn) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureSeedData() {
  const existingAdmin = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: ['admin'] });
  if (!existingAdmin.rows.length) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.execute({
      sql: `INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['admin', hash, 'System Administrator', 'owner', 1, new Date().toISOString(), new Date().toISOString()],
    });
  }

  const existingSettings = await db.execute('SELECT id FROM shop_settings WHERE id = 1');
  if (!existingSettings.rows.length) {
    await db.execute({
      sql: `INSERT INTO shop_settings (id, shop_name, shop_address, shop_phone, shop_email, shop_logo_path, invoice_prefix, currency_symbol, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [1, 'Electrical Equipment Rentals', '123 Main Street, City', '+91 9876543210', null, null, 'INV', '₹', new Date().toISOString()],
    });
  }

  const defaultCategories = ['Generator', 'Drill Machine', 'Welding Machine', 'Compressor', 'Cutting Machine', 'Mixer', 'Vibrator', 'Other'];
  for (const name of defaultCategories) {
    const existing = await db.execute({ sql: 'SELECT id FROM categories WHERE name = ?', args: [name] });
    if (!existing.rows.length) {
      await db.execute({
        sql: 'INSERT INTO categories (name, description, is_active, created_at) VALUES (?, ?, ?, ?)',
        args: [name, null, 1, new Date().toISOString()],
      });
    }
  }
}

async function initialize() {
  try {
    await db.execute('PRAGMA journal_mode = WAL');
    await db.execute('PRAGMA foreign_keys = ON');
  } catch {
    // Remote libSQL connections manage journaling/foreign keys server-side and
    // may reject these pragmas — harmless to skip them in that case.
  }

  await db.executeMultiple(SCHEMA_SQL);

  await ensureColumn('rentals', 'actual_return_date', 'TEXT');
  await ensureColumn('rentals', 'actual_return_time', 'TEXT');
  await ensureColumn('rentals', 'late_fee', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('rentals', 'damage_charge', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('rentals', 'refund_amount', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('rentals', 'return_notes', "TEXT DEFAULT ''");
  await ensureColumn('payments', 'discount', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('payments', 'invoice_number', 'TEXT');

  // One invoice can cover several equipment items (rentals rows). Payments settle
  // the whole invoice at once, so backfill invoice_number for any pre-existing
  // payment rows that only recorded a single rental_id.
  await db.execute(`
    UPDATE payments SET invoice_number = (SELECT invoice_number FROM rentals WHERE rentals.id = payments.rental_id)
    WHERE invoice_number IS NULL
  `);

  // Rentals resolve customers by phone number, so this lookup runs on every create/edit.
  await db.execute('CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_rentals_invoice ON rentals(invoice_number)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_number)');

  await ensureSeedData();
}

// Memoized so schema/seed setup runs once per warm process (persistent server
// locally, or a warm serverless container on Vercel) instead of on every call.
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = initialize();
  }
  return readyPromise;
}

module.exports = { db, ready };
