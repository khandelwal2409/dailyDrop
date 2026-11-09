import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const dummySalt = Buffer.alloc(16, 7).toString('hex');
const dummyHash = await scrypt('not-a-real-password', dummySalt, 64);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString('hex') };
}

export async function verifyPassword(password, user) {
  const salt = user?.password_salt || dummySalt;
  const expected = user ? Buffer.from(user.password_hash, 'hex') : dummyHash;
  const actual = await scrypt(password.slice(0, 128), salt, 64);
  const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  return Boolean(user && valid);
}
