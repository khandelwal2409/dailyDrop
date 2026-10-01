import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

process.env.DATABASE_URL = 'memory:';
process.env.NODE_ENV = 'test';

const { initializeDatabase, migratePostgresSellerRole, pool } = await import('../src/db.js');
const { migrateSqliteToPostgres } = await import('../scripts/migrate-sqlite-to-postgres.js');
let directory;

after(async () => {
  await pool.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('imports legacy SQLite account, product, entry, session, and payment data', async () => {
  await initializeDatabase();
  await pool.query('ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query(`INSERT INTO users (username, password_hash, password_salt, is_seller, is_admin)
    VALUES ('old-seller', 'hash', 'salt', FALSE, TRUE)`);
  await pool.query("DELETE FROM app_migrations WHERE name = 'seller-role-v1'");
  await migratePostgresSellerRole();
  const migratedRole = await pool.query("SELECT is_seller FROM users WHERE username = 'old-seller'");
  assert.equal(migratedRole.rows[0].is_seller, true);
  await pool.query("DELETE FROM users WHERE username = 'old-seller'");

  directory = await mkdtemp(join(tmpdir(), 'dailydrop-migration-'));
  const sourcePath = join(directory, 'legacy.sqlite');
  const sqlite = new DatabaseSync(sourcePath);
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '', is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL);
    CREATE TABLE entries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, delivery_date TEXT NOT NULL, quantity REAL NOT NULL);
    CREATE TABLE payments (user_id INTEGER NOT NULL, payment_month TEXT NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL);
    INSERT INTO users (id, username, password_hash, password_salt, full_name, is_admin)
      VALUES (41, 'legacy', 'hash', 'salt', 'Legacy User', 1);
    INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('token-hash', 41, 2000000000000);
    INSERT INTO products (id, user_id, name, price) VALUES (17, 41, 'Legacy milk', 3.25);
    INSERT INTO entries (id, user_id, product_id, delivery_date, quantity) VALUES (29, 41, 17, '2026-04-01', 2);
    INSERT INTO payments (user_id, payment_month, amount, method) VALUES (41, '2026-04', 4, 'Cash');
  `);
  sqlite.close();

  const counts = await migrateSqliteToPostgres(sourcePath, { resetSequences: false });
  assert.deepEqual(counts, { users: 1, sessions: 1, products: 1, entries: 1, payments: 1 });
  const user = await pool.query('SELECT id, username, is_seller FROM users');
  assert.deepEqual(user.rows[0], { id: 41, username: 'legacy', is_seller: true });
  const entry = await pool.query('SELECT id, product_name, unit_price FROM entries');
  assert.deepEqual(entry.rows[0], { id: 29, product_name: 'Legacy milk', unit_price: 3.25 });
  const payment = await pool.query('SELECT amount, note FROM payments');
  assert.equal(payment.rows[0].amount, 4);
  assert.equal(payment.rows[0].note, '');
  assert.deepEqual(await migrateSqliteToPostgres(sourcePath), { skipped: true });
  await pool.query('DELETE FROM app_migrations WHERE name = $1', ['sqlite-import-v1']);
  await assert.rejects(migrateSqliteToPostgres(sourcePath, { resetSequences: false }), /refusing to merge or overwrite/);
});