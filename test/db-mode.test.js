import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = 'postgresql://user:password@ep-example.neon.tech/daily_drop?sslmode=require';

const { databaseMode, pool } = await import('../src/db.js');

after(async () => {
  await pool.end();
});

test('uses PostgreSQL locally when DATABASE_URL is configured', () => {
  assert.equal(databaseMode, 'postgres');
});
