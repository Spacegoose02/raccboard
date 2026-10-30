// Notifications smoke test: node scripts/smoke-notifications.js [baseUrl]
// Run after scripts/smoke.js on the same server (it signs in with the smoke admin).
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000') + '/api';
const SMOKE_USER = process.env.SMOKE_USER || 'smoke';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || 'smoke-test-password';

async function call(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const login = async (username, password) => (await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token;
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const admin = await login(SMOKE_USER, SMOKE_PASSWORD);
const name = `notif${Date.now() % 100000}`;
const pal = await call('POST', '/users', { username: name, password: 'notif-test-password', display_name: 'Notif Pal' }, admin);
const palToken = await login(name, 'notif-test-password');

const board = await call('POST', '/boards', { name: 'Notify test' }, admin);
await call('PUT', `/boards/${board.id}/shares`, { user_id: pal.id, role: 'editor' }, admin);
const list = await call('POST', `/boards/${board.id}/lists`, { name: 'Todo' }, admin);
const card = await call('POST', `/lists/${list.id}/cards`, { title: 'Ship it' }, admin);

await call('POST', `/cards/${card.id}/comments`, { body: `Hey @${name}, can you look?` }, admin);
let inbox = await call('GET', '/notifications', null, palToken);
check(inbox.items.some((n) => n.kind === 'mention' && n.card_id === card.id), '@mention notifies the person');

await call('PUT', `/cards/${card.id}/members/${pal.id}`, null, admin);
inbox = await call('GET', '/notifications', null, palToken);
check(inbox.items.some((n) => n.kind === 'assigned'), 'adding someone to a card notifies them');
check(inbox.unread === 2, 'two unread');

await call('POST', '/notifications/read', null, palToken);
inbox = await call('GET', '/notifications', null, palToken);
check(inbox.unread === 0, 'mark all read');

const self = await call('GET', '/notifications', null, admin);
check(!self.items.some((n) => n.card_id === card.id), 'no notifications for your own actions');
console.log('Notifications smoke test passed.');
