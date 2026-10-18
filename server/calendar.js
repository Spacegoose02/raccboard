import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';
import { boardRole } from './access.js';
import { buildIcs, datedEvents, PUBLIC_URL, toEvent } from './dates.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const baseUrl = (req) => PUBLIC_URL() || `${req.protocol}://${req.get('host')}`;

/* ---------- Calendar feed (subscribe from Google, Apple, Outlook…) ---------- */

// Public, authenticated only by the secret token in the URL.
export const feedRouter = express.Router();
feedRouter.get('/ical/:file', (req, res) => {
  const token = String(req.params.file).replace(/\.ics$/, '');
  const user = token.length >= 20 && db.prepare('SELECT * FROM users WHERE ical_token = ?').get(token);
  if (!user) fail(404, 'Calendar not found');
  const events = datedEvents({ user }).map(toEvent);
  res.type('text/calendar; charset=utf-8');
  res.set('Cache-Control', 'private, max-age=300');
  res.send(buildIcs(events, `Raccboard · ${user.display_name}`));
});

export const calendarRouter = express.Router();

function feedUrl(req, token) {
  return `${baseUrl(req)}/api/ical/${token}.ics`;
}

calendarRouter.get('/calendar/feed', (req, res) => {
  let token = req.user.ical_token;
  if (!token) {
    token = randomBytes(24).toString('base64url');
    db.prepare('UPDATE users SET ical_token = ? WHERE id = ?').run(token, req.user.id);
  }
  res.json({ url: feedUrl(req, token) });
});

calendarRouter.post('/calendar/feed/reset', (req, res) => {
  const token = randomBytes(24).toString('base64url');
  db.prepare('UPDATE users SET ical_token = ? WHERE id = ?').run(token, req.user.id);
  res.json({ url: feedUrl(req, token) });
});

/* ---------- Google Calendar sync (one way: Raccboard → Google) ---------- */

const env = (k, d = '') => (process.env[k] ?? d).trim();
const G = {
  clientId: () => env('GOOGLE_CLIENT_ID'),
  clientSecret: () => env('GOOGLE_CLIENT_SECRET'),
  authUrl: () => env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
  tokenUrl: () => env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
  revokeUrl: () => env('GOOGLE_REVOKE_URL', 'https://oauth2.googleapis.com/revoke'),
  userinfoUrl: () => env('GOOGLE_USERINFO_URL', 'https://openidconnect.googleapis.com/v1/userinfo'),
  api: () => env('GOOGLE_API_BASE', 'https://www.googleapis.com/calendar/v3'),
};
const configured = () => !!(G.clientId() && G.clientSecret());
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const TZ = () => env('TZ') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const pendingStates = new Map(); // state -> { userId, expires }
const account = (userId) => db.prepare('SELECT * FROM google_accounts WHERE user_id = ?').get(userId);
const redirectUri = (req) => env('GOOGLE_REDIRECT_URI') || `${baseUrl(req)}/api/google/callback`;

async function tokenRequest(params) {
  const res = await fetch(G.tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: G.clientId(), client_secret: G.clientSecret(), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error_description || body.error || `Google token error ${res.status}`), { code: body.error });
  return body;
}

async function accessToken(acc) {
  if (acc.access_token && acc.expires_at > Date.now() + 60e3) return acc.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: acc.refresh_token });
  const expires = Date.now() + (t.expires_in || 3600) * 1000;
  db.prepare('UPDATE google_accounts SET access_token = ?, expires_at = ? WHERE user_id = ?').run(t.access_token, expires, acc.user_id);
  acc.access_token = t.access_token;
  acc.expires_at = expires;
  return t.access_token;
}

// Calls the Calendar API; refreshes the token once on 401.
async function gapi(acc, method, path, body, retried = false) {
  const res = await fetch(`${G.api()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(acc)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    acc.expires_at = 0;
    return gapi(acc, method, path, body, true);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `Google Calendar error ${res.status}`), { status: res.status });
  return data;
}

function googleBody(e) {
  const when = e.allDay
    ? { start: { date: e.start }, end: { date: e.end } }
    : { start: { dateTime: `${e.start}:00`, timeZone: TZ() }, end: { dateTime: `${e.end}:00`, timeZone: TZ() } };
  return {
    summary: e.title,
    description: e.description,
    ...when,
    ...(e.url ? { source: { title: 'Raccboard', url: e.url } } : {}),
    extendedProperties: { private: { rackboardUid: e.uid } },
  };
}

const running = new Map(); // userId -> promise, so syncs for one user never overlap

export function syncUser(userId) {
  if (running.has(userId)) return running.get(userId).then(() => syncUser(userId));
  const p = doSync(userId).finally(() => running.delete(userId));
  running.set(userId, p);
  return p;
}

async function doSync(userId) {
  const acc = account(userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!acc || !user || !acc.calendar_id) return { created: 0, updated: 0, deleted: 0 };
  const stats = { created: 0, updated: 0, deleted: 0 };
  try {
    // Only boards the user picked and can still open.
    const boardIds = JSON.parse(acc.board_ids || '[]').filter((id) => boardRole(id, user));
    const desired = new Map(datedEvents({ boardIds }).map(toEvent).map((e) => [e.uid, e]));
    const mapped = new Map(db.prepare('SELECT * FROM google_events WHERE user_id = ?').all(userId).map((m) => [m.uid, m]));
    const cal = (id) => `/calendars/${encodeURIComponent(id)}/events`;
    const save = db.prepare(`INSERT INTO google_events (user_id, uid, calendar_id, event_id, hash) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, uid) DO UPDATE SET calendar_id = excluded.calendar_id, event_id = excluded.event_id, hash = excluded.hash`);
    const forget = db.prepare('DELETE FROM google_events WHERE user_id = ? AND uid = ?');

    // Remove events that no longer exist here, or that live in a calendar the user switched away from.
    for (const m of mapped.values()) {
      if (desired.has(m.uid) && m.calendar_id === acc.calendar_id) continue;
      try { await gapi(acc, 'DELETE', `${cal(m.calendar_id)}/${encodeURIComponent(m.event_id)}`); } catch (e) { if (![404, 410].includes(e.status)) throw e; }
      forget.run(userId, m.uid);
      mapped.delete(m.uid);
      stats.deleted++;
    }
    for (const e of desired.values()) {
      const body = googleBody(e);
      const hash = createHash('sha1').update(JSON.stringify(body)).digest('hex');
      const m = mapped.get(e.uid);
      if (m && m.hash === hash) continue;
      if (m) {
        try {
          await gapi(acc, 'PATCH', `${cal(acc.calendar_id)}/${encodeURIComponent(m.event_id)}`, body);
          save.run(userId, e.uid, acc.calendar_id, m.event_id, hash);
          stats.updated++;
          continue;
        } catch (err) {
          if (![404, 410].includes(err.status)) throw err; // deleted in Google: create it again
        }
      }
      const created = await gapi(acc, 'POST', cal(acc.calendar_id), body);
      save.run(userId, e.uid, acc.calendar_id, created.id, hash);
      stats.created++;
    }
    db.prepare('UPDATE google_accounts SET last_sync = ?, last_error = NULL WHERE user_id = ?').run(new Date().toISOString(), userId);
  } catch (e) {
    const msg = e.code === 'invalid_grant' ? 'Google access was revoked. Disconnect and connect again.' : e.message;
    db.prepare('UPDATE google_accounts SET last_error = ? WHERE user_id = ?').run(msg, userId);
    console.error(`Google sync failed for ${user.username}:`, msg);
  }
  return stats;
}

// Debounced sync for everyone connected, after changes and every 10 minutes.
let timer = null;
export function scheduleGoogleSync(delay = 4000) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    for (const { user_id } of db.prepare('SELECT user_id FROM google_accounts WHERE calendar_id IS NOT NULL').all()) {
      await syncUser(user_id);
    }
  }, delay);
}
setInterval(() => scheduleGoogleSync(0), 10 * 60e3).unref();

function status(userId) {
  const acc = account(userId);
  return {
    configured: configured(),
    connected: !!acc,
    email: acc?.email || '',
    calendar_id: acc?.calendar_id || '',
    calendar_name: acc?.calendar_name || '',
    board_ids: acc ? JSON.parse(acc.board_ids || '[]') : [],
    last_sync: acc?.last_sync || null,
    last_error: acc?.last_error || null,
    synced_events: acc ? db.prepare('SELECT COUNT(*) AS n FROM google_events WHERE user_id = ?').get(userId).n : 0,
  };
}

calendarRouter.get('/google/status', (req, res) => res.json(status(req.user.id)));

calendarRouter.get('/google/connect', (req, res) => {
  if (!configured()) fail(404, 'Google Calendar is not configured on this server');
  const state = randomBytes(16).toString('base64url');
  pendingStates.set(state, { userId: req.user.id, expires: Date.now() + 10 * 60e3 });
  for (const [k, v] of pendingStates) if (v.expires < Date.now()) pendingStates.delete(k);
  const url = new URL(G.authUrl());
  url.search = new URLSearchParams({
    client_id: G.clientId(), redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  }).toString();
  res.redirect(url.href);
});

calendarRouter.get('/google/callback', async (req, res) => {
  const p = pendingStates.get(String(req.query.state || ''));
  pendingStates.delete(String(req.query.state || ''));
  const back = (msg) => res.redirect(`/#/settings?google=${encodeURIComponent(msg)}`);
  if (!p || p.expires < Date.now() || p.userId !== req.user.id) return back('expired');
  if (req.query.error) return back(String(req.query.error));
  try {
    const t = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: redirectUri(req) });
    const existing = account(req.user.id);
    const refresh = t.refresh_token || existing?.refresh_token;
    if (!refresh) throw new Error('Google did not return a refresh token. Remove Raccboard from your Google account permissions and try again.');
    const info = await fetch(G.userinfoUrl(), { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    db.prepare(`INSERT INTO google_accounts (user_id, email, refresh_token, access_token, expires_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token,
        access_token = excluded.access_token, expires_at = excluded.expires_at, last_error = NULL`)
      .run(req.user.id, info.email || '', refresh, t.access_token, Date.now() + (t.expires_in || 3600) * 1000);
    back('connected');
  } catch (e) {
    console.error('Google connect failed:', e.message);
    back(e.message);
  }
});

calendarRouter.get('/google/calendars', async (req, res) => {
  const acc = account(req.user.id) || fail(400, 'Connect Google first');
  const list = await gapi(acc, 'GET', '/users/me/calendarList?minAccessRole=writer');
  res.json((list.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, color: c.backgroundColor })));
});

calendarRouter.patch('/google/settings', async (req, res) => {
  const acc = account(req.user.id) || fail(400, 'Connect Google first');
  const sets = {};
  if ('calendar_id' in req.body) {
    sets.calendar_id = String(req.body.calendar_id || '') || null;
    sets.calendar_name = String(req.body.calendar_name || '').slice(0, 200) || null;
  }
  if (Array.isArray(req.body.board_ids)) {
    sets.board_ids = JSON.stringify(req.body.board_ids.map(String).filter((id) => boardRole(id, req.user)));
  }
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE google_accounts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`).run(...keys.map((k) => sets[k]), acc.user_id);
  await syncUser(req.user.id);
  res.json(status(req.user.id));
});

calendarRouter.post('/google/sync', async (req, res) => {
  account(req.user.id) || fail(400, 'Connect Google first');
  const stats = await syncUser(req.user.id);
  res.json({ ...status(req.user.id), stats });
});

// Disconnect. ?remove_events=1 first deletes the events Raccboard created.
calendarRouter.delete('/google', async (req, res) => {
  const acc = account(req.user.id);
  if (acc) {
    if (req.query.remove_events) {
      for (const m of db.prepare('SELECT * FROM google_events WHERE user_id = ?').all(req.user.id)) {
        try { await gapi(acc, 'DELETE', `/calendars/${encodeURIComponent(m.calendar_id)}/events/${encodeURIComponent(m.event_id)}`); } catch { /* already gone */ }
      }
    }
    fetch(`${G.revokeUrl()}?token=${encodeURIComponent(acc.refresh_token)}`, { method: 'POST' }).catch(() => {});
    db.prepare('DELETE FROM google_events WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM google_accounts WHERE user_id = ?').run(req.user.id);
  }
  res.json(status(req.user.id));
});
