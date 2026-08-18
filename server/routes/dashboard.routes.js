const express = require('express');

const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/stats', async (req, res) => {
  await db.execute(`
    UPDATE rentals SET rental_status = 'overdue'
    WHERE rental_status = 'active' AND date(expected_return_date) < date('now')
  `);

  const [
    totalCustomersResult,
    availableEquipmentResult,
    activeRentalsResult,
    overdueRentalsResult,
    totalRevenueResult,
    pendingPaymentsResult,
    recentRentalsResult,
    recentPaymentsResult,
    revenueByMonthResult,
  ] = await Promise.all([
    db.execute("SELECT COUNT(*) AS count FROM customers WHERE is_deleted = 0"),
    db.execute("SELECT COUNT(*) AS count FROM equipment WHERE is_deleted = 0 AND current_status = 'available'"),
    db.execute("SELECT COUNT(*) AS count FROM rentals WHERE rental_status = 'active'"),
    db.execute("SELECT COUNT(*) AS count FROM rentals WHERE rental_status = 'overdue'"),
    db.execute("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type != 'refund'"),
    db.execute(`SELECT COALESCE(SUM(final_amount), 0) AS total FROM rentals WHERE payment_status IN ('pending', 'partial')`),
    db.execute(`
      SELECT r.id, r.invoice_number, c.full_name AS customer_name, e.name AS equipment_name, r.rental_status AS status, r.final_amount AS amount
      FROM rentals r
      JOIN customers c ON c.id = r.customer_id
      JOIN equipment e ON e.id = r.equipment_id
      ORDER BY r.id DESC LIMIT 5
    `),
    db.execute(`
      SELECT p.id, r.invoice_number, c.full_name AS customer_name, p.amount, p.payment_type, p.payment_date
      FROM payments p
      JOIN rentals r ON r.id = p.rental_id
      JOIN customers c ON c.id = r.customer_id
      ORDER BY p.id DESC LIMIT 5
    `),
    db.execute(`
      SELECT strftime('%Y-%m', payment_date) AS month, SUM(amount) AS total
      FROM payments
      WHERE payment_type != 'refund' AND payment_date >= date('now', '-6 months')
      GROUP BY month ORDER BY month ASC
    `),
  ]);

  res.json({
    success: true,
    data: {
      totalCustomers: totalCustomersResult.rows[0].count,
      availableEquipment: availableEquipmentResult.rows[0].count,
      activeRentals: activeRentalsResult.rows[0].count,
      overdueRentals: overdueRentalsResult.rows[0].count,
      totalRevenue: totalRevenueResult.rows[0].total,
      pendingPayments: pendingPaymentsResult.rows[0].total,
      recentRentals: recentRentalsResult.rows,
      recentPayments: recentPaymentsResult.rows,
      revenueByMonth: revenueByMonthResult.rows,
    },
  });
});

module.exports = router;
