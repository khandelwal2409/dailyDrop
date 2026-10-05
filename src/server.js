import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import express from 'express';
import { databaseMode, db, initializeDatabase, setSellerUsernames, statements } from './db.js';
import { migrateSqliteToPostgres } from '../scripts/migrate-sqlite-to-postgres.js';

const app = express();
const scrypt = promisify(crypto.scrypt);
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
const registrationEnabled = (process.env.ALLOW_REGISTRATION ?? 'true').toLowerCase() !== 'false';
const sellerUsernames = process.env.SELLER_USERNAMES === undefined
  ? null
  : new Set(process.env.SELLER_USERNAMES.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean));
const sessionCookie = 'dailydrop_session';
const sessionDuration = 30 * 24 * 60 * 60 * 1000;
const dummySalt = Buffer.alloc(16, 7).toString('hex');
const dummyHash = await scrypt('not-a-real-password', dummySalt, 64);
const rateBuckets = new Map();

if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
app.set('trust proxy', trustProxyHops);
await initializeDatabase();
const sqliteMigrationPath = process.env.SQLITE_MIGRATION_PATH;
if (databaseMode === 'postgres' && sqliteMigrationPath && existsSync(sqliteMigrationPath)) await migrateSqliteToPostgres(sqliteMigrationPath);
await setSellerUsernames(sellerUsernames);

if (isProduction) app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '20kb', strict: true }));
app.use(express.static('public', { index: 'index.html', etag: true }));
app.get('/seller', (req, res) => res.sendFile('seller.html', { root: 'public' }));

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));
    if (bucket.count > max) return fail(res, 429, 'Too many attempts. Please try again later.');
    next();
  };
}

const authLimiter = rateLimit(10, 15 * 60 * 1000);
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function validDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validMonth(value) {
  return typeof value === 'string' && monthPattern.test(value);
}

function boundedText(value, max, { optional = false } = {}) {
  return typeof value === 'string' && (optional || value.trim().length > 0) && value.length <= max;
}

function parseProductInput(body) {
  const { name, price, defaultQuantity, scheduleType, schedule = {} } = body ?? {};
  if (!boundedText(name, 80) || !Number.isFinite(price) || price < 0 || price > 1_000_000
      || !Number.isInteger(defaultQuantity) || defaultQuantity <= 0 || defaultQuantity > 100_000) return null;
  const types = new Set(['daily', 'alternate', 'every_n', 'weekdays', 'monthly', 'on_demand']);
  if (!types.has(scheduleType) || typeof schedule !== 'object' || Array.isArray(schedule)) return null;
  if (['alternate', 'every_n'].includes(scheduleType) && !validDate(schedule.startDate)) return null;
  if (scheduleType === 'every_n' && (!Number.isInteger(schedule.interval) || schedule.interval < 2 || schedule.interval > 365)) return null;
  if (scheduleType === 'weekdays' && (!Array.isArray(schedule.weekdays) || schedule.weekdays.length < 1 || schedule.weekdays.length > 7
      || schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      || new Set(schedule.weekdays).size !== schedule.weekdays.length)) return null;
  if (scheduleType === 'monthly' && (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 31)) return null;
  return { name: name.trim(), price, defaultQuantity, scheduleType, schedule };
}

function cookieValue(req, name) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function requireAuth(req, res, next) {
  const token = cookieValue(req, sessionCookie);
  if (!token) return fail(res, 401, 'Authentication required.');
  const tokenHash = hashToken(token);
  const session = await db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now());
  if (!session) return fail(res, 401, 'Authentication required.');
  const user = await statements.userById.get(session.user_id);
  if (!user) return fail(res, 401, 'Authentication required.');
  req.user = user;
  req.sessionHash = tokenHash;
  next();
}

function requireSeller(req, res, next) {
  if (!req.user?.is_seller) return fail(res, 403, 'Seller access required.');
  next();
}

function setSessionCookie(res, token) {
  const flags = [`${sessionCookie}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(sessionDuration / 1000)}`];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function clearSessionCookie(res) {
  const flags = [`${sessionCookie}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + sessionDuration);
  setSessionCookie(res, token);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    isSeller: Boolean(user.is_seller),
    createdAt: user.created_at,
  };
}

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function entriesTotal(rows) {
  return money(rows.reduce((sum, row) => sum + (row.quantity > 0 ? row.quantity * row.unit_price : 0), 0));
}

function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  return [start, next];
}

async function monthEntries(userId, month) {
  const [start, next] = monthBounds(month);
  return statements.entriesForMonth.all(userId, start, next);
}

function paymentStatus(bill, paid) {
  if (bill === 0) return 'no-bill';
  if (paid <= 0) return 'pending';
  if (paid + 0.005 >= bill) return 'paid';
  return 'partial';
}

function sellerList() {
  return sellerUsernames === null ? null : [...sellerUsernames];
}

app.get('/api/config', (req, res) => res.json({ registrationEnabled }));

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    if (!registrationEnabled) return fail(res, 403, 'Registration is currently disabled.');
    const { username, password, fullName = '', email = '' } = req.body ?? {};
    if (typeof username !== 'string' || !usernamePattern.test(username.toLowerCase())
        || typeof password !== 'string' || password.length < 10 || password.length > 128
        || !boundedText(fullName, 100, { optional: true }) || !boundedText(email, 254, { optional: true })
        || (email && !emailPattern.test(email))) return fail(res, 400, 'Please check the registration details.');
    const normalized = username.toLowerCase();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await scrypt(password, salt, 64);
    const isSeller = sellerUsernames === null ? false : sellerUsernames.has(normalized);
    const result = await statements.insertUser.run(normalized, passwordHash.toString('hex'), salt, fullName.trim(), email.trim(), isSeller);
    const user = await statements.userById.get(Number(result.lastInsertRowid));
    await createSession(user.id, res);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === '23505' || error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return fail(res, 409, 'That username is unavailable.');
    }
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = usernamePattern.test(username) ? await statements.userByUsername.get(username) : null;
    const salt = user?.password_salt || dummySalt;
    const expected = user ? Buffer.from(user.password_hash, 'hex') : dummyHash;
    const actual = await scrypt(password.slice(0, 128), salt, 64);
    const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    if (!user || !valid || password.length > 128) return fail(res, 401, 'Invalid username or password.');
    await createSession(user.id, res);
    res.json({ user: publicUser(await statements.userById.get(user.id)) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.put('/api/me', requireAuth, async (req, res) => {
  const { fullName, email, phone, address } = req.body ?? {};
  if (!boundedText(fullName, 100, { optional: true }) || !boundedText(email, 254, { optional: true })
      || !boundedText(phone, 40, { optional: true }) || !boundedText(address, 500, { optional: true })
      || (email && !emailPattern.test(email))) return fail(res, 400, 'Please check the profile details.');
  await db.prepare('UPDATE users SET full_name = ?, email = ?, phone = ?, address = ? WHERE id = ?')
    .run(fullName.trim(), email.trim(), phone.trim(), address.trim(), req.user.id);
  res.json({ user: publicUser(await statements.userById.get(req.user.id)) });
});

app.put('/api/me/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 128) {
      return fail(res, 400, 'The new password must be between 10 and 128 characters.');
    }
    const user = await db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(req.user.id);
    const actual = await scrypt(currentPassword.slice(0, 128), user.password_salt, 64);
    const expected = Buffer.from(user.password_hash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return fail(res, 400, 'Current password is incorrect.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(newPassword, salt, 64);
    await db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash.toString('hex'), salt, req.user.id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products', requireAuth, async (req, res) => {
  const products = (await statements.productsForUser.all(req.user.id)).map((product) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    defaultQuantity: product.default_quantity,
    scheduleType: product.schedule_type,
    schedule: JSON.parse(product.schedule_config),
  }));
  res.json({ products });
});

app.post('/api/products', requireAuth, async (req, res) => {
  const product = parseProductInput(req.body);
  if (!product) return fail(res, 400, 'Please check the product and schedule details.');
  const result = await db.prepare('INSERT INTO products (user_id, name, price, default_quantity, schedule_type, schedule_config) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .run(req.user.id, product.name, product.price, product.defaultQuantity, product.scheduleType, JSON.stringify(product.schedule));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/products/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const product = parseProductInput(req.body);
  if (!Number.isSafeInteger(id) || !product) return fail(res, 400, 'Please check the product and schedule details.');
  const result = await db.prepare('UPDATE products SET name = ?, price = ?, default_quantity = ?, schedule_type = ?, schedule_config = ? WHERE id = ? AND user_id = ?')
    .run(product.name, product.price, product.defaultQuantity, product.scheduleType, JSON.stringify(product.schedule), id, req.user.id);
  if (!result.changes) return fail(res, 404, 'Product not found.');
  res.json({ ok: true });
});

app.delete('/api/products/:id', requireAuth, async (req, res) => {
  const result = await db.prepare('DELETE FROM products WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!result.changes) return fail(res, 404, 'Product not found.');
  res.json({ ok: true });
});

app.get('/api/entries', requireAuth, async (req, res) => {
  const month = req.query.month;
  if (!validMonth(month)) return fail(res, 400, 'Month must use YYYY-MM format.');
  res.json({ entries: await monthEntries(req.user.id, month) });
});

app.put('/api/entries/:date/:productId', requireAuth, async (req, res) => {
  const { date } = req.params;
  const productId = Number(req.params.productId);
  const quantity = req.body?.quantity;
  const hasUnitPrice = Object.hasOwn(req.body ?? {}, 'unitPrice');
  const unitPrice = req.body?.unitPrice;
  if (!validDate(date) || !Number.isSafeInteger(productId) || !Number.isInteger(quantity) || quantity < 0 || quantity > 100_000
      || (hasUnitPrice && (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000))) {
    return fail(res, 400, 'Please provide a valid date and quantity.');
  }
  const product = await statements.productForUser.get(productId, req.user.id);
  if (!product) return fail(res, 404, 'Product not found.');
  const previous = await db.prepare('SELECT * FROM entries WHERE user_id = ? AND product_id = ? AND delivery_date = ?').get(req.user.id, productId, date);
  const priceForEntry = hasUnitPrice ? unitPrice : previous?.unit_price ?? product.price;
  await db.prepare(`INSERT INTO entries (user_id, product_id, delivery_date, quantity, product_name, unit_price)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, product_id, delivery_date) DO UPDATE SET
    quantity = excluded.quantity, product_name = CASE WHEN entries.product_name = '' THEN excluded.product_name ELSE entries.product_name END,
    unit_price = excluded.unit_price,
    updated_at = CURRENT_TIMESTAMP`)
    .run(req.user.id, productId, date, quantity, previous?.product_name || product.name, priceForEntry);
  res.json({ ok: true });
});

app.delete('/api/entries/:date/:productId', requireAuth, async (req, res) => {
  if (!validDate(req.params.date) || !Number.isSafeInteger(Number(req.params.productId))) return fail(res, 400, 'Please provide a valid date and product.');
  await db.prepare('DELETE FROM entries WHERE user_id = ? AND product_id = ? AND delivery_date = ?')
    .run(req.user.id, Number(req.params.productId), req.params.date);
  res.json({ ok: true });
});

app.get('/api/reports/monthly-totals', requireAuth, async (req, res) => {
  const to = req.query.to;
  const months = req.query.months === undefined ? 6 : Number(req.query.months);
  if (!validMonth(to) || !Number.isInteger(months) || months < 1 || months > 24) return fail(res, 400, 'Use a valid month and a month count from 1 to 24.');
  const [year, month] = to.split('-').map(Number);
  const totals = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const entries = await monthEntries(req.user.id, key);
    totals.push({ month: key, total: entriesTotal(entries), deliveries: entries.filter((entry) => entry.quantity > 0).length,
      missed: entries.filter((entry) => entry.quantity === 0).length });
  }
  res.json({ totals });
});

app.get('/api/payments/:month', requireAuth, async (req, res) => {
  if (!validMonth(req.params.month)) return fail(res, 400, 'Month must use YYYY-MM format.');
  const payment = await db.prepare('SELECT payment_month AS month, amount, method, note, updated_at AS "updatedAt" FROM payments WHERE user_id = ? AND payment_month = ?')
    .get(req.user.id, req.params.month) ?? null;
  const bill = entriesTotal(await monthEntries(req.user.id, req.params.month));
  res.json({ payment, bill, status: paymentStatus(bill, payment?.amount ?? 0) });
});

app.get('/api/seller/overview', requireAuth, requireSeller, async (req, res) => {
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const counts = await db.prepare(`SELECT COUNT(*) AS users,
    (SELECT COUNT(*) FROM products) AS products,
    (SELECT COUNT(*) FROM entries WHERE delivery_date >= ?) AS monthEntries
    FROM users`).get(monthStart);
  res.json({ users: Number(counts.users), products: Number(counts.products), monthEntries: Number(counts.monthentries), sellers: sellerList() });
});

app.get('/api/seller/bills', requireAuth, requireSeller, async (req, res) => {
  const month = req.query.month;
  if (!validMonth(month)) return fail(res, 400, 'Month must use YYYY-MM format.');
  const [start, next] = monthBounds(month);
  const users = await db.prepare('SELECT id, username, full_name FROM users ORDER BY lower(username)').all();
  const subscriptions = await db.prepare(`SELECT user_id, name, default_quantity, schedule_type, schedule_config
    FROM products ORDER BY user_id, lower(name)`).all();
  const entries = await db.prepare(`SELECT user_id, product_id, product_name, unit_price, quantity, delivery_date
    FROM entries WHERE delivery_date >= ? AND delivery_date < ? ORDER BY user_id, product_name, delivery_date`).all(start, next);
  const payments = await db.prepare('SELECT user_id, amount, method, note, updated_at AS "updatedAt" FROM payments WHERE payment_month = ?').all(month);
  const paymentByUser = new Map(payments.map((payment) => [payment.user_id, payment]));
  const subscriptionsByUser = new Map();
  for (const product of subscriptions) {
    const userProducts = subscriptionsByUser.get(product.user_id) ?? [];
    userProducts.push({ name: product.name, defaultQuantity: product.default_quantity, scheduleType: product.schedule_type, schedule: JSON.parse(product.schedule_config) });
    subscriptionsByUser.set(product.user_id, userProducts);
  }
  const rows = users.map((user) => {
    const userEntries = entries.filter((entry) => entry.user_id === user.id);
    const groups = new Map();
    for (const entry of userEntries) {
      const key = `${entry.product_id}:${entry.product_name}`;
      const group = groups.get(key) ?? { product: entry.product_name, quantity: 0, amount: 0 };
      group.quantity += entry.quantity;
      if (entry.quantity > 0) group.amount += entry.quantity * entry.unit_price;
      groups.set(key, group);
    }
    const products = [...groups.values()].map((group) => ({ ...group, amount: money(group.amount) }));
    const bill = money(products.reduce((sum, product) => sum + product.amount, 0));
    const payment = paymentByUser.get(user.id) ?? null;
    const paid = payment?.amount ?? 0;
    return { userId: user.id, username: user.username, fullName: user.full_name, subscriptions: subscriptionsByUser.get(user.id) ?? [], products, bill, payment, paid, outstanding: money(Math.max(0, bill - paid)), status: paymentStatus(bill, paid) };
  });
  res.json({ month, rows, totals: {
    billed: money(rows.reduce((sum, row) => sum + row.bill, 0)),
    collected: money(rows.reduce((sum, row) => sum + row.paid, 0)),
    outstanding: money(rows.reduce((sum, row) => sum + row.outstanding, 0)),
  } });
});

app.put('/api/seller/payments/:userId/:month', requireAuth, requireSeller, async (req, res) => {
  const userId = Number(req.params.userId);
  const { amount, method, note = '' } = req.body ?? {};
  const methods = new Set(['Cash', 'UPI', 'Card', 'Bank transfer', 'Other']);
  if (!Number.isSafeInteger(userId) || !validMonth(req.params.month) || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000
      || !methods.has(method) || !boundedText(note, 300, { optional: true })) return fail(res, 400, 'Please check the payment details.');
  if (!await statements.userById.get(userId)) return fail(res, 404, 'User not found.');
  await db.prepare(`INSERT INTO payments (user_id, payment_month, amount, method, note, updated_by)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id,payment_month) DO UPDATE SET
    amount = excluded.amount, method = excluded.method, note = excluded.note, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
    .run(userId, req.params.month, amount, method, note.trim(), req.user.id);
  res.json({ ok: true });
});

app.delete('/api/seller/payments/:userId/:month', requireAuth, requireSeller, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || !validMonth(req.params.month)) return fail(res, 400, 'Please provide a valid user and month.');
  await db.prepare('DELETE FROM payments WHERE user_id = ? AND payment_month = ?').run(userId, req.params.month);
  res.json({ ok: true });
});

app.use('/api', (req, res) => fail(res, 404, 'API route not found.'));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.status === 413) return fail(res, 413, 'Request body must be 20 KB or smaller.');
  if (error.status === 400 && error.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON body.');
  if (error instanceof SyntaxError && 'body' in error) return fail(res, 400, 'Invalid JSON body.');
  console.error(error);
  return fail(res, 500, 'Something went wrong. Please try again.');
});

const cleanup = setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).catch((error) => console.error('Session cleanup failed:', error));
  if (rateBuckets.size > 10000) {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 60 * 60 * 1000);
cleanup.unref();

app.listen(port, () => console.log(`DailyDrop listening on port ${port}`));