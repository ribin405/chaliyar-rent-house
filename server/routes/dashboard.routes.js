const express = require('express');

const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// Everything the front desk acts on today: equipment that's out (to chase or
// receive), invoices with money still owed, and today's takings.
router.get('/today', async (req, res) => {
  await db.execute(`
    UPDATE rentals SET rental_status = 'overdue'
    WHERE rental_status = 'active' AND expected_return_date::date < CURRENT_DATE
  `);

  // Same UTC calendar date the rest of the app stamps payments/rentals with.
  const today = new Date().toISOString().slice(0, 10);

  const [openItemsResult, unpaidInvoicesResult, todayPaymentsResult, todayCountsResult, recentCustomersResult] = await Promise.all([
    db.execute(`
      SELECT r.id, r.invoice_number, c.full_name AS customer_name, c.phone_number AS customer_phone,
             r.equipment_id, e.name AS equipment_name, r.quantity, r.rental_date, r.expected_return_date, r.expected_return_time,
             r.rental_status AS status
      FROM rentals r
      JOIN customers c ON c.id = r.customer_id
      JOIN equipment e ON e.id = r.equipment_id
      WHERE r.rental_status IN ('active', 'overdue')
      ORDER BY r.expected_return_date ASC, r.id ASC
    `),
    // Balance mirrors utils/paymentStatus.js: rent payments plus discounts settle
    // the invoice; deposits and refunds don't.
    db.execute(`
      WITH invoices AS (
        SELECT invoice_number, MIN(customer_id) AS customer_id, MIN(rental_date) AS rental_date,
               SUM(final_amount) AS total, COUNT(*)::int AS item_count,
               COUNT(*) FILTER (WHERE rental_status IN ('active', 'overdue'))::int AS open_count,
               MIN(payment_status) AS payment_status
        FROM rentals
        WHERE payment_status IN ('pending', 'partial')
        GROUP BY invoice_number
      ),
      settled AS (
        SELECT invoice_number, SUM(amount + discount) AS settled
        FROM payments WHERE payment_type = 'rent'
        GROUP BY invoice_number
      )
      SELECT i.invoice_number, c.full_name AS customer_name, c.phone_number AS customer_phone,
             i.rental_date, i.total, COALESCE(s.settled, 0) AS paid, i.total - COALESCE(s.settled, 0) AS balance,
             i.item_count, i.open_count, i.payment_status
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      LEFT JOIN settled s ON s.invoice_number = i.invoice_number
      WHERE i.total - COALESCE(s.settled, 0) > 0
      ORDER BY (i.open_count = 0) DESC, i.rental_date ASC
      LIMIT 30
    `),
    db.execute({
      sql: `
        SELECT p.id, p.invoice_number, c.full_name AS customer_name, p.amount, p.payment_type, p.payment_method
        FROM payments p
        JOIN rentals r ON r.id = p.rental_id
        JOIN customers c ON c.id = r.customer_id
        WHERE p.payment_date = ?
        ORDER BY p.id DESC
      `,
      args: [today],
    }),
    db.execute({
      sql: `
        SELECT
          COUNT(DISTINCT invoice_number) FILTER (WHERE rental_date = ?)::int AS rentals_started,
          COUNT(*) FILTER (WHERE actual_return_date = ?)::int AS items_returned
        FROM rentals
      `,
      args: [today, today],
    }),
    // Customers with the most recent rentals, and what each still has out.
    db.execute(`
      WITH latest AS (
        SELECT customer_id, MAX(id) AS last_rental_id
        FROM rentals GROUP BY customer_id
        ORDER BY last_rental_id DESC LIMIT 8
      ),
      open_items AS (
        SELECT customer_id,
               COUNT(*)::int AS open_count,
               COUNT(*) FILTER (WHERE rental_status = 'overdue')::int AS overdue_count,
               array_agg(DISTINCT invoice_number) AS open_invoices
        FROM rentals WHERE rental_status IN ('active', 'overdue')
        GROUP BY customer_id
      )
      SELECT c.id, c.full_name, c.phone_number, r.rental_date AS last_rental_date, r.invoice_number AS last_invoice,
             COALESCE(o.open_count, 0) AS open_count, COALESCE(o.overdue_count, 0) AS overdue_count,
             COALESCE(o.open_invoices, '{}') AS open_invoices
      FROM latest l
      JOIN customers c ON c.id = l.customer_id
      JOIN rentals r ON r.id = l.last_rental_id
      LEFT JOIN open_items o ON o.customer_id = c.id
      ORDER BY l.last_rental_id DESC
    `),
  ]);

  const todayPayments = todayPaymentsResult.rows;
  const collected = todayPayments.filter((p) => p.payment_type !== 'refund').reduce((sum, p) => sum + p.amount, 0);
  const refunded = todayPayments.filter((p) => p.payment_type === 'refund').reduce((sum, p) => sum + p.amount, 0);

  res.json({
    success: true,
    data: {
      today,
      openItems: openItemsResult.rows,
      unpaidInvoices: unpaidInvoicesResult.rows,
      todayPayments,
      recentCustomers: recentCustomersResult.rows,
      summary: {
        rentalsStarted: todayCountsResult.rows[0].rentals_started,
        itemsReturned: todayCountsResult.rows[0].items_returned,
        collected,
        refunded,
      },
    },
  });
});

module.exports = router;
