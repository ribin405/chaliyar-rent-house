const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db, ready } = require('../config/database');
const { recomputeForInvoice } = require('../utils/paymentStatus');

async function insertPayment(rentalId, inv, amount, discount, type) {
  const now = new Date();
  const tx = await db.transaction('write');
  try {
    await tx.execute({
      sql: 'INSERT INTO payments (rental_id, invoice_number, amount, discount, payment_method, payment_type, payment_date, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      args: [rentalId, inv, amount, discount, 'cash', type, now.toISOString().slice(0, 10), '', null, now.toISOString()],
    });
    await recomputeForInvoice(inv, tx);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

(async () => {
  await ready();
  const now = new Date();
  const cust = await db.execute({
    sql: "INSERT INTO customers (full_name, phone_number, alternate_phone, address, registration_date, registration_time, status, notes, is_deleted, created_at, updated_at) VALUES ('DebugCust2','9999999998','','', '2026-01-01','10:00','active','',0,?,?) RETURNING id",
    args: [now.toISOString(), now.toISOString()],
  });
  const custId = cust.rows[0].id;
  const equip = await db.execute({
    sql: "INSERT INTO equipment (name, category_id, daily_rent, security_deposit, current_status, current_location, notes, is_deleted, created_at, updated_at) VALUES ('DebugEquip2', NULL, 500, 1000, 'available', '', '', 0, ?, ?) RETURNING id",
    args: [now.toISOString(), now.toISOString()],
  });
  const equipId = equip.rows[0].id;
  const inv = 'DEBUG2-' + Date.now();
  const rental = await db.execute({
    sql: "INSERT INTO rentals (invoice_number, customer_id, equipment_id, rental_date, rental_time, expected_return_date, expected_return_time, rental_days, daily_rate, deposit, total_rent, final_amount, payment_status, rental_status, created_by, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01','10:00','2026-01-01','10:00',1,500,1000,500,500,'pending','active',NULL,?,?) RETURNING id",
    args: [inv, custId, equipId, now.toISOString(), now.toISOString()],
  });
  const rentalId = rental.rows[0].id;
  console.log('rental id', rentalId, 'invoice', inv);

  const getStatus = async () => {
    const r = await db.execute({ sql: 'SELECT payment_status FROM rentals WHERE id = ?', args: [rentalId] });
    return r.rows[0].payment_status;
  };

  await insertPayment(rentalId, inv, 1000, 0, 'deposit');
  console.log('after deposit:', await getStatus());

  await insertPayment(rentalId, inv, 300, 0, 'rent');
  console.log('after partial rent:', await getStatus());

  await insertPayment(rentalId, inv, 0, 200, 'rent');
  console.log('after discount:', await getStatus());

  const allPayments = await db.execute({ sql: 'SELECT amount, discount, payment_type FROM payments WHERE invoice_number = ?', args: [inv] });
  console.log('all payment rows:', allPayments.rows);

  process.exit(0);
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
