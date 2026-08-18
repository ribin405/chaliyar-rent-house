const { db } = require('../config/database');

// One invoice can cover several equipment items (several `rentals` rows sharing
// one invoice_number), and a customer typically pays for the whole invoice in
// one go — so payment_status is derived per invoice, not per line item, and
// applied uniformly across every rental row that belongs to it. Deposit and
// refund payments are a separate, refundable money flow and never count here,
// otherwise handing over a security deposit alone would look like "paid rent".
//
// `executor` defaults to the top-level db client, but callers running inside a
// libSQL interactive transaction should pass that transaction object instead
// (it exposes the same `.execute()` signature), so these writes stay atomic
// with the rest of the transaction.
async function recomputeForInvoice(invoiceNumber, executor = db) {
  const itemsResult = await executor.execute({
    sql: 'SELECT id, final_amount FROM rentals WHERE invoice_number = ?',
    args: [invoiceNumber],
  });
  if (!itemsResult.rows.length) return;

  const totalOwed = itemsResult.rows.reduce((sum, item) => sum + item.final_amount, 0);

  const totalsResult = await executor.execute({
    sql: `
      SELECT
        COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN amount ELSE 0 END), 0) AS paidRent,
        COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN discount ELSE 0 END), 0) AS discountTotal
      FROM payments WHERE invoice_number = ?
    `,
    args: [invoiceNumber],
  });
  const totals = totalsResult.rows[0];

  const settled = totals.paidRent + totals.discountTotal;
  let status = 'pending';
  if (totalOwed > 0 && settled >= totalOwed) {
    status = 'paid';
  } else if (settled > 0) {
    status = 'partial';
  }

  await executor.execute({
    sql: 'UPDATE rentals SET payment_status = ? WHERE invoice_number = ?',
    args: [status, invoiceNumber],
  });
}

// Convenience wrapper for call sites that only have a single rental row's id.
async function recomputeForRental(rentalId, executor = db) {
  const result = await executor.execute({ sql: 'SELECT invoice_number FROM rentals WHERE id = ?', args: [rentalId] });
  const rental = result.rows[0];
  if (!rental) return;
  await recomputeForInvoice(rental.invoice_number, executor);
}

module.exports = { recomputeForInvoice, recomputeForRental };
