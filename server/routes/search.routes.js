const express = require('express');

const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const RESULT_LIMIT = 6;

// Escape LIKE wildcards so a typed "%" or "_" matches literally.
const toLikePattern = (value) => `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

router.use(authenticate);

router.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    return res.json({ success: true, data: { customers: [], equipment: [], rentals: [] } });
  }

  const pattern = toLikePattern(q);
  // Phone numbers are matched on digits only, so "98765 43210" finds "9876543210".
  const digits = q.replace(/\D/g, '');
  const phonePattern = digits.length >= 3 ? `%${digits}%` : null;

  const [customers, equipment, rentals] = await Promise.all([
    db.execute({
      sql: `
        SELECT id, full_name, phone_number, alternate_phone, status
        FROM customers
        WHERE is_deleted = 0 AND (
          full_name ILIKE ? OR phone_number ILIKE ? OR alternate_phone ILIKE ?
          OR (?::text IS NOT NULL AND (
            regexp_replace(phone_number, '\\D', '', 'g') LIKE ?
            OR regexp_replace(COALESCE(alternate_phone, ''), '\\D', '', 'g') LIKE ?
          ))
        )
        ORDER BY full_name
        LIMIT ${RESULT_LIMIT}
      `,
      args: [pattern, pattern, pattern, phonePattern, phonePattern, phonePattern],
    }),
    db.execute({
      sql: `
        SELECT e.id, e.name, c.name AS category_name, e.current_status AS status, e.current_location AS location
        FROM equipment e
        LEFT JOIN categories c ON c.id = e.category_id
        WHERE e.is_deleted = 0 AND (e.name ILIKE ? OR c.name ILIKE ? OR e.current_location ILIKE ?)
        ORDER BY e.name
        LIMIT ${RESULT_LIMIT}
      `,
      args: [pattern, pattern, pattern],
    }),
    db.execute({
      sql: `
        SELECT r.id, r.invoice_number, c.full_name AS customer_name, c.phone_number AS customer_phone,
               e.name AS equipment_name, r.rental_status AS status
        FROM rentals r
        JOIN customers c ON c.id = r.customer_id
        JOIN equipment e ON e.id = r.equipment_id
        WHERE r.invoice_number ILIKE ? OR c.full_name ILIKE ? OR e.name ILIKE ? OR c.phone_number ILIKE ?
          OR (?::text IS NOT NULL AND regexp_replace(c.phone_number, '\\D', '', 'g') LIKE ?)
        ORDER BY r.id DESC
        LIMIT ${RESULT_LIMIT}
      `,
      args: [pattern, pattern, pattern, pattern, phonePattern, phonePattern],
    }),
  ]);

  res.json({
    success: true,
    data: { customers: customers.rows, equipment: equipment.rows, rentals: rentals.rows },
  });
});

module.exports = router;
