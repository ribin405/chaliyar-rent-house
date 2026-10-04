const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Loaded here (not just inside the spawned app.js processes) so TEST_DATABASE_URL
// from the root .env is visible when building each child's env below — pointing
// tests at a separate Neon database instead of whatever DATABASE_URL points at.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const serverPath = path.join(__dirname, '..', 'app.js');

test('server exposes a health endpoint', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4101', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const response = await fetch('http://127.0.0.1:4101/api/health');
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.message, 'Server is running');

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('login returns a data envelope with the auth token', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4102', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const loginResponse = await fetch('http://127.0.0.1:4102/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginPayload = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(loginPayload.success, true);
  assert.ok(loginPayload.data?.token);
  assert.equal(loginPayload.data.user.username, 'admin');

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('creates a rental through the API', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4102', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const loginResponse = await fetch('http://127.0.0.1:4102/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginPayload = await loginResponse.json();
  assert.equal(loginResponse.status, 200);
  assert.equal(loginPayload.success, true);

  const token = loginPayload.token;
  const equipmentResponse = await fetch('http://127.0.0.1:4102/api/equipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Test Drill', daily_rent: 1000, security_deposit: 2000, status: 'available', location: 'Warehouse' })
  });
  const equipmentPayload = await equipmentResponse.json();
  assert.equal(equipmentResponse.status, 201);
  assert.equal(equipmentPayload.success, true);

  const equipment2Response = await fetch('http://127.0.0.1:4102/api/equipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Test Drill 2', daily_rent: 800, security_deposit: 1500, status: 'available', location: 'Warehouse' })
  });
  const equipment2Payload = await equipment2Response.json();

  // A single rental request can cover multiple equipment items under one invoice.
  const phone = `9${Date.now()}`.slice(0, 10);
  const rentalResponse = await fetch('http://127.0.0.1:4102/api/rentals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      customer_name: 'Nina',
      customer_phone: phone,
      rental_date: '2026-07-18',
      expected_return_date: '2026-07-20',
      items: [
        { equipment_id: equipmentPayload.data.id, daily_rate: 1000, deposit: 2000, rental_days: 2 },
        { equipment_id: equipment2Payload.data.id, daily_rate: 800, deposit: 1500, rental_days: 2 },
      ],
    })
  });
  const rentalPayload = await rentalResponse.json();
  assert.equal(rentalResponse.status, 201);
  assert.equal(rentalPayload.success, true);
  assert.equal(rentalPayload.data.ids.length, 2);

  const rentalsAfterCreate = await (await fetch('http://127.0.0.1:4102/api/rentals', { headers: { Authorization: `Bearer ${token}` } })).json();
  const invoiceRows = rentalsAfterCreate.data.filter((r) => r.invoice_number === rentalPayload.data.invoice_number);
  assert.equal(invoiceRows.length, 2);
  assert.deepEqual(invoiceRows.map((r) => r.equipment_name).sort(), ['Test Drill', 'Test Drill 2']);

  // Typing the same phone number again should reuse the existing customer record
  // (and refresh their name) instead of creating a duplicate.
  const equipment3Response = await fetch('http://127.0.0.1:4102/api/equipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Test Drill 3', daily_rent: 1000, security_deposit: 2000, status: 'available', location: 'Warehouse' })
  });
  const equipment3Payload = await equipment3Response.json();

  const customersBefore = await (await fetch('http://127.0.0.1:4102/api/customers', { headers: { Authorization: `Bearer ${token}` } })).json();
  const countBefore = customersBefore.data.filter((c) => c.phone_number === phone).length;
  assert.equal(countBefore, 1);

  const secondRentalResponse = await fetch('http://127.0.0.1:4102/api/rentals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customer_name: 'Nina Updated', customer_phone: phone, rental_date: '2026-07-18', expected_return_date: '2026-07-20', items: [{ equipment_id: equipment3Payload.data.id, daily_rate: 1000, deposit: 2000, rental_days: 2 }] })
  });
  assert.equal(secondRentalResponse.status, 201);

  const customersAfter = await (await fetch('http://127.0.0.1:4102/api/customers', { headers: { Authorization: `Bearer ${token}` } })).json();
  const matchingAfter = customersAfter.data.filter((c) => c.phone_number === phone);
  assert.equal(matchingAfter.length, 1);
  assert.equal(matchingAfter[0].full_name, 'Nina Updated');

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('updates a customer through the API', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4103', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const loginResponse = await fetch('http://127.0.0.1:4103/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginPayload = await loginResponse.json();
  const token = loginPayload.token;

  const createResponse = await fetch('http://127.0.0.1:4103/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ full_name: 'Mina', phone_number: '1111111111', status: 'active' })
  });
  const createPayload = await createResponse.json();
  assert.equal(createResponse.status, 201);

  const updateResponse = await fetch(`http://127.0.0.1:4103/api/customers/${createPayload.data.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ full_name: 'Mina Updated', phone_number: '2222222222', status: 'blocked' })
  });
  const updatePayload = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.success, true);

  const getResponse = await fetch('http://127.0.0.1:4103/api/customers', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const getPayload = await getResponse.json();
  assert.equal(getResponse.status, 200);
  const updatedCustomer = getPayload.data.find((customer) => customer.id === createPayload.data.id);
  assert.ok(updatedCustomer);
  assert.equal(updatedCustomer.full_name, 'Mina Updated');

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('editing a rental to swap equipment keeps equipment status in sync', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4104', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4104';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const token = loginPayload.token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const equipA = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Swap A', daily_rent: 500, security_deposit: 1000, status: 'available' })
  })).json()).data;
  const equipB = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Swap B', daily_rent: 500, security_deposit: 1000, status: 'available' })
  })).json()).data;

  const rental = (await (await fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Swap Tester', customer_phone: `9${Date.now()}`.slice(0, 10),
      rental_date: '2026-07-18', expected_return_date: '2026-07-20',
      items: [{ equipment_id: equipA.id, daily_rate: 500, deposit: 1000, rental_days: 2 }]
    })
  })).json()).data;

  const equipmentAfterCreate = (await (await fetch(`${base}/api/equipment`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
  assert.equal(equipmentAfterCreate.find((e) => e.id === equipA.id).status, 'rented');
  assert.equal(equipmentAfterCreate.find((e) => e.id === equipB.id).status, 'available');

  const putBody = {
    customer_name: 'Swap Tester', customer_phone: `9${Date.now()}`.slice(0, 10), customer_address: '',
    equipment_id: equipB.id, rental_date: '2026-07-18', expected_return_date: '2026-07-20', expected_return_time: '18:00',
    rental_days: 2, daily_rate: 500, deposit: 1000,
  };
  const swapResponse = await fetch(`${base}/api/rentals/${rental.ids[0]}`, { method: 'PUT', headers, body: JSON.stringify(putBody) });
  assert.equal(swapResponse.status, 200);

  const equipmentAfterSwap = (await (await fetch(`${base}/api/equipment`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
  assert.equal(equipmentAfterSwap.find((e) => e.id === equipA.id).status, 'available');
  assert.equal(equipmentAfterSwap.find((e) => e.id === equipB.id).status, 'rented');

  // A now free again — rent it out under a second rental, then try to swap the
  // first rental (currently on B) back onto it. That must be rejected: A is busy.
  await fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Second Customer', customer_phone: `8${Date.now()}`.slice(0, 10),
      rental_date: '2026-07-18', expected_return_date: '2026-07-20',
      items: [{ equipment_id: equipA.id, daily_rate: 500, deposit: 1000, rental_days: 2 }]
    })
  });

  const unsafeSwapResponse = await fetch(`${base}/api/rentals/${rental.ids[0]}`, {
    method: 'PUT', headers, body: JSON.stringify({ ...putBody, equipment_id: equipA.id })
  });
  assert.equal(unsafeSwapResponse.status, 409);

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('equipment status cannot be hand-edited away from rented while a rental is open', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4105', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4105';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const token = loginPayload.token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const equip = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Guarded Item', daily_rent: 500, security_deposit: 1000, status: 'available' })
  })).json()).data;

  const rental = (await (await fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Guard Tester', customer_phone: `7${Date.now()}`.slice(0, 10),
      rental_date: '2026-07-18', expected_return_date: '2026-07-18',
      items: [{ equipment_id: equip.id, daily_rate: 500, deposit: 1000, rental_days: 1 }]
    })
  })).json()).data;

  const equipmentPutBody = { name: 'Guarded Item', daily_rent: 500, security_deposit: 1000, status: 'available' };
  const blockedResponse = await fetch(`${base}/api/equipment/${equip.id}`, { method: 'PUT', headers, body: JSON.stringify(equipmentPutBody) });
  assert.equal(blockedResponse.status, 409);

  const returnResponse = await fetch(`${base}/api/rentals/${rental.ids[0]}/return`, {
    method: 'POST', headers, body: JSON.stringify({ actual_return_date: '2026-07-18', damage_charge: 0, return_notes: '' })
  });
  assert.equal(returnResponse.status, 200);

  const allowedResponse = await fetch(`${base}/api/equipment/${equip.id}`, {
    method: 'PUT', headers, body: JSON.stringify({ ...equipmentPutBody, status: 'maintenance' })
  });
  assert.equal(allowedResponse.status, 200);

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('payment status ignores deposits, counts discounts, and is recomputed after a late return', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4106', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4106';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const token = loginPayload.token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const equip = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Billing Item', daily_rent: 500, security_deposit: 1000, status: 'available' })
  })).json()).data;

  const rental = (await (await fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Billing Tester', customer_phone: `6${Date.now()}`.slice(0, 10),
      rental_date: '2026-07-18', expected_return_date: '2026-07-18',
      items: [{ equipment_id: equip.id, daily_rate: 500, deposit: 1000, rental_days: 1 }]
    })
  })).json()).data;
  const rentalId = rental.ids[0];
  const invoiceNumber = rental.invoice_number;

  const getRental = () => fetch(`${base}/api/rentals/${rentalId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

  // Handing over the deposit alone must not mark rent as paid.
  await fetch(`${base}/api/payments`, {
    method: 'POST', headers, body: JSON.stringify({ invoice_number: invoiceNumber, amount: 1000, payment_type: 'deposit' })
  });
  assert.equal((await getRental()).data.payment_status, 'pending');

  // Partial rent payment.
  await fetch(`${base}/api/payments`, {
    method: 'POST', headers, body: JSON.stringify({ invoice_number: invoiceNumber, amount: 300, payment_type: 'rent' })
  });
  assert.equal((await getRental()).data.payment_status, 'partial');

  // A discount can cover the rest of the balance without any cash changing hands.
  const discountResponse = await fetch(`${base}/api/payments`, {
    method: 'POST', headers, body: JSON.stringify({ invoice_number: invoiceNumber, amount: 0, discount: 200, payment_type: 'rent' })
  });
  assert.equal(discountResponse.status, 201);
  assert.equal((await getRental()).data.payment_status, 'paid');

  // Returning it late adds a late fee, raising final_amount past what's been settled.
  const returnResponse = await fetch(`${base}/api/rentals/${rentalId}/return`, {
    method: 'POST', headers, body: JSON.stringify({ actual_return_date: '2026-07-19', damage_charge: 0, return_notes: '' })
  });
  assert.equal(returnResponse.status, 200);
  assert.equal((await getRental()).data.payment_status, 'partial');

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('one payment settles a multi-item invoice across every item on it', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4107', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4107';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const token = loginPayload.token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const equipA = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Multi A', daily_rent: 500, security_deposit: 1000, status: 'available' })
  })).json()).data;
  const equipB = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Multi B', daily_rent: 300, security_deposit: 500, status: 'available' })
  })).json()).data;

  const rental = (await (await fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Multi Item Tester', customer_phone: `5${Date.now()}`.slice(0, 10),
      rental_date: '2026-07-18', expected_return_date: '2026-07-18',
      items: [
        { equipment_id: equipA.id, daily_rate: 500, deposit: 1000, rental_days: 1 },
        { equipment_id: equipB.id, daily_rate: 300, deposit: 500, rental_days: 1 },
      ],
    })
  })).json()).data;
  const invoiceNumber = rental.invoice_number;

  const getInvoiceItems = async () => {
    const all = await (await fetch(`${base}/api/rentals`, { headers: { Authorization: `Bearer ${token}` } })).json();
    return all.data.filter((r) => r.invoice_number === invoiceNumber);
  };

  // Before any payment, both items are pending.
  assert.deepEqual((await getInvoiceItems()).map((r) => r.payment_status), ['pending', 'pending']);

  // One payment for the combined total (500 + 300 = 800) should settle both items at once.
  const paymentResponse = await fetch(`${base}/api/payments`, {
    method: 'POST', headers, body: JSON.stringify({ invoice_number: invoiceNumber, amount: 800, payment_type: 'rent' })
  });
  assert.equal(paymentResponse.status, 201);

  const itemsAfterPayment = await getInvoiceItems();
  assert.equal(itemsAfterPayment.length, 2);
  assert.deepEqual(itemsAfterPayment.map((r) => r.payment_status), ['paid', 'paid']);

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('batch return closes only the chosen items of an invoice, charging each its own damage', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4108', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4108';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const token = loginPayload.token;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const createEquipment = async (name, dailyRent) => (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name, daily_rent: dailyRent, security_deposit: 1000, status: 'available' })
  })).json()).data;
  const [equipA, equipB, equipC] = [await createEquipment('Batch A', 500), await createEquipment('Batch B', 300), await createEquipment('Batch C', 200)];

  const rental = (await (await fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Batch Tester', customer_phone: `6${Date.now()}`.slice(0, 10),
      rental_date: '2026-07-18', expected_return_date: '2026-07-19',
      items: [equipA, equipB, equipC].map((equip) => ({ equipment_id: equip.id, daily_rate: equip.daily_rent, deposit: 1000, rental_days: 1 }))
    })
  })).json()).data;
  const [idA, idB, idC] = rental.ids;

  // Out 07-18, back 07-20 = 3 calendar days at each item's rate; the day past
  // the 07-19 due date shows as the late fee but is part of those 3 days.
  const batchResponse = await fetch(`${base}/api/rentals/return-batch`, {
    method: 'POST', headers, body: JSON.stringify({
      actual_return_date: '2026-07-20', return_notes: 'batch',
      items: [{ id: idA, damage_charge: 100 }, { id: idB }]
    })
  });
  assert.equal(batchResponse.status, 200);

  const all = (await (await fetch(`${base}/api/rentals`, { headers })).json()).data;
  const byId = new Map(all.map((r) => [r.id, r]));
  assert.equal(byId.get(idA).status, 'completed');
  assert.equal(byId.get(idA).late_fee, 500);
  assert.equal(byId.get(idA).final_amount, 3 * 500 + 100);
  assert.equal(byId.get(idA).refund_amount, 900);
  assert.equal(byId.get(idB).status, 'completed');
  assert.equal(byId.get(idB).final_amount, 3 * 300);
  assert.notEqual(byId.get(idC).status, 'completed');

  // Returning an already-closed item again is rejected without touching the open one.
  const repeatResponse = await fetch(`${base}/api/rentals/return-batch`, {
    method: 'POST', headers, body: JSON.stringify({ actual_return_date: '2026-07-20', items: [{ id: idA }, { id: idC }] })
  });
  assert.equal(repeatResponse.status, 409);
  const stillOpen = (await (await fetch(`${base}/api/rentals`, { headers })).json()).data.find((r) => r.id === idC);
  assert.notEqual(stillOpen.status, 'completed');

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('editing a returned item re-derives its late fee, refund and final amount', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4109', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4109';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginPayload.token}` };

  const equip = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Edit Returned', daily_rent: 400, security_deposit: 1000, status: 'available' })
  })).json()).data;
  const phone = `5${Date.now()}`.slice(0, 10);
  const rental = (await (await fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Edit Tester', customer_phone: phone,
      rental_date: '2026-07-18', expected_return_date: '2026-07-19',
      items: [{ equipment_id: equip.id, daily_rate: 400, deposit: 1000, rental_days: 1 }]
    })
  })).json()).data;
  const id = rental.ids[0];

  // Returned 07-21 with no damage: 4 calendar days at 400.
  await fetch(`${base}/api/rentals/${id}/return`, {
    method: 'POST', headers, body: JSON.stringify({ actual_return_date: '2026-07-21', damage_charge: 0 })
  });

  // Correct it: actually back 07-20 (3 days, 1 past due), 150 damage, at a 500 rate.
  const editResponse = await fetch(`${base}/api/rentals/${id}`, {
    method: 'PUT', headers, body: JSON.stringify({
      customer_name: 'Edit Tester', customer_phone: phone, equipment_id: equip.id,
      rental_date: '2026-07-18', expected_return_date: '2026-07-19', rental_days: 1,
      daily_rate: 500, deposit: 1000,
      actual_return_date: '2026-07-20', damage_charge: 150, return_notes: 'scratched'
    })
  });
  assert.equal(editResponse.status, 200);

  const edited = (await (await fetch(`${base}/api/rentals/${id}`, { headers })).json()).data;
  assert.equal(edited.status, 'completed');
  assert.equal(edited.actual_return_date, '2026-07-20');
  assert.equal(edited.late_fee, 500);
  assert.equal(edited.damage_charge, 150);
  assert.equal(edited.refund_amount, 850);
  assert.equal(edited.rental_days, 2);
  assert.equal(edited.final_amount, 3 * 500 + 150);
  assert.equal(edited.return_notes, 'scratched');

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('every calendar day counts: same-day return is 1 day, next-day return is 2', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4110', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4110';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginPayload.token}` };

  const rentOne = async (name, rentalDate, expectedDate) => {
    const equip = (await (await fetch(`${base}/api/equipment`, {
      method: 'POST', headers, body: JSON.stringify({ name, daily_rent: 200, security_deposit: 0, status: 'available' })
    })).json()).data;
    const created = await (await fetch(`${base}/api/rentals`, {
      method: 'POST', headers, body: JSON.stringify({
        customer_name: 'Day Counter', customer_phone: `4${Date.now()}`.slice(0, 10),
        rental_date: rentalDate, expected_return_date: expectedDate,
        // A stale day count from the client is ignored: days follow the dates.
        items: [{ equipment_id: equip.id, daily_rate: 200, deposit: 0, rental_days: 9 }]
      })
    })).json();
    return created.data.ids[0];
  };
  const returnOn = (id, date) => fetch(`${base}/api/rentals/${id}/return`, {
    method: 'POST', headers, body: JSON.stringify({ actual_return_date: date })
  });
  const get = async (id) => (await (await fetch(`${base}/api/rentals/${id}`, { headers })).json()).data;

  // Booked same day: 1 day.
  const sameDay = await rentOne('Day A', '2026-07-18', '2026-07-18');
  assert.equal((await get(sameDay)).rental_days, 1);
  assert.equal((await get(sameDay)).total_rent, 200);
  await returnOn(sameDay, '2026-07-18');
  assert.equal((await get(sameDay)).final_amount, 200);

  // Out today, back tomorrow: 2 days.
  const nextDay = await rentOne('Day B', '2026-07-18', '2026-07-18');
  await returnOn(nextDay, '2026-07-19');
  assert.equal((await get(nextDay)).final_amount, 400);

  // Booked 3 days, back on day 2: pays the 2 days used.
  const early = await rentOne('Day C', '2026-07-18', '2026-07-20');
  assert.equal((await get(early)).rental_days, 3);
  await returnOn(early, '2026-07-19');
  assert.equal((await get(early)).final_amount, 400);
  assert.equal((await get(early)).late_fee, 0);

  // Returning before the rental date is refused.
  const backwards = await rentOne('Day D', '2026-07-18', '2026-07-18');
  assert.equal((await returnOn(backwards, '2026-07-17')).status, 400);

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('invoice numbers are 5-digit and issued in order', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4111', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4111';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginPayload.token}` };

  const createInvoice = async (name) => {
    const equip = (await (await fetch(`${base}/api/equipment`, {
      method: 'POST', headers, body: JSON.stringify({ name, daily_rent: 100, security_deposit: 0, status: 'available' })
    })).json()).data;
    return (await (await fetch(`${base}/api/rentals`, {
      method: 'POST', headers, body: JSON.stringify({
        customer_name: 'Invoice Order', customer_phone: `3${Date.now()}`.slice(0, 10),
        rental_date: '2026-07-18', expected_return_date: '2026-07-18',
        items: [{ equipment_id: equip.id, daily_rate: 100, deposit: 0 }]
      })
    })).json()).data.invoice_number;
  };

  const first = await createInvoice('Order A');
  const second = await createInvoice('Order B');
  assert.match(first, /^.+-\d{5,}$/);
  assert.match(second, /^.+-\d{5,}$/);
  const number = (invoice) => Number(invoice.split('-').pop());
  assert.equal(number(second), number(first) + 1);

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});

test('an order can take several units of one item, limited by stock', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4112', NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const base = 'http://127.0.0.1:4112';

  const loginPayload = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginPayload.token}` };

  const sheet = (await (await fetch(`${base}/api/equipment`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Stock Sheet', daily_rent: 10, security_deposit: 50, stock_quantity: 5, status: 'available' })
  })).json()).data;
  const getSheet = async () => (await (await fetch(`${base}/api/equipment/${sheet.id}`, { headers })).json()).data;
  const order = (quantity) => fetch(`${base}/api/rentals`, {
    method: 'POST', headers, body: JSON.stringify({
      customer_name: 'Bulk Renter', customer_phone: `2${Date.now()}`.slice(0, 10),
      rental_date: '2026-07-18', expected_return_date: '2026-07-19',
      items: [{ equipment_id: sheet.id, quantity, daily_rate: 10, deposit: 50 * quantity }]
    })
  });

  // 3 of 5 out: still rentable, 2 free. 3 more don't fit; 2 more do and use it up.
  const first = await order(3);
  assert.equal(first.status, 201);
  const firstId = (await first.json()).data.ids[0];
  let state = await getSheet();
  assert.equal(state.available_quantity, 2);
  assert.equal(state.status, 'available');
  assert.equal((await order(3)).status, 409);
  assert.equal((await order(2)).status, 201);
  state = await getSheet();
  assert.equal(state.available_quantity, 0);
  assert.equal(state.status, 'rented');

  // Rent scales with quantity: 3 units × 10 × 2 days.
  const line = (await (await fetch(`${base}/api/rentals/${firstId}`, { headers })).json()).data;
  assert.equal(line.quantity, 3);
  assert.equal(line.total_rent, 60);

  // Returning the 3 frees them; one day late = 3 days × 3 units × 10.
  await fetch(`${base}/api/rentals/${firstId}/return`, { method: 'POST', headers, body: JSON.stringify({ actual_return_date: '2026-07-20' }) });
  const returned = (await (await fetch(`${base}/api/rentals/${firstId}`, { headers })).json()).data;
  assert.equal(returned.final_amount, 90);
  state = await getSheet();
  assert.equal(state.available_quantity, 3);
  assert.equal(state.status, 'available');

  // Stock can't be cut below the 2 units still out.
  const cut = await fetch(`${base}/api/equipment/${sheet.id}`, {
    method: 'PUT', headers, body: JSON.stringify({ name: 'Stock Sheet', daily_rent: 10, security_deposit: 50, stock_quantity: 1, status: 'available' })
  });
  assert.equal(cut.status, 409);

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
});
