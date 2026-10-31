import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as oidc from 'openid-client';
import { db, uuid, now, UPLOAD_DIR } from './db.js';
import { rateLimiter } from './security.js';
import { sendResetEmail, emailConfigured } from './email.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'rb_session';
const SESSION_DAYS = 30;
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const env = (k, d = '') => (process.env[k] ?? d).trim();
const flag = (k, d) => { const v = env(k, d ? 'true' : 'false').toLowerCase(); return v === 'true' || v === '1' || v === 'yes'; };
const ALLOW_SIGNUP = flag('ALLOW_SIGNUP', false);

const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };

/* ---------- Passwords & sessions ---------- */

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Used when the account doesn't exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = `scrypt$${randomBytes(16).toString('base64')}$${randomBytes(64).toString('base64')}`;

async function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || DUMMY_HASH).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function createSession(userId, req) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), userId, now(), expires, String(req.get('User-Agent') || '').slice(0, 200));
  return token;
}

function setCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  const value = token ? `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}` : `${COOKIE}=; Max-Age=0`;
  res.append('Set-Cookie', `${value}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function readToken(req) {
  const auth = req.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const m = (req.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (m) return m[1];
  // <img>/download links in the Android app can't send headers, so GETs may pass the token in the URL.
  if (req.method === 'GET' && typeof req.query.access_token === 'string') return req.query.access_token;
  return null;
}

// Pass `viewer` to hide other people's email addresses from non-admins.
export function publicUser(u, viewer) {
  if (!u) return null;
  const showEmail = !viewer || viewer.id === u.id || viewer.role === 'admin';
  return {
    id: u.id, username: u.username, display_name: u.display_name, email: showEmail ? u.email || '' : '',
    avatar: u.avatar || '', role: u.role, has_password: !!u.password_hash, oidc: !!u.oidc_sub,
  };
}

function loadUser(req, res, next) {
  const token = readToken(req);
  if (token?.startsWith('rb_')) {
    // Personal API token (see server/integrations.js); never expires, revocable in Settings.
    const row = db.prepare('SELECT t.id AS tid, u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(sha256(token));
    if (row) {
      req.user = row;
      req.apiToken = row.tid;
      req.who = { name: row.display_name, id: row.id };
      db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.tid);
    }
  } else if (token) {
    const row = db.prepare(`SELECT s.id AS sid, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha256(token));
    if (row && row.expires_at > now()) {
      req.user = row;
      req.sessionId = row.sid;
      req.who = { name: row.display_name, id: row.id };
      // Sliding expiry: extend once a day of use.
      if (new Date(row.expires_at).getTime() - Date.now() < (SESSION_DAYS - 1) * 864e5) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), row.sid);
        // Refresh the browser cookie too, or it still expires 30 days after sign-in however active you are.
        if (!(req.get('Authorization') || '').startsWith('Bearer ')) setCookie(req, res, token);
      }
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) fail(401, 'Not signed in');
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) fail(401, 'Not signed in');
  if (req.user.role !== 'admin') fail(403, 'Admins only');
  next();
}

/* ---------- Validation ---------- */

const cleanUsername = (v) => String(v || '').trim().toLowerCase();
function checkUsername(u) {
  if (!/^[a-z0-9._-]{2,32}$/.test(u)) fail(400, 'Username must be 2-32 characters: letters, numbers, dot, dash or underscore');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) fail(409, 'That username is taken');
}
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) fail(400, 'Password must be at least 8 characters');
  if (p.length > 200) fail(400, 'Password is too long');
  // Phone keyboards add a trailing space after a word; a password that can't be retyped locks people out.
  if (p !== p.trim()) fail(400, 'Password cannot start or end with a space');
}
// Validates a new sign-in name for a user; returns it, or null when it is unchanged.
function newUsername(v, user) {
  const name = cleanUsername(v);
  if (name === user.username.toLowerCase()) return null;
  checkUsername(name);
  return name;
}
const cleanName = (v, fallback) => String(v || '').trim().slice(0, 60) || fallback;
const cleanEmail = (v) => {
  const e = String(v || '').trim().slice(0, 200);
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'That email address looks wrong');
  return e || null;
};
// Raccoon avatars are 'raccoon:<n>'; uploaded photos are 'photo:<file>' and set via the upload route only.
const cleanAvatar = (v) => {
  const a = String(v || '');
  if (a === '' || /^raccoon:\d{1,2}$/.test(a)) return a || null;
  fail(400, 'Unknown avatar');
};

async function createUser({ username, display_name, password, role = 'user', email = null, oidc_issuer = null, oidc_sub = null, avatar = null, onlyIfFirst = false }) {
  const id = uuid();
  const hash = password ? await hashPassword(password) : null;
  // Re-check after the (slow, async) hash so two simultaneous first-run setups can't both become admin.
  if (onlyIfFirst && userCount() > 0) fail(409, 'Setup is already done');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is taken');
  db.prepare(`INSERT INTO users (id, username, display_name, email, password_hash, avatar, role, oidc_issuer, oidc_sub, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, username, display_name, email, hash, avatar, role, oidc_issuer, oidc_sub, now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const adminCount = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;

function signIn(req, res, user) {
  const token = createSession(user.id, req);
  setCookie(req, res, token);
  return { user: publicUser(user), token };
}

// In-memory brakes on password guessing: 10 failures per 15 minutes per IP+username,
// and 50 per IP across all usernames (stops spraying one password at many accounts).
const failures = rateLimiter({ windowMs: 15 * 60e3, max: 10 });
const ipFailures = rateLimiter({ windowMs: 15 * 60e3, max: 50 });
const tooMany = () => fail(429, 'Too many attempts. Try again in a few minutes.');
function throttle(req, key) {
  if (failures.blocked(key) || ipFailures.blocked(req.ip)) tooMany();
}
function recordFailure(req, key) {
  failures.hit(key);
  ipFailures.hit(req.ip);
}

// Expired sessions and reset links are cleared hourly.
function purgeExpired() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(now());
}
purgeExpired();
setInterval(purgeExpired, 60 * 60e3).unref();

/* ---------- OIDC ---------- */

const OIDC_ISSUER = env('OIDC_ISSUER');
const OIDC_ENABLED = !!(OIDC_ISSUER && env('OIDC_CLIENT_ID'));
const OIDC_NAME = env('OIDC_NAME', 'Single sign-on');
let oidcConfig = null;
const pending = new Map(); // state -> { verifier, returnTo, expires }

async function getOidc() {
  if (!oidcConfig) {
    const secret = env('OIDC_CLIENT_SECRET');
    oidcConfig = await oidc.discovery(
      new URL(OIDC_ISSUER), env('OIDC_CLIENT_ID'), secret || undefined,
      secret ? oidc.ClientSecretPost(secret) : oidc.None(),
      OIDC_ISSUER.startsWith('http:') ? { execute: [oidc.allowInsecureRequests] } : undefined,
    );
  }
  return oidcConfig;
}

function redirectUri(req) {
  if (env('OIDC_REDIRECT_URI')) return env('OIDC_REDIRECT_URI');
  const base = env('PUBLIC_URL') || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/api/auth/oidc/callback`;
}

async function uniqueUsername(wanted) {
  const base = cleanUsername(wanted).replace(/[^a-z0-9._-]/g, '').slice(0, 28) || 'user';
  let name = base.length >= 2 ? base : `${base}user`;
  for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(name); i++) name = `${base}${i}`;
  return name;
}

/* ---------- Routes ---------- */

export const authRouter = express.Router();
authRouter.use(loadUser);

authRouter.get('/auth/status', (req, res) => {
  res.json({
    setupRequired: userCount() === 0,
    user: publicUser(req.user),
    signup: ALLOW_SIGNUP,
    forgot: emailConfigured(),
    oidc: { enabled: OIDC_ENABLED, name: OIDC_NAME },
  });
});

// First run: the first account becomes the admin.
authRouter.post('/auth/setup', async (req, res) => {
  if (userCount() > 0) fail(409, 'Setup is already done');
  const username = cleanUsername(req.body.username);
  checkUsername(username);
  checkPassword(req.body.password);
  const user = await createUser({
    onlyIfFirst: true,
    username, password: req.body.password, role: 'admin',
    display_name: cleanName(req.body.display_name, username), email: cleanEmail(req.body.email),
  });
  db.prepare('UPDATE boards SET owner_id = ? WHERE owner_id IS NULL').run(user.id);
  res.status(201).json(signIn(req, res, user));
});

authRouter.post('/auth/signup', async (req, res) => {
  if (!ALLOW_SIGNUP) fail(403, 'Sign-up is turned off. Ask an admin for an account.');
  const username = cleanUsername(req.body.username);
  checkUsername(username);
  checkPassword(req.body.password);
  const user = await createUser({ username, password: req.body.password, display_name: cleanName(req.body.display_name, username), email: cleanEmail(req.body.email) });
  res.status(201).json(signIn(req, res, user));
});

authRouter.post('/auth/login', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const key = `${req.ip}|${username}`;
  throttle(req, key);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  const ok = await verifyPassword(password, user?.password_hash) && !!user?.password_hash;
  if (!ok) { recordFailure(req, key); fail(401, 'Wrong username or password'); }
  failures.clear(key);
  res.json(signIn(req, res, user));
});

authRouter.post('/auth/logout', (req, res) => {
  if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  setCookie(req, res, null);
  res.status(204).end();
});

authRouter.get('/auth/me', requireUser, (req, res) => res.json(publicUser(req.user)));

authRouter.patch('/auth/me', requireUser, async (req, res) => {
  const b = req.body;
  const u = req.user;
  const sets = {};
  if ('display_name' in b) sets.display_name = cleanName(b.display_name, u.display_name);
  if ('username' in b) { const name = newUsername(b.username, u); if (name) sets.username = name; }
  if ('email' in b) sets.email = cleanEmail(b.email);
  if ('avatar' in b) {
    sets.avatar = cleanAvatar(b.avatar);
    removePhoto(u.avatar);
  }
  if (b.new_password) {
    checkPassword(b.new_password);
    // OIDC-only accounts may set a first password (for the Android app) without a current one.
    if (u.password_hash && !(await verifyPassword(String(b.current_password || ''), u.password_hash))) fail(400, 'Current password is wrong');
    sets.password_hash = await hashPassword(b.new_password);
    // Sign out other devices when the password changes.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(u.id, req.sessionId);
  }
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => sets[k]), u.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

function removePhoto(avatar) {
  if (avatar?.startsWith('photo:')) fs.rm(path.join(AVATAR_DIR, path.basename(avatar.split(':')[1])), { force: true }, () => {});
}

const photoUpload = multer({
  storage: multer.diskStorage({ destination: AVATAR_DIR, filename: (_req, _f, cb) => cb(null, uuid()) }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)),
});

authRouter.post('/auth/me/photo', requireUser, photoUpload.single('photo'), (req, res) => {
  if (!req.file) fail(400, 'Choose a PNG, JPEG, WebP or GIF image');
  removePhoto(req.user.avatar);
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(`photo:${req.file.filename}:${req.file.mimetype}`, req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

authRouter.get('/users/:id/photo', requireUser, (req, res) => {
  const u = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.params.id);
  if (!u?.avatar?.startsWith('photo:')) fail(404, 'No photo');
  const [, file, mime] = u.avatar.split(':');
  res.type(mime || 'image/png');
  res.set('Cache-Control', 'private, max-age=300');
  res.sendFile(path.join(AVATAR_DIR, path.basename(file)));
});

// Everyone signed in can see who else is here (for comments, members and sharing).
authRouter.get('/users', requireUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY display_name COLLATE NOCASE').all().map((u) => publicUser(u, req.user)));
});

authRouter.post('/users', requireAdmin, async (req, res) => {
  const username = cleanUsername(req.body.username);
  checkUsername(username);
  checkPassword(req.body.password);
  const user = await createUser({
    username, password: req.body.password, role: req.body.role === 'admin' ? 'admin' : 'user',
    display_name: cleanName(req.body.display_name, username), email: cleanEmail(req.body.email),
  });
  res.status(201).json(publicUser(user));
});

authRouter.patch('/users/:id', requireAdmin, async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) || fail(404, 'User not found');
  if ('role' in req.body) {
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    if (u.role === 'admin' && role !== 'admin' && adminCount() <= 1) fail(400, 'There must be at least one admin');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
  }
  if ('display_name' in req.body) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(cleanName(req.body.display_name, u.display_name), u.id);
  if ('username' in req.body) {
    const name = newUsername(req.body.username, u);
    if (name) db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, u.id);
  }
  if (req.body.password) {
    checkPassword(req.body.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    failures.clearMatching((key) => key.endsWith(`|${u.username.toLowerCase()}`));
  }
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

authRouter.delete('/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) || fail(404, 'User not found');
  if (u.id === req.user.id) fail(400, "You can't delete your own account");
  if (u.role === 'admin' && adminCount() <= 1) fail(400, 'There must be at least one admin');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  removePhoto(u.avatar);
  res.status(204).end();
});

/* ----- Forgot password (needs email set up) ----- */

const RESET_MINUTES = 30;
const resetRequests = rateLimiter({ windowMs: 60 * 60e3, max: 5 });

// Always answers the same way, so it can't be used to find out which accounts or emails exist.
authRouter.post('/auth/forgot', async (req, res) => {
  if (!emailConfigured()) fail(400, 'Email is not set up on this server. Ask an admin to reset your password.');
  const who = String(req.body.username || '').trim().toLowerCase().slice(0, 200);
  if (!who) fail(400, 'Enter your username or email');
  if (resetRequests.blocked(req.ip) || resetRequests.blocked(who)) tooMany();
  resetRequests.hit(req.ip);
  resetRequests.hit(who);
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ? COLLATE NOCASE').get(who, who);
  if (user?.email) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), user.id, now(), new Date(Date.now() + RESET_MINUTES * 60e3).toISOString());
    const base = (env('PUBLIC_URL') || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    // Don't wait on the mail server, and don't reveal failures to the requester.
    sendResetEmail(user, `${base}/#/reset/${token}`, RESET_MINUTES).catch((e) => console.error('Password reset email failed:', e.message));
  }
  res.json({ ok: true });
});

authRouter.post('/auth/reset', async (req, res) => {
  const token = String(req.body.token || '');
  if (resetRequests.blocked(req.ip)) tooMany();
  const row = token && db.prepare('SELECT * FROM password_resets WHERE id = ?').get(sha256(token));
  if (!row || row.expires_at < now()) { resetRequests.hit(req.ip); fail(400, 'This reset link has expired or was already used. Ask for a new one.'); }
  checkPassword(req.body.password);
  const hash = await hashPassword(req.body.password);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) || fail(400, 'This reset link is no longer valid');
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  })();
  failures.clearMatching((key) => key.endsWith(`|${user.username.toLowerCase()}`));
  res.json(signIn(req, res, user));
});

/* ----- OIDC (authorization code + PKCE) ----- */

authRouter.get('/auth/oidc/start', async (req, res) => {
  if (!OIDC_ENABLED) fail(404, 'Single sign-on is not configured');
  const config = await getOidc();
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const ret = String(req.query.return || '/');
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  if (pending.size > 1000) fail(429, 'Too many sign-ins in progress. Try again in a few minutes.');
  pending.set(state, { verifier, returnTo: ret.startsWith('/') && !ret.startsWith('//') && !ret.includes('\\') ? ret : '/', expires: Date.now() + 10 * 60e3 });
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(req),
    scope: env('OIDC_SCOPES', 'openid profile email'),
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  });
  res.redirect(url.href);
});

authRouter.get('/auth/oidc/callback', async (req, res) => {
  if (!OIDC_ENABLED) fail(404, 'Single sign-on is not configured');
  const p = pending.get(String(req.query.state || ''));
  if (!p || p.expires < Date.now()) return res.redirect('/#/login?error=' + encodeURIComponent('Sign-in expired, please try again'));
  pending.delete(String(req.query.state));
  try {
    const config = await getOidc();
    const current = new URL(redirectUri(req));
    current.search = new URLSearchParams(req.query).toString();
    const tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: p.verifier, expectedState: req.query.state });
    const claims = tokens.claims();
    const issuer = config.serverMetadata().issuer;
    let user = db.prepare('SELECT * FROM users WHERE oidc_issuer = ? AND oidc_sub = ?').get(issuer, claims.sub);
    const email = typeof claims.email === 'string' ? claims.email : null;
    if (!user && email && claims.email_verified === true && flag('OIDC_LINK_BY_EMAIL', true)) {
      // Link an existing local account that has the same verified email.
      user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND oidc_sub IS NULL').get(email);
      if (user) db.prepare('UPDATE users SET oidc_issuer = ?, oidc_sub = ? WHERE id = ?').run(issuer, claims.sub, user.id);
    }
    if (!user) {
      if (!flag('OIDC_AUTO_CREATE', true)) throw new Error('No account is linked to this sign-in. Ask an admin to create one.');
      user = await createUser({
        username: await uniqueUsername(claims.preferred_username || email?.split('@')[0] || claims.sub),
        display_name: cleanName(claims.name || claims.preferred_username, 'New user'),
        email, role: userCount() === 0 ? 'admin' : 'user', oidc_issuer: issuer, oidc_sub: claims.sub,
      });
    }
    signIn(req, res, user);
    res.redirect(`/#${p.returnTo}`);
  } catch (e) {
    console.error('OIDC sign-in failed:', e.message);
    res.redirect('/#/login?error=' + encodeURIComponent(e.message || 'Sign-in failed'));
  }
});
