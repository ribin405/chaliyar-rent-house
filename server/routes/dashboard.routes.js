const express = require('express');

const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/stats', (req, res) => {
  db.prepare(`
    UPDATE rentals SET rental_status = 'overdue'
    WHERE rental_status = 'active' AND date(expected_return_date) < date('now')
  `).run();

  const totalCustomers = db.prepare("SELECT COUNT(*) AS count FROM customers WHERE is_deleted = 0").get().count;
  const availableEquipment = db.prepare("SELECT COUNT(*) AS count FROM equipment WHERE is_deleted = 0 AND current_status = 'available'").get().count;
  const activeRentals = db.prepare("SELECT COUNT(*) AS count FROM rentals WHERE rental_status = 'active'").get().count;
  const overdueRentals = db.prepare("SELECT COUNT(*) AS count FROM rentals WHERE rental_status = 'overdue'").get().count;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type != 'refund'").get().total;
  const pendingPayments = db.prepare(`
    SELECT COALESCE(SUM(final_amount), 0) AS total FROM rentals WHERE payment_status IN ('pending', 'partial')
  `).get().total;

  const recentRentals = db.prepare(`
    SELECT r.id, r.invoice_number, c.full_name AS customer_name, e.name AS equipment_name, r.rental_status AS status, r.final_amount AS amount
    FROM rentals r
    JOIN customers c ON c.id = r.customer_id
    JOIN equipment e ON e.id = r.equipment_id
    ORDER BY r.id DESC LIMIT 5
  `).all();

  const recentPayments = db.prepare(`
    SELECT p.id, r.invoice_number, c.full_name AS customer_name, p.amount, p.payment_type, p.payment_date
    FROM payments p
    JOIN rentals r ON r.id = p.rental_id
    JOIN customers c ON c.id = r.customer_id
    ORDER BY p.id DESC LIMIT 5
  `).all();

  const revenueByMonth = db.prepare(`
    SELECT strftime('%Y-%m', payment_date) AS month, SUM(amount) AS total
    FROM payments
    WHERE payment_type != 'refund' AND payment_date >= date('now', '-6 months')
    GROUP BY month ORDER BY month ASC
  `).all();

  res.json({
    success: true,
    data: {
      totalCustomers,
      availableEquipment,
      activeRentals,
      overdueRentals,
      totalRevenue,
      pendingPayments,
      recentRentals,
      recentPayments,
      revenueByMonth,
    },
  });
});

module.exports = router;
