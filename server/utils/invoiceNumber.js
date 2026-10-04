// Invoice numbers are the shop's prefix plus a 5-digit running number
// (INV-00001, INV-00002, …), issued from the invoice_number_seq Postgres
// sequence so two rentals created at the same moment never share a number.

const DEFAULT_PREFIX = 'INV';
const DIGITS = 5;

const formatInvoiceNumber = (prefix, sequenceValue) => `${prefix || DEFAULT_PREFIX}-${String(sequenceValue).padStart(DIGITS, '0')}`;

// Pass the transaction when creating a rental, so a rolled-back create doesn't
// leave a half-issued number behind (Postgres sequences can still skip a value
// then — gaps are possible, duplicates are not).
async function nextInvoiceNumber(executor) {
  const sequenceResult = await executor.execute("SELECT nextval('invoice_number_seq') AS value");
  const settingsResult = await executor.execute('SELECT invoice_prefix FROM shop_settings ORDER BY id LIMIT 1');
  return formatInvoiceNumber(settingsResult.rows[0]?.invoice_prefix, Number(sequenceResult.rows[0].value));
}

module.exports = { DEFAULT_PREFIX, formatInvoiceNumber, nextInvoiceNumber };
