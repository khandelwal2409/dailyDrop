import { cookieValue, hashToken, sessionCookie } from './sessions.js';
import { fail } from './http.js';

export function createAuthMiddleware({ db, statements }) {
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

  return { requireAuth, requireSeller };
}
