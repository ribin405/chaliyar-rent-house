const express = require('express');
const ExcelJS = require('exceljs');

const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireRole('owner'));

router.get('/revenue', async (req, res) => {
  const { from, to } = req.query;
  const clauses = ["payment_type != 'refund'"];
  const params = [];
  if (from) {
    clauses.push('payment_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('payment_date <= ?');
    params.push(to);
  }

  const [byDateResult, summaryResult] = await Promise.all([
    db.execute({
      sql: `SELECT payment_date, SUM(amount) AS total
            FROM payments
            WHERE ${clauses.join(' AND ')}
            GROUP BY payment_date ORDER BY payment_date ASC`,
      args: params,
    }),
    db.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
            FROM payments WHERE ${clauses.join(' AND ')}`,
      args: params,
    }),
  ]);

  res.json({ success: true, data: { byDate: byDateResult.rows, total: summaryResult.rows[0].total, count: summaryResult.rows[0].count } });
});

router.get('/rentals/export', async (req, res) => {
  const result = await db.execute(`
    SELECT r.invoice_number, c.full_name AS customer_name, e.name AS equipment_name,
           r.rental_date, r.rental_time, r.expected_return_date, r.expected_return_time,
           r.actual_return_date, r.actual_return_time, r.rental_days, r.daily_rate, r.deposit, r.total_rent, r.late_fee, r.damage_charge,
           r.final_amount, r.payment_status, r.rental_status
    FROM rentals r
    JOIN customers c ON c.id = r.customer_id
    JOIN equipment e ON e.id = r.equipment_id
    ORDER BY r.id DESC
  `);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rentals');

  sheet.columns = [
    { header: 'Invoice #', key: 'invoice_number', width: 18 },
    { header: 'Customer', key: 'customer_name', width: 22 },
    { header: 'Equipment', key: 'equipment_name', width: 22 },
    { header: 'Rental Date', key: 'rental_date', width: 18 },
    { header: 'Expected Return', key: 'expected_return_date', width: 18 },
    { header: 'Actual Return', key: 'actual_return_date', width: 18 },
    { header: 'Days', key: 'rental_days', width: 8 },
    { header: 'Daily Rate', key: 'daily_rate', width: 12 },
    { header: 'Deposit', key: 'deposit', width: 12 },
    { header: 'Total Rent', key: 'total_rent', width: 12 },
    { header: 'Late Fee', key: 'late_fee', width: 12 },
    { header: 'Damage Charge', key: 'damage_charge', width: 14 },
    { header: 'Final Amount', key: 'final_amount', width: 14 },
    { header: 'Payment Status', key: 'payment_status', width: 16 },
    { header: 'Rental Status', key: 'rental_status', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  result.rows.forEach((row) => sheet.addRow({
    ...row,
    rental_date: `${row.rental_date} ${row.rental_time}`,
    expected_return_date: `${row.expected_return_date} ${row.expected_return_time}`,
    actual_return_date: row.actual_return_date ? `${row.actual_return_date} ${row.actual_return_time}` : '',
  }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="rentals-report.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
