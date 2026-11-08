// Planning features smoke test: node scripts/smoke-pro.js [baseUrl]
// Run after scripts/smoke.js on the same server (it signs in with the smoke admin).
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000') + '/api';
const SMOKE_USER = process.env.SMOKE_USER || 'smoke';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || 'smoke-test-password';
const headers = { 'Content-Type': 'application/json' };

async function call(method, path, body, statusOnly, auth = true) {
  const res = await fetch(base + path, { method, headers: auth ? headers : { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (statusOnly) return res.status;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const session = await call('POST', '/auth/login', { username: SMOKE_USER, password: SMOKE_PASSWORD });
headers.Authorization = `Bearer ${session.token}`;
const me = session.user;

const board = await call('POST', '/boards', { name: 'Pro test' });
const todo = await call('POST', `/boards/${board.id}/lists`, { name: 'Todo' });
const done = await call('POST', `/boards/${board.id}/lists`, { name: 'Done' });
const epic = await call('POST', `/lists/${todo.id}/cards`, { title: 'Epic' });

// Priority, estimate, sub-cards
await call('PATCH', `/cards/${epic.id}`, { priority: 4, estimate: 5 });
const sub1 = await call('POST', `/cards/${epic.id}/subcards`, { title: 'Part 1' });
const sub2 = await call('POST', `/cards/${epic.id}/subcards`, { title: 'Part 2' });
await call('PATCH', `/cards/${sub1.id}`, { completed: true });
let data = await call('GET', `/boards/${board.id}`);
let e = data.cards.find((c) => c.id === epic.id);
check(e.priority === 4 && e.estimate === 5, 'priority and estimate are saved');
check(e.sub_total === 2 && e.sub_done === 1, 'parent card counts its sub-cards');
check(await call('PATCH', `/cards/${epic.id}`, { parent_id: sub2.id }, true) === 400, 'a card cannot be nested inside its own sub-card');
const detail = await call('GET', `/cards/${sub2.id}`);
check(detail.card.parent?.id === epic.id, 'sub-card knows its parent');

// Bulk
await call('POST', `/boards/${board.id}/bulk`, { card_ids: [sub1.id, sub2.id], action: 'move', value: done.id });
await call('POST', `/boards/${board.id}/bulk`, { card_ids: [epic.id, sub2.id], action: 'add_member', value: me.id });
data = await call('GET', `/boards/${board.id}`);
check(data.cards.filter((c) => c.list_id === done.id).length === 2, 'bulk move');

// My work
const mine = await call('GET', '/my-work');
check(mine.cards.some((c) => c.id === epic.id && c.board_name === 'Pro test'), 'My work lists assigned cards across boards');

// Saved views
const view = await call('POST', `/boards/${board.id}/views`, { name: 'Urgent', filter: { priority: [4] } });
check((await call('GET', `/boards/${board.id}/views`)).some((v) => v.id === view.id && v.filter.priority[0] === 4), 'saved views round-trip');

// Sprints
const s1 = await call('POST', `/boards/${board.id}/sprints`, { name: 'S1', end_date: '2099-01-01' });
const s2 = await call('POST', `/boards/${board.id}/sprints`, { name: 'S2' });
await call('POST', `/boards/${board.id}/bulk`, { card_ids: [epic.id, sub1.id], action: 'sprint', value: s1.id });
await call('PATCH', `/sprints/${s1.id}`, { status: 'active' });
const report = await call('GET', `/boards/${board.id}/report`);
check(report.burndown?.total === 2 && report.totals.cards === 3, 'report has totals and a burndown');
const closed = await call('PATCH', `/sprints/${s1.id}`, { status: 'closed' });
data = await call('GET', `/boards/${board.id}`);
check(closed.rolled === 1 && data.cards.find((c) => c.id === epic.id).sprint_id === s2.id, 'closing a sprint carries unfinished cards over');

// Time
await call('POST', `/cards/${epic.id}/time`, { minutes: 30 });
await call('POST', `/cards/${epic.id}/timer/start`);
check((await call('GET', '/timer'))?.card_id === epic.id, 'timer is running');
await call('POST', `/cards/${epic.id}/timer/stop`);
data = await call('GET', `/boards/${board.id}`);
check(data.cards.find((c) => c.id === epic.id).time_minutes >= 30, 'time adds up');

// Public link
const { public_token } = await call('POST', `/boards/${board.id}/public-link`);
const pub = await call('GET', `/public/${public_token}`, null, false, false);
check(pub.board.name === 'Pro test' && pub.cards.length === 3 && !pub.people, 'public link shows the board without people');
await call('DELETE', `/boards/${board.id}/public-link`);
check(await call('GET', `/public/${public_token}`, null, true, false) === 404, 'turning the link off works');

// Email to board
const { inbound_token } = await call('POST', `/boards/${board.id}/inbound`, { list_id: todo.id });
await call('POST', `/inbound/${inbound_token}`, { subject: 'Fix the gutter', text: 'It leaks', from: 'Pat <pat@example.com>' }, false, false);
data = await call('GET', `/boards/${board.id}`);
check(data.cards.some((c) => c.title === 'Fix the gutter' && c.list_id === todo.id), 'email creates a card');

// Aging
await call('PATCH', `/boards/${board.id}`, { aging_days: 14 });
check((await call('GET', `/boards/${board.id}`)).board.aging_days === 14, 'card aging setting is saved');
console.log('Pro features smoke test passed.');
