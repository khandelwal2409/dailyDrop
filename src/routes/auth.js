import express from 'express';
import { fail } from '../shared/http.js';
import { hashPassword, verifyPassword } from '../shared/passwords.js';
import { clearSessionCookie, createSession } from '../shared/sessions.js';
import { publicUser } from '../shared/users.js';
import { boundedText, emailPattern, usernamePattern } from '../shared/validation.js';

export function createAuthRouter({
  db,
  statements,
  authLimiter,
  requireAuth,
  registrationEnabled,
  sellerUsernames,
  isProduction,
}) {
  const router = express.Router();

  router.get('/config', (req, res) => res.json({ registrationEnabled }));

  router.post('/auth/register', authLimiter, async (req, res, next) => {
    try {
      if (!registrationEnabled) return fail(res, 403, 'Registration is currently disabled.');
      const { username, password, fullName = '', email = '' } = req.body ?? {};
      if (typeof username !== 'string' || !usernamePattern.test(username.toLowerCase())
          || typeof password !== 'string' || password.length < 10 || password.length > 128
          || !boundedText(fullName, 100, { optional: true }) || !boundedText(email, 254, { optional: true })
          || (email && !emailPattern.test(email))) return fail(res, 400, 'Please check the registration details.');
      const normalized = username.toLowerCase();
      const { salt, hash } = await hashPassword(password);
      const isSeller = sellerUsernames === null ? false : sellerUsernames.has(normalized);
      const result = await statements.insertUser.run(normalized, hash, salt, fullName.trim(), email.trim(), isSeller);
      const user = await statements.userById.get(Number(result.lastInsertRowid));
      await createSession(db, user.id, res, isProduction);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error.code === '23505' || error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return fail(res, 409, 'That username is unavailable.');
      }
      next(error);
    }
  });

  router.post('/auth/login', authLimiter, async (req, res, next) => {
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const user = usernamePattern.test(username) ? await statements.userByUsername.get(username) : null;
      if (!await verifyPassword(password, user) || password.length > 128) return fail(res, 401, 'Invalid username or password.');
      await createSession(db, user.id, res, isProduction);
      res.json({ user: publicUser(await statements.userById.get(user.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', requireAuth, async (req, res) => {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    clearSessionCookie(res, isProduction);
    res.json({ ok: true });
  });

  return router;
}
