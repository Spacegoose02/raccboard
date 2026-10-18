// End-to-end Google Calendar sync check against a mock Google (OAuth + Calendar API).
// Usage: node scripts/smoke-google.js [--keep]   (--keep leaves the server running, connected, for UI testing)
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MOCK_PORT = 4020;
const APP_PORT = 3020;
const MOCK = `http://localhost:${MOCK_PORT}`;
const APP = `http://localhost:${APP_PORT}`;
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

/* ---------- mock Google ---------- */
const events = new Map(); // id -> { calendar, ...body }
let nextId = 1;
const codes = new Set();
const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, MOCK);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const json = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const authed = req.headers.authorization === 'Bearer mock-access';
  if (url.pathname === '/auth') {
    const code = `code-${nextId++}`;
    codes.add(code);
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { Location: back.href });
    return res.end();
  }
  if (url.pathname === '/token') {
    const form = new URLSearchParams(raw);
    if (form.get('client_secret') !== 'g-secret') return json({ error: 'invalid_client' }, 401);
    if (form.get('grant_type') === 'authorization_code' && codes.delete(form.get('code'))) {
      return json({ access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600 });
    }
    if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'mock-refresh') return json({ access_token: 'mock-access', expires_in: 3600 });
    return json({ error: 'invalid_grant' }, 400);
  }
  if (url.pathname === '/userinfo') return authed ? json({ email: 'rocky@example.com' }) : json({}, 401);
  if (url.pathname === '/revoke') return json({});
  if (!authed) return json({ error: { message: 'unauthorized' } }, 401);
  if (url.pathname === '/api/users/me/calendarList') {
    return json({ items: [{ id: 'primary@example.com', summary: 'Rocky', primary: true }, { id: 'family@group', summary: 'Family' }] });
  }
  const m = url.pathname.match(/^\/api\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
  if (m) {
    const calendar = decodeURIComponent(m[1]);
    const id = m[2] && decodeURIComponent(m[2]);
    if (req.method === 'POST') { const ev = { id: `ev${nextId++}`, calendar, ...JSON.parse(raw) }; events.set(ev.id, ev); return json(ev); }
    const ev = events.get(id);
    if (!ev || ev.calendar !== calendar) return json({ error: { message: 'Not Found' } }, 404);
    if (req.method === 'PATCH') { Object.assign(ev, JSON.parse(raw)); return json(ev); }
    if (req.method === 'DELETE') { events.delete(id); res.writeHead(204); return res.end(); }
  }
  json({ error: { message: 'not found' } }, 404);
});
await new Promise((r) => mock.listen(MOCK_PORT, r));

/* ---------- Raccboard pointed at it ---------- */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-google-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env, PORT: String(APP_PORT), DATA_DIR: dataDir, PUBLIC_URL: APP, TZ: 'America/New_York',
    GOOGLE_CLIENT_ID: 'g-client', GOOGLE_CLIENT_SECRET: 'g-secret', GOOGLE_AUTH_URL: `${MOCK}/auth`, GOOGLE_TOKEN_URL: `${MOCK}/token`,
    GOOGLE_USERINFO_URL: `${MOCK}/userinfo`, GOOGLE_REVOKE_URL: `${MOCK}/revoke`, GOOGLE_API_BASE: `${MOCK}/api`,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${APP}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
  const setup = await fetch(`${APP}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'gtest', password: 'google-test-pw' }) });
  const cookie = setup.headers.get('set-cookie').match(/rb_session=[^;]+/)[0];
  const call = (method, p, body) => fetch(`${APP}/api${p}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), redirect: 'manual' });
  const json = async (method, p, body) => { const r = await call(method, p, body); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${await r.text()}`); return r.json(); };

  check((await json('GET', '/google/status')).configured, 'Google sync advertised as configured');
  const start = await call('GET', '/google/connect');
  check(start.status === 302 && start.headers.get('location').startsWith(`${MOCK}/auth`), 'connect redirects to Google consent');
  const consent = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const callback = await fetch(consent.headers.get('location'), { headers: { Cookie: cookie }, redirect: 'manual' });
  check(callback.headers.get('location') === '/#/settings?google=connected', 'callback stores the Google account');
  const st = await json('GET', '/google/status');
  check(st.connected && st.email === 'rocky@example.com', 'status shows the connected Google account');
  const cals = await json('GET', '/google/calendars');
  check(cals.length === 2, 'lists writable Google calendars');

  const board = await json('POST', '/boards', { name: 'Home' });
  const list = await json('POST', `/boards/${board.id}/lists`, { name: 'Jobs' });
  const card = await json('POST', `/lists/${list.id}/cards`, { title: 'Fix the roof' });
  await json('PATCH', `/cards/${card.id}`, { due_date: '2026-11-03T09:30' });
  const cl = await json('POST', `/cards/${card.id}/checklists`, { title: 'Materials', due_date: '2026-11-01' });
  await json('POST', `/checklists/${cl.id}/items`, { text: 'Shingles' });

  const after = await json('PATCH', '/google/settings', { calendar_id: 'family@group', calendar_name: 'Family', board_ids: [board.id] });
  const synced = [...events.values()];
  check(after.synced_events === 2 && synced.length === 2, 'choosing a calendar and board pushes its dates');
  const roof = synced.find((e) => e.summary === 'Fix the roof');
  check(roof?.start.dateTime === '2026-11-03T09:30:00' && roof.start.timeZone === 'America/New_York' && roof.calendar === 'family@group', 'timed card becomes a timed event in the chosen calendar');
  check(synced.some((e) => e.summary === '☑ Materials · Fix the roof' && e.start.date === '2026-11-01' && e.end.date === '2026-11-02'), 'sublist due date becomes an all-day event');

  await json('PATCH', `/cards/${card.id}`, { due_date: '2026-11-05T09:30', title: 'Fix the roof!' });
  const r1 = await json('POST', '/google/sync');
  check(r1.stats.updated >= 1 && [...events.values()].some((e) => e.summary === 'Fix the roof!' && e.start.dateTime === '2026-11-05T09:30:00'), 'changes update the Google event');
  const r2 = await json('POST', '/google/sync');
  check(r2.stats.created + r2.stats.updated + r2.stats.deleted === 0, 'unchanged dates are not re-sent');
  if (process.argv.includes('--keep')) {
    // Leave everything running to click through the UI: sign in at APP as gtest / google-test-pw.
    console.log(`Keeping ${APP} and the mock running (connected state). Ctrl+C to stop.`);
    await new Promise(() => {});
  }

  await json('PATCH', `/checklists/${cl.id}`, { due_date: null });
  const r3 = await json('POST', '/google/sync');
  check(r3.stats.deleted === 1 && events.size === 1, 'removing a date deletes its Google event');

  const gone = [...events.keys()][0];
  events.delete(gone);
  await json('PATCH', `/cards/${card.id}`, { title: 'Fix the roof (again)' });
  const r4 = await json('POST', '/google/sync');
  check(r4.stats.created === 1 && events.size === 1, 'an event deleted in Google is recreated');

  const off = await json('DELETE', '/google?remove_events=1');
  check(!off.connected && events.size === 0, 'disconnect with remove_events cleans up Google');
  console.log('Google Calendar smoke test passed.');
} finally {
  server.kill();
  mock.close();
}
