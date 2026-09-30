import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

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
  directory = await mkdtemp(join(tmpdir(), 'dailydrop-test-'));
  const databaseFile = join(directory, 'test.sqlite');
  const legacy = new DatabaseSync(databaseFile);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '', is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, price REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      delivery_date TEXT NOT NULL, quantity REAL NOT NULL, UNIQUE(user_id, product_id, delivery_date)
    );
    CREATE TABLE payments (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payment_month TEXT NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL,
      PRIMARY KEY(user_id, payment_month)
    );
  `);
  legacy.prepare(`INSERT INTO users (id, username, password_hash, password_salt, full_name, email, phone, address, is_admin)
    VALUES (1, 'legacy', 'not-used', 'not-used', 'Legacy account', '', '', '', 0)`).run();
  legacy.prepare('INSERT INTO products (id, user_id, name, price) VALUES (1, 1, ?, ?)').run('Legacy milk', 3);
  legacy.prepare('INSERT INTO entries (id, user_id, product_id, delivery_date, quantity) VALUES (1, 1, 1, ?, ?)').run('2026-04-01', 2);
  legacy.close();
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DB_PATH: databaseFile, ADMIN_USERNAMES: 'operator', ALLOW_REGISTRATION: 'true', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForServer();
  const migrated = new DatabaseSync(databaseFile);
  assert.equal(migrated.prepare('SELECT product_name FROM entries WHERE id = 1').get().product_name, 'Legacy milk');
  assert.equal(migrated.prepare('PRAGMA foreign_key_list(entries)').all().some((key) => key.table === 'products'), false);
  migrated.prepare('DELETE FROM products WHERE id = 1').run();
  assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM entries WHERE id = 1').get().count, 1);
  migrated.close();
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('accounts, delivery snapshots, reports, and administrator payments stay scoped', async () => {
  const config = await request('/api/config');
  assert.equal(config.data.registrationEnabled, true);
  const oversized = await request('/api/auth/login', { method: 'POST', body: { padding: 'a'.repeat(21 * 1024) } });
  assert.equal(oversized.response.status, 413);

  const registeredAdmin = await request('/api/auth/register', { method: 'POST', body: { username: 'operator', password: 'secure-password-1', fullName: 'Ledger Admin' } });
  assert.equal(registeredAdmin.response.status, 201);
  const adminCookie = registeredAdmin.cookie;
  const adminId = registeredAdmin.data.user.id;
  assert.ok(adminCookie);
  assert.equal(registeredAdmin.data.user.isAdmin, true);

  const productResponse = await request('/api/products', { cookie: adminCookie, method: 'POST', body: {
    name: 'Oats', price: 4.5, defaultQuantity: 2, scheduleType: 'daily', schedule: {},
  } });
  assert.equal(productResponse.response.status, 201);
  const productId = productResponse.data.id;
  const decimalQuantityProduct = await request('/api/products', { cookie: adminCookie, method: 'POST', body: {
    name: 'Bad quantity', price: 2.5, defaultQuantity: 1.5, scheduleType: 'daily', schedule: {},
  } });
  assert.equal(decimalQuantityProduct.response.status, 400);
  const invalidSchedule = await request('/api/products', { cookie: adminCookie, method: 'POST', body: {
    name: 'Bad interval', price: 1, defaultQuantity: 1, scheduleType: 'every_n', schedule: { interval: 1 },
  } });
  assert.equal(invalidSchedule.response.status, 400);

  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: adminCookie, method: 'PUT', body: { quantity: 2 } })).response.status, 200);
  assert.equal((await request(`/api/entries/2026-04-03/${productId}`, { cookie: adminCookie, method: 'PUT', body: { quantity: 0 } })).response.status, 200);
  const profile = await request('/api/me', { cookie: adminCookie, method: 'PUT', body: { fullName: 'Ledger Admin', email: 'admin@example.test', phone: '555-0100', address: '14 Main Street' } });
  assert.equal(profile.data.user.address, '14 Main Street');

  assert.equal((await request(`/api/products/${productId}`, { cookie: adminCookie, method: 'PUT', body: {
    name: 'Rolled oats', price: 8, defaultQuantity: 3, scheduleType: 'on_demand', schedule: {},
  } })).response.status, 200);
  const historicalEntries = await request('/api/entries?month=2026-04', { cookie: adminCookie });
  assert.equal(historicalEntries.data.entries[0].product_name, 'Oats');
  assert.equal(historicalEntries.data.entries[0].unit_price, 4.5);
  const report = await request('/api/reports/monthly-totals?to=2026-04&months=2', { cookie: adminCookie });
  assert.equal(report.data.totals.at(-1).total, 9);
  assert.equal(report.data.totals.at(-1).missed, 1);

  const registeredUser = await request('/api/auth/register', { method: 'POST', body: { username: 'customer', password: 'another-password-2' } });
  assert.equal(registeredUser.response.status, 201);
  const userCookie = registeredUser.cookie;
  assert.equal((await request('/api/admin/overview', { cookie: userCookie })).response.status, 403);
  assert.deepEqual((await request('/api/products', { cookie: userCookie })).data.products, []);
  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: userCookie, method: 'PUT', body: { quantity: 99 } })).response.status, 404);
  assert.equal((await request(`/api/payments/2026-04`, { cookie: userCookie })).response.status, 200);

  const bills = await request('/api/admin/bills?month=2026-04', { cookie: adminCookie });
  const adminBill = bills.data.rows.find((row) => row.username === 'operator');
  assert.equal(adminBill.bill, 9);
  assert.equal(adminBill.products[0].product, 'Oats');
  assert.equal((await request(`/api/admin/payments/${adminId}/2026-04`, { cookie: adminCookie, method: 'PUT', body: { amount: 4, method: 'UPI' } })).response.status, 200);
  assert.equal((await request('/api/payments/2026-04', { cookie: adminCookie })).data.status, 'partial');
  assert.equal((await request(`/api/admin/payments/${adminId}/2026-04`, { cookie: adminCookie, method: 'DELETE' })).response.status, 200);
  assert.equal((await request('/api/payments/2026-04', { cookie: adminCookie })).data.status, 'pending');

  assert.equal((await request(`/api/entries/2026-04-02/${productId}`, { cookie: adminCookie, method: 'DELETE' })).response.status, 200);
  assert.equal((await request('/api/entries?month=2026-04', { cookie: adminCookie })).data.entries.length, 1);
  assert.equal((await request(`/api/products/${productId}`, { cookie: adminCookie, method: 'DELETE' })).response.status, 200);
  const afterDelete = await request('/api/entries?month=2026-04', { cookie: adminCookie });
  assert.equal(afterDelete.data.entries[0].product_name, 'Oats');

  const secondSession = await request('/api/auth/login', { method: 'POST', body: { username: 'operator', password: 'secure-password-1' } });
  assert.ok(secondSession.cookie);
  assert.equal((await request('/api/me/password', { cookie: adminCookie, method: 'PUT', body: { currentPassword: 'secure-password-1', newPassword: 'changed-password-3' } })).response.status, 200);
  assert.equal((await request('/api/me', { cookie: secondSession.cookie })).response.status, 401);
  assert.equal((await request('/api/auth/logout', { cookie: adminCookie, method: 'POST' })).response.status, 200);
  assert.equal((await request('/api/me', { cookie: adminCookie })).response.status, 401);
});