import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/* ---------- password hashing (scrypt) ---------- */

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ---------- JWT (HS256) ---------- */

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url');

export function createToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: userId, iat: now, exp: now + TTL_SECONDS });
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const body = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- request helper ---------- */

export function authenticate(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) || null;
}

/* ---------- macro targets ---------- */

export function computeTargets({ weight_kg, height_cm, age, sex, activity_level, goal }) {
  const w = weight_kg || 70;
  const h = height_cm || 172;
  const a = age || 28;

  // Mifflin-St Jeor
  const bmr = sex === 'female' ? 10 * w + 6.25 * h - 5 * a - 161 : 10 * w + 6.25 * h - 5 * a + 5;

  const multipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, athlete: 1.9 };
  const tdee = bmr * (multipliers[activity_level] || 1.55);

  const adjust = { lose: -0.18, maintain: 0, gain: 0.12 };
  const calories = Math.round(tdee * (1 + (adjust[goal] ?? 0)));

  const protein = Math.round(w * (goal === 'lose' ? 2.2 : 1.9));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

  return { target_calories: calories, target_protein: protein, target_carbs: carbs, target_fat: fat };
}
