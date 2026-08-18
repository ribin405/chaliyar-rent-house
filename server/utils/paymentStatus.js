const db = require('../config/database');

// One invoice can cover several equipment items (several `rentals` rows sharing
// one invoice_number), and a customer typically pays for the whole invoice in
// one go — so payment_status is derived per invoice, not per line item, and
// applied uniformly across every rental row that belongs to it. Deposit and
// refund payments are a separate, refundable money flow and never count here,
// otherwise handing over a security deposit alone would look like "paid rent".
function recomputeForInvoice(invoiceNumber) {
  const items = db.prepare('SELECT id, final_amount FROM rentals WHERE invoice_number = ?').all(invoiceNumber);
  if (!items.length) return;

  const totalOwed = items.reduce((sum, item) => sum + item.final_amount, 0);

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN amount ELSE 0 END), 0) AS paidRent,
      COALESCE(SUM(CASE WHEN payment_type = 'rent' THEN discount ELSE 0 END), 0) AS discountTotal
    FROM payments WHERE invoice_number = ?
  `).get(invoiceNumber);

  const settled = totals.paidRent + totals.discountTotal;
  let status = 'pending';
  if (totalOwed > 0 && settled >= totalOwed) {
    status = 'paid';
  } else if (settled > 0) {
    status = 'partial';
  }

  db.prepare('UPDATE rentals SET payment_status = ? WHERE invoice_number = ?').run(status, invoiceNumber);
}

// Convenience wrapper for call sites that only have a single rental row's id.
function recomputeForRental(rentalId) {
  const rental = db.prepare('SELECT invoice_number FROM rentals WHERE id = ?').get(rentalId);
  if (!rental) return;
  recomputeForInvoice(rental.invoice_number);
}

module.exports = { recomputeForInvoice, recomputeForRental };
