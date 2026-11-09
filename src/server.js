import { existsSync } from 'node:fs';
import express from 'express';
import { databaseMode, db, initializeDatabase, setSellerUsernames, statements } from './db.js';
import { migrateSqliteToPostgres } from '../scripts/migrate-sqlite-to-postgres.js';
import { createCustomerRouter } from './packages/customers/routes.js';
import { createCustomerRepository } from './packages/customers/repository.js';
import { createCustomerService } from './packages/customers/service.js';
import { createSellerRouter } from './packages/sellers/routes.js';
import { createSellerRepository } from './packages/sellers/repository.js';
import { createSellerService } from './packages/sellers/service.js';
import { createAuthMiddleware } from './shared/auth.js';
import { fail } from './shared/http.js';
import { createRateLimiter } from './shared/rate-limit.js';
import { createAuthRouter } from './routes/auth.js';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
const registrationEnabled = (process.env.ALLOW_REGISTRATION ?? 'true').toLowerCase() !== 'false';
const sellerUsernames = process.env.SELLER_USERNAMES === undefined
  ? null
  : new Set(process.env.SELLER_USERNAMES.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean));

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

const { requireAuth, requireSeller } = createAuthMiddleware({ db, statements });
const rateLimiter = createRateLimiter();
const authLimiter = rateLimiter.limit(10, 15 * 60 * 1000);
const customerRepository = createCustomerRepository({ db, statements });
const customerService = createCustomerService(customerRepository);
const sellerRepository = createSellerRepository({ db, statements });
const sellerService = createSellerService(sellerRepository, sellerUsernames);

app.use('/api',
  createAuthRouter({ db, statements, authLimiter, requireAuth, registrationEnabled, sellerUsernames, isProduction }),
  createCustomerRouter({ service: customerService, requireAuth }),
  createSellerRouter({ service: sellerService, requireAuth, requireSeller }),
);

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
  rateLimiter.cleanup();
}, 60 * 60 * 1000);
cleanup.unref();

app.listen(port, () => console.log(`DailyDrop listening on port ${port}`));
