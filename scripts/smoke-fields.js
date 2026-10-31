// Custom fields smoke test: node scripts/smoke-fields.js [baseUrl]
// Run after scripts/smoke.js on the same server (it signs in with the smoke admin).
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000') + '/api';
const SMOKE_USER = process.env.SMOKE_USER || 'smoke';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || 'smoke-test-password';
const headers = { 'Content-Type': 'application/json' };

async function call(method, path, body, expect) {
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (expect) return res.status;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const session = await call('POST', '/auth/login', { username: SMOKE_USER, password: SMOKE_PASSWORD });
headers.Authorization = `Bearer ${session.token}`;

const board = await call('POST', '/boards', { name: 'Fields test' });
const list = await call('POST', `/boards/${board.id}/lists`, { name: 'Todo' });
const card = await call('POST', `/lists/${list.id}/cards`, { title: 'New roof' });

const cost = await call('POST', `/boards/${board.id}/fields`, { name: 'Cost', type: 'number' });
const prio = await call('POST', `/boards/${board.id}/fields`, { name: 'Priority', type: 'select', options: ['High', 'Low', 'High', ''] });
const ok = await call('POST', `/boards/${board.id}/fields`, { name: 'Approved', type: 'checkbox' });
const when = await call('POST', `/boards/${board.id}/fields`, { name: 'Quote by', type: 'date' });
check(JSON.stringify(prio.options) === '["High","Low"]', 'select options are cleaned and de-duplicated');

await call('PUT', `/cards/${card.id}/fields/${cost.id}`, { value: '1250.50' });
await call('PUT', `/cards/${card.id}/fields/${prio.id}`, { value: 'High' });
await call('PUT', `/cards/${card.id}/fields/${ok.id}`, { value: true });
await call('PUT', `/cards/${card.id}/fields/${when.id}`, { value: '2026-11-15' });
check(await call('PUT', `/cards/${card.id}/fields/${cost.id}`, { value: 'lots' }, true) === 400, 'number fields reject text');
check(await call('PUT', `/cards/${card.id}/fields/${prio.id}`, { value: 'Medium' }, true) === 400, 'select fields reject unknown options');

let data = await call('GET', `/boards/${board.id}`);
const vals = data.cards.find((c) => c.id === card.id).field_values;
check(data.fields.length === 4, 'board returns its fields');
check(vals[cost.id] === '1250.5' && vals[prio.id] === 'High' && vals[ok.id] === '1' && vals[when.id] === '2026-11-15', 'values come back on the board');

await call('PUT', `/cards/${card.id}/fields/${prio.id}`, { value: '' });
const detail = await call('GET', `/cards/${card.id}`);
check(!(prio.id in detail.card.field_values) && detail.fields.length === 4, 'empty value clears it; card detail includes fields');

const copy = await call('POST', '/boards', { name: 'Fields copy', from_board: board.id });
data = await call('GET', `/boards/${copy.id}`);
const copied = data.cards.find((c) => c.title === 'New roof');
const copiedCost = data.fields.find((f) => f.name === 'Cost');
check(copiedCost && copied && copied.field_values[copiedCost.id] === '1250.5', 'copying a board copies fields and values');

await call('DELETE', `/fields/${cost.id}`);
data = await call('GET', `/boards/${board.id}`);
check(data.fields.length === 3 && !(cost.id in data.cards[0].field_values), 'deleting a field removes its values');
console.log('Custom fields smoke test passed.');
