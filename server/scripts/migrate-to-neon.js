/**
 * One-off migration: copies every real row from the local SQLite file
 * (server/data/rental-erp.sqlite) into Neon (Postgres), preserving original
 * ids so rentals.customer_id / rentals.equipment_id / payments.rental_id keep
 * pointing at the right rows.
 *
 * Requires `better-sqlite3` (installed with `npm install --no-save
 * better-sqlite3` — it's not a runtime dependency, only needed to read the old
 * file for this one run) and DATABASE_URL pointed at the target Neon database.
 *
 * Run from server/: node scripts/migrate-to-neon.js
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const Database = require('better-sqlite3');
const { db, ensureSchema } = require('../config/database');

const LOCAL_DB_PATH = path.join(__dirname, '..', 'data', 'rental-erp.sqlite');

// Order matters: customers/categories/equipment before rentals (which reference
// them), rentals before payments (which reference rentals).
const TABLES = [
  {
    name: 'shop_settings',
    columns: ['id', 'shop_name', 'shop_address', 'shop_phone', 'shop_email', 'shop_logo_path', 'invoice_prefix', 'currency_symbol', 'updated_at'],
  },
  {
    name: 'users',
    columns: ['id', 'username', 'password_hash', 'full_name', 'role', 'is_active', 'created_at', 'updated_at'],
  },
  {
    name: 'categories',
    columns: ['id', 'name', 'description', 'is_active', 'created_at'],
  },
  {
    name: 'customers',
    columns: ['id', 'full_name', 'phone_number', 'alternate_phone', 'address', 'photo_path', 'registration_date', 'registration_time', 'status', 'notes', 'is_deleted', 'created_at', 'updated_at'],
  },
  {
    name: 'equipment',
    columns: ['id', 'name', 'category_id', 'daily_rent', 'security_deposit', 'current_status', 'current_location', 'image_path', 'notes', 'is_deleted', 'created_at', 'updated_at'],
  },
  {
    name: 'rentals',
    columns: ['id', 'invoice_number', 'customer_id', 'equipment_id', 'rental_date', 'rental_time', 'expected_return_date', 'expected_return_time', 'rental_days', 'daily_rate', 'deposit', 'total_rent', 'final_amount', 'payment_status', 'rental_status', 'actual_return_date', 'actual_return_time', 'late_fee', 'damage_charge', 'refund_amount', 'return_notes', 'created_by', 'created_at', 'updated_at'],
  },
  {
    name: 'payments',
    columns: ['id', 'rental_id', 'invoice_number', 'amount', 'discount', 'payment_method', 'payment_type', 'payment_date', 'notes', 'created_by', 'created_at'],
  },
];

async function migrateTable(sqlite, table) {
  const { name, columns } = table;
  const existingCols = sqlite.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
  const usableColumns = columns.filter((c) => existingCols.includes(c));
  const rows = sqlite.prepare(`SELECT ${usableColumns.join(', ')} FROM ${name}`).all();

  for (const row of rows) {
    const placeholders = usableColumns.map(() => '?').join(', ');
    const values = usableColumns.map((c) => row[c]);
    await db.execute({
      sql: `INSERT INTO ${name} (${usableColumns.join(', ')}) VALUES (${placeholders})
            ON CONFLICT (id) DO NOTHING`,
      args: values,
    });
  }

  if (usableColumns.includes('id')) {
    await db.execute(`
      SELECT setval(
        pg_get_serial_sequence('${name}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${name}), 1),
        (SELECT MAX(id) FROM ${name}) IS NOT NULL
      )
    `);
  }

  return rows.length;
}

async function checkOrphans(sqlite) {
  const orphanChecks = [
    { table: 'rentals', column: 'customer_id', refTable: 'customers' },
    { table: 'rentals', column: 'equipment_id', refTable: 'equipment' },
    { table: 'payments', column: 'rental_id', refTable: 'rentals' },
  ];
  const issues = [];
  for (const { table, column, refTable } of orphanChecks) {
    const rows = sqlite.prepare(`
      SELECT t.id FROM ${table} t
      LEFT JOIN ${refTable} r ON r.id = t.${column}
      WHERE t.${column} IS NOT NULL AND r.id IS NULL
    `).all();
    if (rows.length) {
      issues.push(`${table}.${column} -> ${refTable}: ${rows.length} orphaned row(s) (ids: ${rows.map((r) => r.id).join(', ')})`);
    }
  }
  return issues;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check the root .env file). Aborting.');
    process.exit(1);
  }

  const sqlite = new Database(LOCAL_DB_PATH, { readonly: true });

  console.log('Creating schema in Neon (if not already present)...');
  await ensureSchema();

  console.log('\nChecking for orphaned references in the source data...');
  const issues = await checkOrphans(sqlite);
  if (issues.length) {
    console.warn('WARNING — the old SQLite data has orphaned references (it never enforced foreign keys either):');
    issues.forEach((issue) => console.warn(`  - ${issue}`));
  } else {
    console.log('  none found.');
  }

  console.log('\nMigrating tables...');
  const counts = {};
  for (const table of TABLES) {
    counts[table.name] = await migrateTable(sqlite, table);
    console.log(`  ${table.name}: ${counts[table.name]} row(s) migrated`);
  }

  sqlite.close();

  console.log('\nDone. Row counts:', counts);
  console.log('Compare these against the old SQLite file (e.g. `SELECT COUNT(*) FROM <table>` via a SQLite viewer) before trusting this migration.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
