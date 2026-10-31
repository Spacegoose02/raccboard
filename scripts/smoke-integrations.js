// API tokens + webhooks smoke test: node scripts/smoke-integrations.js [baseUrl]
// Run after scripts/smoke.js on the same server (it signs in with the smoke admin).
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000') + '/api';
const SMOKE_USER = process.env.SMOKE_USER || 'smoke';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || 'smoke-test-password';
const headers = { 'Content-Type': 'application/json' };

async function call(method, path, body, statusOnly) {
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (statusOnly) return res.status;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const session = await call('POST', '/auth/login', { username: SMOKE_USER, password: SMOKE_PASSWORD });
headers.Authorization = `Bearer ${session.token}`;

import http from 'node:http';
import { createHmac } from 'node:crypto';

const created = await call('POST', '/tokens', { name: 'CI' });
check(created.token.startsWith('rb_') && created.hint === created.token.slice(-4), 'token is shown once with a hint');
check(!JSON.stringify(await call('GET', '/tokens')).includes(created.token), 'token list never includes the secret');
const sessionAuth = headers.Authorization;
headers.Authorization = `Bearer ${created.token}`;
const me = await call('GET', '/auth/status');
check(me.user?.username === SMOKE_USER, 'API token signs in as its owner');
check(await call('POST', '/tokens', { name: 'nested' }, true) === 403, 'API tokens cannot mint tokens');

// Local receiver records deliveries.
const got = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => { got.push({ headers: req.headers, body }); res.end('ok'); });
}).listen(0);
const hookUrl = `http://127.0.0.1:${server.address().port}/hook`;

const board = await call('POST', '/boards', { name: 'Hooks test' });
check(await call('POST', `/boards/${board.id}/webhooks`, { url: 'ftp://x' }, true) === 400, 'non-http webhook URLs are refused');
const hook = await call('POST', `/boards/${board.id}/webhooks`, { url: hookUrl });
check(hook.secret && !(await call('GET', `/boards/${board.id}/webhooks`))[0].secret, 'secret is returned once');
check((await call('POST', `/boards/${board.id}/webhooks/${hook.id}/test`)).status === '200', 'test ping delivers');
await call('POST', `/boards/${board.id}/lists`, { name: 'Todo' });
for (let i = 0; i < 40 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
const ev = got.find((g) => g.headers['x-raccboard-event'] === 'board.changed');
check(ev, 'a board write sends board.changed');
const payload = JSON.parse(ev.body);
check(payload.board_id === board.id && payload.method === 'POST' && payload.by.id === me.user.id, 'payload names the board, method and user');
check(ev.headers['x-raccboard-signature'] === 'sha256=' + createHmac('sha256', hook.secret).update(ev.body).digest('hex'), 'signature verifies with the secret');

await call('DELETE', `/boards/${board.id}/webhooks/${hook.id}`);
await call('DELETE', `/boards/${board.id}`);
server.close();
headers.Authorization = sessionAuth;
await call('DELETE', `/tokens/${created.id}`);
headers.Authorization = `Bearer ${created.token}`;
check(await call('GET', '/boards', null, true) === 401, 'revoked token stops working');
console.log('integrations smoke passed');
