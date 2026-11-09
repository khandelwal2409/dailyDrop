import crypto from 'node:crypto';

export const sessionCookie = 'dailydrop_session';
export const sessionDuration = 30 * 24 * 60 * 60 * 1000;

export function cookieValue(req, name) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function setSessionCookie(res, token, isProduction) {
  const flags = [`${sessionCookie}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(sessionDuration / 1000)}`];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearSessionCookie(res, isProduction) {
  const flags = [`${sessionCookie}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export async function createSession(db, userId, res, isProduction) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + sessionDuration);
  setSessionCookie(res, token, isProduction);
}
