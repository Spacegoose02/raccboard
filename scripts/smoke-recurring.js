// Recurring cards + WIP limits smoke test: node scripts/smoke-recurring.js [baseUrl]
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

const board = await call('POST', '/boards', { name: 'Recurring test' });
const list = await call('POST', `/boards/${board.id}/lists`, { name: 'Chores' });
const card = await call('POST', `/lists/${list.id}/cards`, { title: 'Water plants' });
await call('PATCH', `/cards/${card.id}`, { due_date: '2026-01-31', recurrence: 'monthly' });
const done = await call('PATCH', `/cards/${card.id}`, { completed: true });
check(done.next_card_id, 'completing a repeating card returns the next copy');
const data = await call('GET', `/boards/${board.id}`);
const next = data.cards.find((c) => c.id === done.next_card_id);
check(next && next.title === 'Water plants' && !next.completed, 'the copy is open with the same title');
check(next.due_date.startsWith('2026-02-28'), 'monthly repeat clamps Jan 31 to Feb 28');
check(next.recurrence === 'monthly' && !data.cards.find((c) => c.id === card.id).recurrence, 'the repeat moves to the copy');
check(!(await call('PATCH', `/cards/${card.id}`, { completed: false })).next_card_id, 'reopening makes no copy');
await call('PATCH', `/cards/${card.id}`, { recurrence: 'yearly' });
check(!(await call('GET', `/boards/${board.id}`)).cards.find((c) => c.id === card.id).recurrence, 'unknown repeat values are ignored');

await call('PATCH', `/lists/${list.id}`, { wip_limit: 1 });
check((await call('GET', `/boards/${board.id}`)).lists[0].wip_limit === 1, 'WIP limit is saved');
await call('PATCH', `/lists/${list.id}`, { wip_limit: -3 });
check((await call('GET', `/boards/${board.id}`)).lists[0].wip_limit === null, 'invalid WIP limit clears it');
await call('DELETE', `/boards/${board.id}`);
console.log('recurring smoke passed');
