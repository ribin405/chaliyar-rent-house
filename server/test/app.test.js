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
  const customerResponse = await fetch('http://127.0.0.1:4102/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ full_name: 'Nina', phone_number: '9999999999', status: 'active' })
  });
  const customerPayload = await customerResponse.json();
  assert.equal(customerResponse.status, 201);
  assert.equal(customerPayload.success, true);

  const equipmentResponse = await fetch('http://127.0.0.1:4102/api/equipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Test Drill', daily_rent: 1000, security_deposit: 2000, status: 'available', location: 'Warehouse' })
  });
  const equipmentPayload = await equipmentResponse.json();
  assert.equal(equipmentResponse.status, 201);
  assert.equal(equipmentPayload.success, true);

  const rentalResponse = await fetch('http://127.0.0.1:4102/api/rentals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ customer_id: customerPayload.data.id, equipment_id: equipmentPayload.data.id, rental_date: '2026-07-18', expected_return_date: '2026-07-20', daily_rate: 1000, deposit: 2000, rental_days: 2 })
  });
  const rentalPayload = await rentalResponse.json();
  assert.equal(rentalResponse.status, 201);
  assert.equal(rentalPayload.success, true);

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
