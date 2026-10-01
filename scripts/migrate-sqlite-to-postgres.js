import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { databaseMode, initializeDatabase, pool } from '../src/db.js';

function readRows(sqlite, tables, table, fields) {
  if (!tables.has(table)) return [];
  const columns = new Set(sqlite.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  const select = fields.map(([name, fallback, legacyName]) => {
    const sourceName = columns.has(name) ? name : legacyName && columns.has(legacyName) ? legacyName : null;
    return `${sourceName ? `"${sourceName}"` : fallback} AS "${name}"`;
  }).join(', ');
  return sqlite.prepare(`SELECT ${select} FROM "${table}"`).all();
}

async function insertRows(client, table, fields, rows, transform = (row) => row) {
  const columns = fields.map(([name]) => `"${name}"`).join(', ');
  const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
  for (const source of rows) {
    const row = transform(source);
    await client.query(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`, fields.map(([name]) => row[name]));
  }
}

export async function migrateSqliteToPostgres(sourcePath, { resetSequences = true } = {}) {
  if (databaseMode !== 'postgres') throw new Error('Set NODE_ENV=production or DATABASE_URL=memory: to select a PostgreSQL target.');
  await initializeDatabase();
  const completed = await pool.query('SELECT 1 FROM app_migrations WHERE name = $1', ['sqlite-import-v1']);
  if (completed.rowCount) return { skipped: true };
  const sqlite = new DatabaseSync(resolve(sourcePath), { readOnly: true });
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const tables = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tables.has('users')) throw new Error('The SQLite source does not contain a users table.');
    const now = new Date().toISOString();
    const emptyText = String.fromCharCode(39, 39);
    const users = readRows(sqlite, tables, 'users', [
      ['id', 'NULL'], ['username', emptyText], ['password_hash', emptyText], ['password_salt', emptyText],
      ['full_name', emptyText], ['email', emptyText], ['phone', emptyText], ['address', emptyText], ['is_seller', '0', 'is_admin'], ['created_at', 'CURRENT_TIMESTAMP'],
    ]);
    const products = readRows(sqlite, tables, 'products', [
      ['id', 'NULL'], ['user_id', 'NULL'], ['name', "''"], ['price', '0'], ['default_quantity', '1'],
      ['schedule_type', "'daily'"], ['schedule_config', "'{}'"], ['created_at', 'CURRENT_TIMESTAMP'],
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const entries = readRows(sqlite, tables, 'entries', [
      ['id', 'NULL'], ['user_id', 'NULL'], ['product_id', 'NULL'], ['delivery_date', "''"], ['quantity', '0'],
      ['product_name', "''"], ['unit_price', '0'], ['updated_at', 'CURRENT_TIMESTAMP'],
    ]).map((entry) => {
      const product = productById.get(entry.product_id);
      return {
        ...entry,
        product_name: entry.product_name || product?.name || '',
        unit_price: entry.product_name || entry.unit_price ? entry.unit_price : product?.price ?? entry.unit_price,
        updated_at: entry.updated_at || now,
      };
    });
    const payments = readRows(sqlite, tables, 'payments', [
      ['user_id', 'NULL'], ['payment_month', "''"], ['amount', '0'], ['method', "''"], ['note', "''"],
      ['updated_by', 'NULL'], ['updated_at', 'CURRENT_TIMESTAMP'],
    ]).map((payment) => ({ ...payment, updated_at: payment.updated_at || now }));
    const sessions = readRows(sqlite, tables, 'sessions', [
      ['token_hash', "''"], ['user_id', 'NULL'], ['expires_at', '0'], ['created_at', 'CURRENT_TIMESTAMP'],
    ]);

    await client.query('BEGIN');
    inTransaction = true;
    const existing = await client.query(`SELECT
      (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM sessions) +
      (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM entries) +
      (SELECT COUNT(*) FROM payments) AS count`);
    if (Number(existing.rows[0].count) > 0) throw new Error('PostgreSQL already contains data; refusing to merge or overwrite it.');

    await insertRows(client, 'users', [
      ['id'], ['username'], ['password_hash'], ['password_salt'], ['full_name'], ['email'], ['phone'], ['address'], ['is_seller'], ['created_at'],
    ], users, (row) => ({ ...row, is_seller: Boolean(row.is_seller) }));
    await insertRows(client, 'products', [
      ['id'], ['user_id'], ['name'], ['price'], ['default_quantity'], ['schedule_type'], ['schedule_config'], ['created_at'],
    ], products);
    await insertRows(client, 'entries', [
      ['id'], ['user_id'], ['product_id'], ['delivery_date'], ['quantity'], ['product_name'], ['unit_price'], ['updated_at'],
    ], entries);
    await insertRows(client, 'payments', [
      ['user_id'], ['payment_month'], ['amount'], ['method'], ['note'], ['updated_by'], ['updated_at'],
    ], payments);
    await insertRows(client, 'sessions', [
      ['token_hash'], ['user_id'], ['expires_at'], ['created_at'],
    ], sessions);

    if (resetSequences) {
      for (const [table, rows] of [['users', users], ['products', products], ['entries', entries]]) {
        const nextId = rows.reduce((maximum, row) => Math.max(maximum, row.id + 1), 1);
        await client.query(`ALTER TABLE ${table} ALTER COLUMN id RESTART WITH ${nextId}`);
      }
    }
    await client.query('INSERT INTO app_migrations (name) VALUES ($1)', ['sqlite-import-v1']);
    await client.query('COMMIT');
    inTransaction = false;
    return { users: users.length, sessions: sessions.length, products: products.length, entries: entries.length, payments: payments.length };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    sqlite.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const sourcePath = process.argv[2] || process.env.SQLITE_PATH || 'data/dailydrop.sqlite';
  try {
    const counts = await migrateSqliteToPostgres(sourcePath);
    console.log('SQLite import complete:', counts);
  } catch (error) {
    console.error('SQLite import failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}