// Card dependencies smoke test: node scripts/smoke-dependencies.js [baseUrl]
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

const board = await call('POST', '/boards', { name: 'Deps test' });
const list = await call('POST', `/boards/${board.id}/lists`, { name: 'Plan' });
const mk = (title) => call('POST', `/lists/${list.id}/cards`, { title });
const [design, build, ship] = [await mk('Design'), await mk('Build'), await mk('Ship')];

await call('PUT', `/cards/${build.id}/blockers/${design.id}`);
await call('PUT', `/cards/${ship.id}/blockers/${build.id}`);
let data = await call('GET', `/boards/${board.id}`);
const byId = Object.fromEntries(data.cards.map((c) => [c.id, c]));
check(byId[build.id].blocked_by[0] === design.id && byId[ship.id].blocked_by[0] === build.id, 'board returns blocked_by');
check(await call('PUT', `/cards/${design.id}/blockers/${ship.id}`, null, true) === 400, 'a loop through three cards is refused');
check(await call('PUT', `/cards/${design.id}/blockers/${design.id}`, null, true) === 400, 'a card cannot block itself');

const other = await call('POST', '/boards', { name: 'Deps other' });
const olist = await call('POST', `/boards/${other.id}/lists`, { name: 'X' });
const ocard = await call('POST', `/lists/${olist.id}/cards`, { title: 'Elsewhere' });
check(await call('PUT', `/cards/${build.id}/blockers/${ocard.id}`, null, true) === 400, 'cross-board dependencies are refused');

const detail = await call('GET', `/cards/${build.id}`);
check(detail.card.blocked_by[0].title === 'Design' && detail.card.blocking[0].title === 'Ship', 'card detail lists blockers and blocked cards');

const copy = await call('POST', '/boards', { name: 'Deps copy', from_board: board.id });
data = await call('GET', `/boards/${copy.id}`);
const t = Object.fromEntries(data.cards.map((c) => [c.title, c]));
check(t.Build.blocked_by[0] === t.Design.id && t.Ship.blocked_by[0] === t.Build.id, 'copying a board keeps dependencies');

await call('DELETE', `/cards/${build.id}/blockers/${design.id}`);
await call('DELETE', `/cards/${design.id}`);
data = await call('GET', `/boards/${board.id}`);
check(data.cards.find((c) => c.id === build.id).blocked_by.length === 0, 'removing a blocker works');
console.log('Dependencies smoke test passed.');
