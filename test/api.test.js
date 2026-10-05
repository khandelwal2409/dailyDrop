import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';

let directory;
let child;
let baseUrl;
let output = '';

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { response, data, cookie: response.headers.getSetCookie().find((value) => value.startsWith('dailydrop_session='))?.split(';')[0] };
}

async function waitForServer() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${output}`);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dailydrop-local-test-'));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DB_PATH: join(directory, 'test.sqlite'), DATABASE_URL: '', SELLER_USERNAMES: 'operator', ALLOW_REGISTRATION: 'true', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForServer();
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('accounts, delivery snapshots, reports, and seller payments stay scoped', async () => {
  const sellerPage = await fetch(`${baseUrl}/seller`);
  assert.equal(sellerPage.status, 200);
  assert.match(await sellerPage.text(), /seller-manifest\.webmanifest/);
  assert.equal((await fetch(`${baseUrl}/admin`)).status, 404);
  const config = await request('/api/config');
  assert.equal(config.data.registrationEnabled, true);
  const oversized = await request('/api/auth/login', { method: 'POST', body: { padding: 'a'.repeat(21 * 1024) } });
  assert.equal(oversized.response.status, 413);

  const registeredSeller = await request('/api/auth/register', { method: 'POST', body: { username: 'operator', password: 'secure-password-1', fullName: 'Ledger Seller' } });
  assert.equal(registeredSeller.response.status, 201);
  const sellerCookie = registeredSeller.cookie;
  const sellerId = registeredSeller.data.user.id;
  assert.ok(sellerCookie);
  assert.equal(registeredSeller.data.user.isSeller, true);
  assert.equal(registeredSeller.data.user.isAdmin, undefined);
  const duplicateSeller = await request('/api/auth/register', { method: 'POST', body: { username: 'operator', password: 'secure-password-1' } });
  assert.equal(duplicateSeller.response.status, 409);
  const overview = await request('/api/seller/overview', { cookie: sellerCookie });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.data.users, 1);
  assert.equal(overview.data.products, 0);

  const productResponse = await request('/api/products', { cookie: sellerCookie, method: 'POST', body: {
    name: 'Oats', price: 4.5, defaultQuantity: 2, scheduleType: 'daily', schedule: {},
  } });
  assert.equal(productResponse.response.status, 201);
  const productId = productResponse.data.id;
  const initialDirectory = await request('/api/seller/bills?month=2026-04', { cookie: sellerCookie });
  assert.deepEqual(initialDirectory.data.rows[0].subscriptions, [{ name: 'Oats', defaultQuantity: 2, scheduleType: 'daily', schedule: {} }]);
  const decimalQuantityProduct = await request('/api/products', { cookie: sellerCookie, method: 'POST', body: {
    name: 'Bad quantity', price: 2.5, defaultQuantity: 1.5, scheduleType: 'daily', schedule: {},
  } });
  assert.equal(decimalQuantityProduct.response.status, 400);
  const invalidSchedule = await request('/api/products', { cookie: sellerCookie, method: 'POST', body: {
    name: 'Bad interval', price: 1, defaultQuantity: 1, scheduleType: 'every_n', schedule: { interval: 1 },
  } });
  assert.equal(invalidSchedule.response.status, 400);

  const invalidUnitPrice = await request(`/api/entries/2026-04-02/${productId}`, { cookie: sellerCookie, method: 'PUT', body: { quantity: 2, unitPrice: 1000001 } });
  assert.equal(invalidUnitPrice.response.status, 400);
  const entryResponse = await request(`/api/entries/2026-04-02/${productId}`, { cookie: sellerCookie, method: 'PUT', body: { quantity: 2, unitPrice: 5.5 } });
  assert.equal(entryResponse.response.status, 200, output);
  const dailyPriceOverride = await request('/api/entries?month=2026-04', { cookie: sellerCookie });
  assert.equal(dailyPriceOverride.data.entries.find((entry) => entry.delivery_date === '2026-04-02').unit_price, 5.5);
  assert.equal((await request('/api/payments/2026-04', { cookie: sellerCookie })).data.bill, 11);
  assert.equal((await request('/api/products', { cookie: sellerCookie })).data.products[0].price, 4.5);
  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: sellerCookie, method: 'PUT', body: { quantity: 2, unitPrice: 4.5 } })).response.status, 200);
  assert.equal((await request('/api/payments/2026-04', { cookie: sellerCookie })).data.bill, 9);
  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: sellerCookie, method: 'PUT', body: { quantity: 1 } })).response.status, 200);
  const partialEntry = await request('/api/entries?month=2026-04', { cookie: sellerCookie });
  assert.equal(partialEntry.data.entries.find((entry) => entry.delivery_date === '2026-04-02').quantity, 1);
  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: sellerCookie, method: 'PUT', body: { quantity: 2 } })).response.status, 200);
  assert.equal((await request(`/api/entries/2026-04-03/${productId}`, { cookie: sellerCookie, method: 'PUT', body: { quantity: 0 } })).response.status, 200);
  const profile = await request('/api/me', { cookie: sellerCookie, method: 'PUT', body: { fullName: 'Ledger Seller', email: 'seller@example.test', phone: '555-0100', address: '14 Main Street' } });
  assert.equal(profile.data.user.address, '14 Main Street');

  assert.equal((await request(`/api/products/${productId}`, { cookie: sellerCookie, method: 'PUT', body: {
    name: 'Rolled oats', price: 8, defaultQuantity: 3, scheduleType: 'on_demand', schedule: {},
  } })).response.status, 200);
  const historicalEntries = await request('/api/entries?month=2026-04', { cookie: sellerCookie });
  assert.equal(historicalEntries.data.entries[0].product_name, 'Oats');
  assert.equal(historicalEntries.data.entries[0].unit_price, 4.5);
  const report = await request('/api/reports/monthly-totals?to=2026-04&months=2', { cookie: sellerCookie });
  assert.equal(report.data.totals.at(-1).total, 9);
  assert.equal(report.data.totals.at(-1).missed, 1);

  const registeredUser = await request('/api/auth/register', { method: 'POST', body: { username: 'customer', password: 'another-password-2' } });
  assert.equal(registeredUser.response.status, 201);
  const userCookie = registeredUser.cookie;
  assert.equal((await request('/api/seller/overview', { cookie: userCookie })).response.status, 403);
  assert.equal((await request('/api/seller/bills?month=2026-04', { cookie: userCookie })).response.status, 403);
  assert.deepEqual((await request('/api/products', { cookie: userCookie })).data.products, []);
  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: userCookie, method: 'PUT', body: { quantity: 99 } })).response.status, 404);
  assert.equal((await request(`/api/payments/2026-04`, { cookie: userCookie })).response.status, 200);

  const bills = await request('/api/seller/bills?month=2026-04', { cookie: sellerCookie });
  const sellerBill = bills.data.rows.find((row) => row.username === 'operator');
  assert.equal(sellerBill.bill, 9);
  assert.equal(sellerBill.products[0].product, 'Oats');
  assert.equal((await request(`/api/seller/payments/${sellerId}/2026-04`, { cookie: sellerCookie, method: 'PUT', body: { amount: 4, method: 'UPI' } })).response.status, 200);
  assert.equal((await request('/api/payments/2026-04', { cookie: sellerCookie })).data.status, 'partial');
  assert.equal((await request(`/api/seller/payments/${sellerId}/2026-04`, { cookie: sellerCookie, method: 'DELETE' })).response.status, 200);
  assert.equal((await request('/api/payments/2026-04', { cookie: sellerCookie })).data.status, 'pending');

  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: sellerCookie, method: 'DELETE' })).response.status, 200);
  assert.equal((await request('/api/entries?month=2026-04', { cookie: sellerCookie })).data.entries.length, 1);
  assert.equal((await request(`/api/products/${productId}`, { cookie: sellerCookie, method: 'DELETE' })).response.status, 200);
  const afterDelete = await request('/api/entries?month=2026-04', { cookie: sellerCookie });
  assert.equal(afterDelete.data.entries[0].product_name, 'Oats');

  const secondSession = await request('/api/auth/login', { method: 'POST', body: { username: 'operator', password: 'secure-password-1' } });
  assert.ok(secondSession.cookie);
  assert.equal((await request('/api/me/password', { cookie: sellerCookie, method: 'PUT', body: { currentPassword: 'secure-password-1', newPassword: 'changed-password-3' } })).response.status, 200);
  assert.equal((await request('/api/me', { cookie: secondSession.cookie })).response.status, 401);
  assert.equal((await request('/api/auth/logout', { cookie: sellerCookie, method: 'POST' })).response.status, 200);
  assert.equal((await request('/api/me', { cookie: sellerCookie })).response.status, 401);
});