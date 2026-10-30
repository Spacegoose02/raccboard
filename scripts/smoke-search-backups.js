// Full-text search and backups smoke test: node scripts/smoke-search-backups.js [baseUrl]
// Run after scripts/smoke.js on the same server (it signs in with the smoke admin).
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000') + '/api';
const SMOKE_USER = process.env.SMOKE_USER || 'smoke';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || 'smoke-test-password';
const headers = { 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const session = await call('POST', '/auth/login', { username: SMOKE_USER, password: SMOKE_PASSWORD });
headers.Authorization = `Bearer ${session.token}`;

const board = await call('POST', '/boards', { name: 'Search test' });
const list = await call('POST', `/boards/${board.id}/lists`, { name: 'Todo' });
const card = await call('POST', `/lists/${list.id}/cards`, { title: 'Fix the gutters', description: 'Ladder is in the garage' });
const s = (q) => call('GET', `/search?q=${encodeURIComponent(q)}`);

check((await s('gutt')).cards.some((c) => c.id === card.id), 'prefix match on title');
check((await s('garage')).cards.some((c) => c.id === card.id), 'match in description');
await call('POST', `/cards/${card.id}/comments`, { body: 'Call the roofer about flashing' });
check((await s('roofer')).cards.some((c) => c.id === card.id), 'match in comments');
await call('PATCH', `/cards/${card.id}`, { title: 'Clean the windows' });
check(!(await s('gutters')).cards.some((c) => c.id === card.id) && (await s('windows')).cards.some((c) => c.id === card.id), 'index follows title edits');
check(Array.isArray((await s('"*)(:')).cards), 'punctuation-only queries are safe');
await call('PATCH', `/cards/${card.id}`, { archived: true });
check(!(await s('windows')).cards.some((c) => c.id === card.id), 'archived cards are hidden');

const made = await call('POST', '/admin/backups');
const listed = await call('GET', '/admin/backups');
check(listed.backups.some((b) => b.name === made.name && b.size > 0), 'backup made and listed');
const dl = await fetch(`${base}/admin/backups/${made.name}`, { headers });
const bytes = Buffer.from(await dl.arrayBuffer());
check(dl.ok && bytes.toString('latin1', 0, 15) === 'SQLite format 3', 'backup downloads as a SQLite file');
check((await fetch(`${base}/admin/backups/..%2Fraccboard.db`, { headers })).status === 404, 'path traversal refused');
console.log('Search and backups smoke test passed.');
