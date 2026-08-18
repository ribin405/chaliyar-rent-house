const express = require('express');
const Joi = require('joi');
const PDFDocument = require('pdfkit');

const { db } = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { recomputeForInvoice, recomputeForRental } = require('../utils/paymentStatus');

const router = express.Router();

// A single equipment-item edit (used by PUT, which always operates on one rental row).
const rentalSchema = Joi.object({
  customer_name: Joi.string().trim().required(),
  customer_phone: Joi.string().trim().required(),
  customer_address: Joi.string().trim().allow('').default(''),
  equipment_id: Joi.number().integer().positive().required(),
  rental_date: Joi.string().trim().required(),
  expected_return_date: Joi.string().trim().required(),
  expected_return_time: Joi.string().trim().allow('').default(''),
  rental_days: Joi.number().integer().min(1).default(1),
  daily_rate: Joi.number().min(0).required(),
  deposit: Joi.number().min(0).default(0),
});

// Rental creation accepts one or more equipment items sharing a single invoice
// (one customer renting several pieces of equipment at once).
const rentalItemSchema = Joi.object({
  equipment_id: Joi.number().integer().positive().required(),
  daily_rate: Joi.number().min(0).required(),
  deposit: Joi.number().min(0).default(0),
  rental_days: Joi.number().integer().min(1).default(1),
});

const createRentalSchema = Joi.object({
  customer_name: Joi.string().trim().required(),
  customer_phone: Joi.string().trim().required(),
  customer_address: Joi.string().trim().allow('').default(''),
  rental_date: Joi.string().trim().required(),
  expected_return_date: Joi.string().trim().required(),
  expected_return_time: Joi.string().trim().allow('').default(''),
  items: Joi.array().items(rentalItemSchema).min(1).required(),
});

// Customers are looked up (and created if needed) by phone number, which acts
// as the natural dedup key for rentals created by typing a name in directly.
// `executor` defaults to the top-level db client, but callers running inside a
// transaction should pass that transaction object so the write stays atomic.
const resolveCustomerByPhone = async (name, phone, address, executor = db) => {
  const trimmedPhone = phone.trim();
  const existingResult = await executor.execute({
    sql: 'SELECT id, full_name FROM customers WHERE phone_number = ? AND is_deleted = 0',
    args: [trimmedPhone],
  });
  const existing = existingResult.rows[0];
  const now = new Date();

  if (existing) {
    if (existing.full_name !== name || address) {
      await executor.execute({
        sql: `UPDATE customers SET full_name = ?, address = COALESCE(NULLIF(?, ''), address), updated_at = ? WHERE id = ?`,
        args: [name, address || '', now.toISOString(), existing.id],
      });
    }
    return existing.id;
  }

  const result = await executor.execute({
    sql: `INSERT INTO customers (full_name, phone_number, alternate_phone, address, registration_date, registration_time, status, notes, is_deleted, created_at, updated_at)
          VALUES (?, ?, '', ?, ?, ?, 'active', '', 0, ?, ?)`,
    args: [name, trimmedPhone, address || '', now.toISOString().slice(0, 10), now.toTimeString().slice(0, 5), now.toISOString(), now.toISOString()],
  });
  return Number(result.lastInsertRowid);
};

const returnSchema = Joi.object({
  actual_return_date: Joi.string().trim().required(),
  damage_charge: Joi.number().min(0).default(0),
  return_notes: Joi.string().trim().allow('').default(''),
});

const RENTAL_LIST_SELECT = `
  SELECT r.id, r.invoice_number, r.customer_id, c.full_name AS customer_name, c.phone_number AS customer_phone, c.address AS customer_address,
         r.equipment_id, e.name AS equipment_name,
         r.rental_date, r.rental_time, r.expected_return_date, r.expected_return_time,
         r.actual_return_date, r.actual_return_time, r.rental_days, r.daily_rate, r.deposit,
         r.total_rent, r.late_fee, r.damage_charge, r.refund_amount, r.final_amount,
         r.payment_status, r.rental_status AS status, r.return_notes
  FROM rentals r
  JOIN customers c ON c.id = r.customer_id
  JOIN equipment e ON e.id = r.equipment_id
`;

router.use(authenticate);

// Lazily flip any active rental past its expected return date to "overdue".
const refreshOverdueStatuses = async () => {
  await db.execute(`
    UPDATE rentals SET rental_status = 'overdue'
    WHERE rental_status = 'active' AND date(expected_return_date) < date('now')
  `);
};

router.get('/', async (req, res) => {
  await refreshOverdueStatuses();
  const result = await db.execute(`${RENTAL_LIST_SELECT} ORDER BY r.id DESC`);
  res.json({ success: true, data: result.rows.map((row) => ({ ...row, amount: row.final_amount })) });
});

router.get('/:id', async (req, res) => {
  await refreshOverdueStatuses();
  const result = await db.execute({ sql: `${RENTAL_LIST_SELECT} WHERE r.id = ?`, args: [req.params.id] });
  const row = result.rows[0];
  if (!row) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }
  res.json({ success: true, data: row });
});

router.post('/', validate(createRentalSchema), async (req, res) => {
  const value = req.body;

  const equipmentIds = value.items.map((item) => item.equipment_id);
  if (new Set(equipmentIds).size !== equipmentIds.length) {
    return res.status(400).json({ success: false, message: 'Each equipment item can only be added once per rental.' });
  }

  for (const item of value.items) {
    const equipmentResult = await db.execute({
      sql: 'SELECT id, current_status, name FROM equipment WHERE id = ? AND is_deleted = 0',
      args: [item.equipment_id],
    });
    const equipmentRow = equipmentResult.rows[0];
    if (!equipmentRow) {
      return res.status(404).json({ success: false, message: `Equipment #${item.equipment_id} not found` });
    }
    if (equipmentRow.current_status !== 'available') {
      return res.status(409).json({ success: false, message: `${equipmentRow.name} is not available for rent` });
    }
  }

  const invoiceNumber = `INV-${Date.now()}`;
  const now = new Date();
  const registeredTime = now.toTimeString().slice(0, 5);
  const expectedReturnTime = value.expected_return_time || registeredTime;

  const tx = await db.transaction('write');
  let ids;
  try {
    const customerId = await resolveCustomerByPhone(value.customer_name, value.customer_phone, value.customer_address, tx);
    ids = [];
    for (const item of value.items) {
      const totalRent = item.daily_rate * item.rental_days;
      const result = await tx.execute({
        sql: `INSERT INTO rentals (invoice_number, customer_id, equipment_id, rental_date, rental_time, expected_return_date, expected_return_time, rental_days, daily_rate, deposit, total_rent, final_amount, payment_status, rental_status, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'active', ?, ?, ?)`,
        args: [invoiceNumber, customerId, item.equipment_id, value.rental_date, registeredTime, value.expected_return_date, expectedReturnTime, item.rental_days, item.daily_rate, item.deposit, totalRent, totalRent, req.user.id, now.toISOString(), now.toISOString()],
      });
      await tx.execute({
        sql: "UPDATE equipment SET current_status = 'rented', updated_at = ? WHERE id = ?",
        args: [now.toISOString(), item.equipment_id],
      });
      ids.push(Number(result.lastInsertRowid));
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  res.status(201).json({ success: true, data: { ids, id: ids[0], invoice_number: invoiceNumber } });
});

router.put('/:id', validate(rentalSchema), async (req, res) => {
  const value = req.body;

  const existingResult = await db.execute({ sql: 'SELECT equipment_id, rental_status FROM rentals WHERE id = ?', args: [req.params.id] });
  const existing = existingResult.rows[0];
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }

  const isOpen = existing.rental_status === 'active' || existing.rental_status === 'overdue';
  const equipmentChanged = existing.equipment_id !== value.equipment_id;

  // Swapping which equipment a rental covers must keep equipment.current_status
  // in sync, or the old item gets stuck "rented" forever and the new one stays
  // "available" while it's actually checked out — a double-booking waiting to happen.
  if (equipmentChanged) {
    const newEquipmentResult = await db.execute({
      sql: 'SELECT id, current_status, name FROM equipment WHERE id = ? AND is_deleted = 0',
      args: [value.equipment_id],
    });
    const newEquipment = newEquipmentResult.rows[0];
    if (!newEquipment) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }
    if (isOpen && newEquipment.current_status !== 'available') {
      return res.status(409).json({ success: false, message: `${newEquipment.name} is not available for rent` });
    }
  }

  const totalRent = value.daily_rate * value.rental_days;
  const expectedReturnTime = value.expected_return_time || new Date().toTimeString().slice(0, 5);
  const now = new Date().toISOString();

  const tx = await db.transaction('write');
  let rowsAffected;
  try {
    const customerId = await resolveCustomerByPhone(value.customer_name, value.customer_phone, value.customer_address, tx);
    const runResult = await tx.execute({
      sql: `UPDATE rentals SET customer_id = ?, equipment_id = ?, rental_date = ?, expected_return_date = ?, expected_return_time = ?, rental_days = ?, daily_rate = ?, deposit = ?, total_rent = ?, final_amount = ? + late_fee + damage_charge, updated_at = ?
            WHERE id = ?`,
      args: [customerId, value.equipment_id, value.rental_date, value.expected_return_date, expectedReturnTime, value.rental_days, value.daily_rate, value.deposit, totalRent, totalRent, now, req.params.id],
    });
    rowsAffected = runResult.rowsAffected;

    if (equipmentChanged && isOpen) {
      await tx.execute({ sql: "UPDATE equipment SET current_status = 'available', updated_at = ? WHERE id = ?", args: [now, existing.equipment_id] });
      await tx.execute({ sql: "UPDATE equipment SET current_status = 'rented', updated_at = ? WHERE id = ?", args: [now, value.equipment_id] });
    }

    await recomputeForRental(req.params.id, tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  if (!rowsAffected) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }
  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.delete('/:id', async (req, res) => {
  const rentalResult = await db.execute({ sql: 'SELECT equipment_id, rental_status, invoice_number FROM rentals WHERE id = ?', args: [req.params.id] });
  const rental = rentalResult.rows[0];
  if (!rental) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }

  const tx = await db.transaction('write');
  try {
    await tx.execute({ sql: 'DELETE FROM rentals WHERE id = ?', args: [req.params.id] });
    if (rental.rental_status === 'active' || rental.rental_status === 'overdue') {
      await tx.execute({ sql: "UPDATE equipment SET current_status = 'available', updated_at = ? WHERE id = ?", args: [new Date().toISOString(), rental.equipment_id] });
    }
    // Removing one item changes the invoice's total owed, so the remaining
    // items' shared payment_status needs to be re-derived (if any remain).
    await recomputeForInvoice(rental.invoice_number, tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  res.json({ success: true, data: { id: Number(req.params.id) } });
});

router.post('/:id/return', validate(returnSchema), async (req, res) => {
  const { actual_return_date: actualReturnDate, damage_charge: damageCharge, return_notes: returnNotes } = req.body;

  const rentalResult = await db.execute({ sql: 'SELECT * FROM rentals WHERE id = ?', args: [req.params.id] });
  const rental = rentalResult.rows[0];
  if (!rental) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }
  if (rental.rental_status === 'completed' || rental.rental_status === 'cancelled') {
    return res.status(409).json({ success: false, message: 'This rental has already been closed' });
  }

  const expected = new Date(rental.expected_return_date);
  const actual = new Date(actualReturnDate);
  const overdueDays = Math.max(0, Math.ceil((actual - expected) / (1000 * 60 * 60 * 24)));
  const lateFee = overdueDays * rental.daily_rate;
  const refundAmount = Math.max(0, rental.deposit - damageCharge);
  const finalAmount = rental.total_rent + lateFee + damageCharge;
  const now = new Date();

  const tx = await db.transaction('write');
  try {
    await tx.execute({
      sql: `UPDATE rentals SET actual_return_date = ?, actual_return_time = ?, late_fee = ?, damage_charge = ?, refund_amount = ?, final_amount = ?, return_notes = ?, rental_status = 'completed', updated_at = ?
            WHERE id = ?`,
      args: [actualReturnDate, now.toTimeString().slice(0, 5), lateFee, damageCharge, refundAmount, finalAmount, returnNotes || '', now.toISOString(), req.params.id],
    });
    await tx.execute({ sql: "UPDATE equipment SET current_status = 'available', updated_at = ? WHERE id = ?", args: [now.toISOString(), rental.equipment_id] });
    // final_amount just changed (late fee/damage charge), so re-derive payment_status
    // for the whole invoice against the new amount owed instead of leaving a stale
    // "paid" from before.
    await recomputeForRental(req.params.id, tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  res.json({ success: true, data: { id: Number(req.params.id), late_fee: lateFee, damage_charge: damageCharge, refund_amount: refundAmount, final_amount: finalAmount } });
});

router.get('/:id/invoice', async (req, res) => {
  const anchorResult = await db.execute({ sql: `${RENTAL_LIST_SELECT} WHERE r.id = ?`, args: [req.params.id] });
  const anchor = anchorResult.rows[0];
  if (!anchor) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }

  // A single invoice can cover several equipment items rented together.
  const [itemsResult, shopResult, paymentTotalsResult] = await Promise.all([
    db.execute({ sql: `${RENTAL_LIST_SELECT} WHERE r.invoice_number = ? ORDER BY r.id ASC`, args: [anchor.invoice_number] }),
    db.execute('SELECT * FROM shop_settings WHERE id = 1'),
    db.execute({
      sql: `SELECT
              COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN amount ELSE 0 END), 0) AS paidRent,
              COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN discount ELSE 0 END), 0) AS discountTotal
            FROM payments WHERE invoice_number = ?`,
      args: [anchor.invoice_number],
    }),
  ]);
  const items = itemsResult.rows;
  const shop = shopResult.rows[0];
  const currency = shop?.currency_symbol || '₹';

  const totals = items.reduce((acc, item) => ({
    total_rent: acc.total_rent + item.total_rent,
    late_fee: acc.late_fee + item.late_fee,
    damage_charge: acc.damage_charge + item.damage_charge,
    deposit: acc.deposit + item.deposit,
    refund_amount: acc.refund_amount + item.refund_amount,
    final_amount: acc.final_amount + item.final_amount,
  }), { total_rent: 0, late_fee: 0, damage_charge: 0, deposit: 0, refund_amount: 0, final_amount: 0 });

  const paymentTotals = paymentTotalsResult.rows[0];
  const amountSettled = paymentTotals.paidRent + paymentTotals.discountTotal;
  const balanceDue = Math.max(0, totals.final_amount - amountSettled);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${anchor.invoice_number}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).text(shop?.shop_name || 'Rental Invoice', { align: 'left' });
  doc.fontSize(10).fillColor('#555').text(shop?.shop_address || '');
  doc.text(shop?.shop_phone || '');
  doc.moveDown();
  doc.fillColor('#000').fontSize(14).text(`Invoice ${anchor.invoice_number}`);
  doc.fontSize(10).text(`Rental Date: ${anchor.rental_date} ${anchor.rental_time}`);
  doc.fontSize(10).text(`Expected Return: ${anchor.expected_return_date} ${anchor.expected_return_time}`);
  doc.moveDown();

  doc.fontSize(12).text('Bill To');
  doc.fontSize(10).text(anchor.customer_name);
  doc.moveDown();

  doc.fontSize(12).text(items.length > 1 ? `Equipment (${items.length} items)` : 'Equipment');
  items.forEach((item) => {
    doc.fontSize(10).text(
      `${item.equipment_name} — ${item.rental_days} day(s) x ${currency}${item.daily_rate} = ${currency}${item.total_rent}`
      + (item.actual_return_date ? ` (returned ${item.actual_return_date} ${item.actual_return_time})` : ` (${item.status})`),
    );
  });
  doc.moveDown();

  const rows = [
    ['Total Rent', `${currency} ${totals.total_rent}`],
    ['Late Fee', `${currency} ${totals.late_fee}`],
    ['Damage Charge', `${currency} ${totals.damage_charge}`],
    ['Deposit', `${currency} ${totals.deposit}`],
    ['Refund Amount', `${currency} ${totals.refund_amount}`],
    ['Final Amount', `${currency} ${totals.final_amount}`],
    ['Amount Settled', `${currency} ${amountSettled}`],
    ['Balance Due', `${currency} ${balanceDue}`],
    ['Payment Status', anchor.payment_status],
  ];

  rows.forEach(([label, value]) => {
    doc.fontSize(10).text(`${label}: ${value}`);
  });

  doc.end();
});

module.exports = router;
