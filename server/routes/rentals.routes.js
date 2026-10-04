const express = require('express');
const Joi = require('joi');
const PDFDocument = require('pdfkit');

const { db } = require('../config/database');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { recomputeForInvoice, recomputeForRental } = require('../utils/paymentStatus');
const { nextInvoiceNumber } = require('../utils/invoiceNumber');
const { reserveUnits, syncEquipmentStatus } = require('../utils/stock');

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// Every calendar day the equipment is out counts as a full day, both ends
// included: out and back on the same day = 1 day, back the next day = 2 days.
// Dates are plain YYYY-MM-DD strings, so the difference is whole days.
const calendarDays = (fromDate, toDate) => Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS) + 1;

const RETURN_BEFORE_RENTAL = 'The return date cannot be before the rental date.';

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
  quantity: Joi.number().integer().min(1).default(1),
  daily_rate: Joi.number().min(0).required(),
  deposit: Joi.number().min(0).default(0),
  // Only applied to items that have already been returned.
  actual_return_date: Joi.string().trim().allow(''),
  damage_charge: Joi.number().min(0),
  return_notes: Joi.string().trim().allow(''),
});

// Rental creation accepts one or more equipment lines sharing a single invoice
// (one customer renting several pieces of equipment at once), each taking some
// quantity of identical units. daily_rate is per unit; deposit is the line total.
const rentalItemSchema = Joi.object({
  equipment_id: Joi.number().integer().positive().required(),
  quantity: Joi.number().integer().min(1).default(1),
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
          VALUES (?, ?, '', ?, ?, ?, 'active', '', 0, ?, ?) RETURNING id`,
    args: [name, trimmedPhone, address || '', now.toISOString().slice(0, 10), now.toTimeString().slice(0, 5), now.toISOString(), now.toISOString()],
  });
  return Number(result.lastInsertRowid);
};

const returnSchema = Joi.object({
  actual_return_date: Joi.string().trim().required(),
  damage_charge: Joi.number().min(0).default(0),
  return_notes: Joi.string().trim().allow('').default(''),
});

const returnBatchSchema = Joi.object({
  actual_return_date: Joi.string().trim().required(),
  return_notes: Joi.string().trim().allow('').default(''),
  items: Joi.array().items(Joi.object({
    id: Joi.number().integer().positive().required(),
    damage_charge: Joi.number().min(0).default(0),
  })).min(1).unique('id').required(),
});

const RENTAL_LIST_SELECT = `
  SELECT r.id, r.invoice_number, r.customer_id, c.full_name AS customer_name, c.phone_number AS customer_phone, c.address AS customer_address,
         r.equipment_id, e.name AS equipment_name, r.quantity,
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
    WHERE rental_status = 'active' AND expected_return_date::date < CURRENT_DATE
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

  // Booked days follow from the dates, so they can never disagree with them.
  const rentalDays = calendarDays(value.rental_date, value.expected_return_date);
  if (!(rentalDays >= 1)) {
    return res.status(400).json({ success: false, message: RETURN_BEFORE_RENTAL });
  }

  const equipmentIds = value.items.map((item) => item.equipment_id);
  if (new Set(equipmentIds).size !== equipmentIds.length) {
    return res.status(400).json({ success: false, message: 'Each equipment item can only be added once per rental.' });
  }

  const now = new Date();
  const registeredTime = now.toTimeString().slice(0, 5);
  const expectedReturnTime = value.expected_return_time || registeredTime;

  const tx = await db.transaction('write');
  let ids;
  let invoiceNumber;
  try {
    for (const item of value.items) {
      await reserveUnits(item.equipment_id, item.quantity, tx);
    }
    invoiceNumber = await nextInvoiceNumber(tx);
    const customerId = await resolveCustomerByPhone(value.customer_name, value.customer_phone, value.customer_address, tx);
    ids = [];
    for (const item of value.items) {
      const totalRent = item.daily_rate * item.quantity * rentalDays;
      const result = await tx.execute({
        sql: `INSERT INTO rentals (invoice_number, customer_id, equipment_id, quantity, rental_date, rental_time, expected_return_date, expected_return_time, rental_days, daily_rate, deposit, total_rent, final_amount, payment_status, rental_status, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'active', ?, ?, ?) RETURNING id`,
        args: [invoiceNumber, customerId, item.equipment_id, item.quantity, value.rental_date, registeredTime, value.expected_return_date, expectedReturnTime, rentalDays, item.daily_rate, item.deposit, totalRent, totalRent, req.user.id, now.toISOString(), now.toISOString()],
      });
      ids.push(Number(result.lastInsertRowid));
    }
    await syncEquipmentStatus(equipmentIds, tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  res.status(201).json({ success: true, data: { ids, id: ids[0], invoice_number: invoiceNumber } });
});

// Charges for an item coming back on `actualReturnDate`: every day used is billed
// at the daily rate. Days past the expected return are reported as the late fee
// (part of that count, never on top of it); an early return pays only the days
// used. Damage comes out of the deposit. Shared by the return routes and by
// edits to an already-returned item, so all three always charge the same way.
const computeReturnCharges = (rental, actualReturnDate, damageCharge) => {
  const usedDays = Math.max(1, calendarDays(rental.rental_date, actualReturnDate));
  const daysPastExpected = Math.max(0, calendarDays(rental.expected_return_date, actualReturnDate) - 1);
  const lateDays = Math.min(daysPastExpected, usedDays - 1);
  const rentalDays = usedDays - lateDays;
  const lineRate = rental.daily_rate * (rental.quantity || 1);
  return {
    rentalDays,
    totalRent: rentalDays * lineRate,
    lateDays,
    lateFee: lateDays * lineRate,
    refundAmount: Math.max(0, rental.deposit - damageCharge),
    finalAmount: usedDays * lineRate + damageCharge,
  };
};

const returnsBeforeRental = (rental, actualReturnDate) => calendarDays(rental.rental_date, actualReturnDate) < 1;

router.put('/:id', validate(rentalSchema), async (req, res) => {
  const value = req.body;

  const existingResult = await db.execute({
    sql: 'SELECT equipment_id, quantity, rental_status, actual_return_date, damage_charge, return_notes FROM rentals WHERE id = ?',
    args: [req.params.id],
  });
  const existing = existingResult.rows[0];
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }

  const isOpen = existing.rental_status === 'active' || existing.rental_status === 'overdue';
  const isReturned = existing.rental_status === 'completed';
  const equipmentChanged = existing.equipment_id !== value.equipment_id;
  const quantityChanged = existing.quantity !== value.quantity;

  if (equipmentChanged) {
    const newEquipmentResult = await db.execute({
      sql: 'SELECT id FROM equipment WHERE id = ? AND is_deleted = 0',
      args: [value.equipment_id],
    });
    if (!newEquipmentResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }
  }

  const rentalDays = calendarDays(value.rental_date, value.expected_return_date);
  if (!(rentalDays >= 1)) {
    return res.status(400).json({ success: false, message: RETURN_BEFORE_RENTAL });
  }
  const actualReturnDate = isReturned ? (value.actual_return_date || existing.actual_return_date) : null;
  if (isReturned && !(calendarDays(value.rental_date, actualReturnDate) >= 1)) {
    return res.status(400).json({ success: false, message: RETURN_BEFORE_RENTAL });
  }

  const totalRent = value.daily_rate * value.quantity * rentalDays;
  const expectedReturnTime = value.expected_return_time || new Date().toTimeString().slice(0, 5);
  const now = new Date().toISOString();

  const tx = await db.transaction('write');
  let rowsAffected;
  try {
    // Swapping the equipment or taking more units of it must still fit in stock
    // (this line's own units don't count against it), or it's a double-booking.
    if (isOpen && (equipmentChanged || quantityChanged)) {
      await reserveUnits(value.equipment_id, value.quantity, tx, req.params.id);
    }
    const customerId = await resolveCustomerByPhone(value.customer_name, value.customer_phone, value.customer_address, tx);
    const runResult = await tx.execute({
      sql: `UPDATE rentals SET customer_id = ?, equipment_id = ?, quantity = ?, rental_date = ?, expected_return_date = ?, expected_return_time = ?, rental_days = ?, daily_rate = ?, deposit = ?, total_rent = ?, final_amount = ? + late_fee + damage_charge, updated_at = ?
            WHERE id = ?`,
      args: [customerId, value.equipment_id, value.quantity, value.rental_date, value.expected_return_date, expectedReturnTime, rentalDays, value.daily_rate, value.deposit, totalRent, totalRent, now, req.params.id],
    });
    rowsAffected = runResult.rowsAffected;

    // A returned item's charges depend on its dates, rate and deposit, so any
    // edit re-derives them — along with corrections to the return itself.
    if (isReturned) {
      const damageCharge = value.damage_charge ?? existing.damage_charge;
      const returnNotes = value.return_notes ?? existing.return_notes ?? '';
      const charges = computeReturnCharges(
        {
          rental_date: value.rental_date, expected_return_date: value.expected_return_date, daily_rate: value.daily_rate, quantity: value.quantity, deposit: value.deposit,
        },
        actualReturnDate,
        damageCharge,
      );
      await tx.execute({
        sql: `UPDATE rentals SET actual_return_date = ?, rental_days = ?, total_rent = ?, late_fee = ?, damage_charge = ?, refund_amount = ?, final_amount = ?, return_notes = ?
              WHERE id = ?`,
        args: [actualReturnDate, charges.rentalDays, charges.totalRent, charges.lateFee, damageCharge, charges.refundAmount, charges.finalAmount, returnNotes, req.params.id],
      });
    }

    if (isOpen && (equipmentChanged || quantityChanged)) {
      await syncEquipmentStatus([existing.equipment_id, value.equipment_id], tx);
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
      await syncEquipmentStatus([rental.equipment_id], tx);
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

// Closes out one rental item: stamps the return, applies late fee / damage
// charge, and frees the equipment. Shared by the single and batch return routes
// so both always calculate identically. Caller owns the transaction and must
// re-derive the invoice payment status afterwards.
const applyReturn = async (rental, { actualReturnDate, damageCharge, returnNotes }, tx) => {
  const {
    rentalDays, totalRent, lateFee, refundAmount, finalAmount,
  } = computeReturnCharges(rental, actualReturnDate, damageCharge);
  const now = new Date();

  await tx.execute({
    sql: `UPDATE rentals SET actual_return_date = ?, actual_return_time = ?, rental_days = ?, total_rent = ?, late_fee = ?, damage_charge = ?, refund_amount = ?, final_amount = ?, return_notes = ?, rental_status = 'completed', updated_at = ?
          WHERE id = ?`,
    args: [actualReturnDate, now.toTimeString().slice(0, 5), rentalDays, totalRent, lateFee, damageCharge, refundAmount, finalAmount, returnNotes || '', now.toISOString(), rental.id],
  });
  await syncEquipmentStatus([rental.equipment_id], tx);

  return { id: Number(rental.id), late_fee: lateFee, damage_charge: damageCharge, refund_amount: refundAmount, final_amount: finalAmount };
};

const isClosed = (rental) => rental.rental_status === 'completed' || rental.rental_status === 'cancelled';

router.post('/:id/return', validate(returnSchema), async (req, res) => {
  const { actual_return_date: actualReturnDate, damage_charge: damageCharge, return_notes: returnNotes } = req.body;

  const rentalResult = await db.execute({ sql: 'SELECT * FROM rentals WHERE id = ?', args: [req.params.id] });
  const rental = rentalResult.rows[0];
  if (!rental) {
    return res.status(404).json({ success: false, message: 'Rental not found' });
  }
  if (isClosed(rental)) {
    return res.status(409).json({ success: false, message: 'This rental has already been closed' });
  }
  if (returnsBeforeRental(rental, actualReturnDate)) {
    return res.status(400).json({ success: false, message: RETURN_BEFORE_RENTAL });
  }

  const tx = await db.transaction('write');
  let result;
  try {
    result = await applyReturn(rental, { actualReturnDate, damageCharge, returnNotes }, tx);
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

  res.json({ success: true, data: result });
});

// Returns several items of the same invoice in one go — all or nothing, so a
// failure part-way never leaves the invoice half-returned.
router.post('/return-batch', validate(returnBatchSchema), async (req, res) => {
  const { actual_return_date: actualReturnDate, return_notes: returnNotes, items } = req.body;
  const ids = items.map((item) => item.id);

  const rentalResult = await db.execute({
    sql: `SELECT * FROM rentals WHERE id IN (${ids.map(() => '?').join(', ')})`,
    args: ids,
  });
  const rentalsById = new Map(rentalResult.rows.map((row) => [Number(row.id), row]));

  const missing = ids.filter((id) => !rentalsById.has(id));
  if (missing.length) {
    return res.status(404).json({ success: false, message: `Rental item(s) not found: ${missing.join(', ')}` });
  }
  const invoiceNumbers = new Set(rentalResult.rows.map((row) => row.invoice_number));
  if (invoiceNumbers.size > 1) {
    return res.status(400).json({ success: false, message: 'All items in a batch return must belong to the same invoice' });
  }
  if (rentalResult.rows.some((row) => returnsBeforeRental(row, actualReturnDate))) {
    return res.status(400).json({ success: false, message: RETURN_BEFORE_RENTAL });
  }
  const closed = rentalResult.rows.filter(isClosed);
  if (closed.length) {
    return res.status(409).json({ success: false, message: `Already closed: ${closed.map((row) => row.id).join(', ')}` });
  }

  const tx = await db.transaction('write');
  const results = [];
  try {
    for (const item of items) {
      results.push(await applyReturn(rentalsById.get(item.id), { actualReturnDate, damageCharge: item.damage_charge, returnNotes }, tx));
    }
    await recomputeForInvoice([...invoiceNumbers][0], tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  res.json({ success: true, data: { items: results } });
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
              COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN amount ELSE 0 END), 0) AS paid_rent,
              COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN discount ELSE 0 END), 0) AS discount_total
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
  const amountSettled = paymentTotals.paid_rent + paymentTotals.discount_total;
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
      `${item.equipment_name}${item.quantity > 1 ? ` x ${item.quantity}` : ''} — ${item.rental_days} day(s) x ${currency}${item.daily_rate}${item.quantity > 1 ? ' each' : ''} = ${currency}${item.total_rent}`
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
