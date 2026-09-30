import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databasePath = resolve(process.env.DB_PATH || 'data/dailydrop.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price REAL NOT NULL CHECK (price >= 0),
    default_quantity REAL NOT NULL DEFAULT 1 CHECK (default_quantity > 0),
    schedule_type TEXT NOT NULL DEFAULT 'daily',
    schedule_config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS products_user_idx ON products(user_id);
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    delivery_date TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity >= 0),
    product_name TEXT NOT NULL,
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id, delivery_date)
  );
  CREATE INDEX IF NOT EXISTS entries_user_date_idx ON entries(user_id, delivery_date);
  CREATE TABLE IF NOT EXISTS payments (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_month TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount >= 0),
    method TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, payment_month)
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}

ensureColumn('products', 'default_quantity', 'REAL NOT NULL DEFAULT 1');
ensureColumn('products', 'schedule_type', "TEXT NOT NULL DEFAULT 'daily'");
ensureColumn('products', 'schedule_config', "TEXT NOT NULL DEFAULT '{}'");
const addedEntryName = ensureColumn('entries', 'product_name', "TEXT NOT NULL DEFAULT ''");
const addedEntryPrice = ensureColumn('entries', 'unit_price', 'REAL NOT NULL DEFAULT 0');
ensureColumn('entries', 'updated_at', 'TEXT');
ensureColumn('payments', 'note', "TEXT NOT NULL DEFAULT ''");
ensureColumn('payments', 'updated_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
ensureColumn('payments', 'updated_at', 'TEXT');

if (addedEntryName || addedEntryPrice) {
  db.exec(`
    UPDATE entries SET product_name = (SELECT name FROM products WHERE products.id = entries.product_id)
    WHERE product_name = '';
    UPDATE entries SET unit_price = (SELECT price FROM products WHERE products.id = entries.product_id)
    WHERE ${addedEntryPrice ? '1 = 1' : "unit_price = 0"};
  `);
}
db.exec("UPDATE entries SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL; UPDATE payments SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;");

const productForeignKey = db.prepare('PRAGMA foreign_key_list(entries)').all()
  .some((foreignKey) => foreignKey.table === 'products');
if (productForeignKey) {
  db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
  try {
    db.exec(`
      CREATE TABLE entries_migrated (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL,
        delivery_date TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity >= 0),
        product_name TEXT NOT NULL DEFAULT '',
        unit_price REAL NOT NULL DEFAULT 0,
        updated_at TEXT,
        UNIQUE(user_id, product_id, delivery_date)
      );
      INSERT INTO entries_migrated (id, user_id, product_id, delivery_date, quantity, product_name, unit_price, updated_at)
        SELECT id, user_id, product_id, delivery_date, quantity, product_name, unit_price, updated_at FROM entries;
      DROP TABLE entries;
      ALTER TABLE entries_migrated RENAME TO entries;
      CREATE INDEX IF NOT EXISTS entries_user_date_idx ON entries(user_id, delivery_date);
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

export const statements = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, full_name, email, phone, address, is_admin, created_at FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash, password_salt, full_name, email, is_admin) VALUES (?, ?, ?, ?, ?, ?)'),
  productsForUser: db.prepare('SELECT * FROM products WHERE user_id = ? ORDER BY name COLLATE NOCASE'),
  productForUser: db.prepare('SELECT * FROM products WHERE id = ? AND user_id = ?'),
  entriesForMonth: db.prepare("SELECT * FROM entries WHERE user_id = ? AND delivery_date >= ? AND delivery_date < ? ORDER BY delivery_date, product_name"),
};

export function setAdminUsernames(usernames) {
  if (usernames === null) return;
  const update = db.prepare('UPDATE users SET is_admin = ? WHERE username = ?');
  const rows = db.prepare('SELECT username FROM users').all();
  const selected = new Set(usernames);
  db.exec('BEGIN');
  try {
    for (const row of rows) update.run(selected.has(row.username) ? 1 : 0, row.username);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}