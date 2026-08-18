const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const serverPath = path.join(__dirname, '..', 'app.js');

test('server exposes a health endpoint', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4101', NODE_ENV: 'test' },
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
    env: { ...process.env, PORT: '4102', NODE_ENV: 'test' },
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
    env: { ...process.env, PORT: '4102', NODE_ENV: 'test' },
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
    env: { ...process.env, PORT: '4103', NODE_ENV: 'test' },
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
    env: { ...process.env, PORT: '4104', NODE_ENV: 'test' },
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
    env: { ...process.env, PORT: '4105', NODE_ENV: 'test' },
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
    env: { ...process.env, PORT: '4106', NODE_ENV: 'test' },
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
    env: { ...process.env, PORT: '4107', NODE_ENV: 'test' },
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
      rental_date: '2026-07-18', expected_return_date: '2026-07-19',
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
