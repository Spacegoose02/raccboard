// Trello-style features: covers, copy card, templates, board templates, automation rules, Trello import.
// Usage: node scripts/smoke-features.js [baseUrl] (signs in like smoke.js)
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

const status = await call('GET', '/auth/status');
const session = await call('POST', status.setupRequired ? '/auth/setup' : '/auth/login', { username: SMOKE_USER, password: SMOKE_PASSWORD, display_name: 'Smoke Test' });
headers.Authorization = `Bearer ${session.token}`;

// Board templates
const templates = await call('GET', '/board-templates');
check(templates.some((t) => t.id === 'homeboard') && templates.some((t) => t.id === 'kanban'), 'built-in board templates listed');
const kb = await call('POST', '/boards', { template: 'kanban', name: 'Feature smoke' });
let full = await call('GET', `/boards/${kb.id}`);
const [todo, doing, done] = ['To do', 'Doing', 'Done'].map((n) => full.lists.find((l) => l.name === n));
check(todo && doing && done, 'kanban template creates its lists');
const rules = await call('GET', `/boards/${kb.id}/automations`);
check(rules.length === 2, 'template rules are created');

const home = await call('POST', '/boards', { template: 'homeboard' });
const homeRules = await call('GET', `/boards/${home.id}/automations`);
const homeFull = await call('GET', `/boards/${home.id}`);
const doneLabel = homeFull.labels.find((l) => l.name === 'Done');
check(homeRules.some((r) => r.action === 'add_label' && r.action_value === doneLabel.id), 'template label rules point at the label, not a same-named list');
await call('DELETE', `/boards/${home.id}`);

// Automation: moving to Done completes the card and Doing joins the mover
const card = await call('POST', `/lists/${todo.id}/cards`, { title: 'Automate me' });
await call('POST', `/cards/${card.id}/move`, { list_id: doing.id });
let detail = await call('GET', `/cards/${card.id}`);
check(detail.card.member_ids.includes(session.user.id), 'rule: moving to Doing adds the mover');
await call('POST', `/cards/${card.id}/move`, { list_id: done.id });
detail = await call('GET', `/cards/${card.id}`);
check(detail.card.completed === 1 && detail.activity.some((a) => a.actor === 'Automation'), 'rule: moving to Done marks complete, logged as Automation');

// Custom rule: completing a checklist moves the card
const label = full.labels[0];
const rule = await call('POST', `/boards/${kb.id}/automations`, { trigger: 'checklist_completed', action: 'add_label', action_value: label.id });
const c2 = await call('POST', `/lists/${todo.id}/cards`, { title: 'Checklist rule' });
const cl = await call('POST', `/cards/${c2.id}/checklists`, { title: 'Steps' });
const it = await call('POST', `/checklists/${cl.id}/items`, { text: 'Only step' });
await call('PATCH', `/items/${it.id}`, { done: true });
check((await call('GET', `/cards/${c2.id}`)).card.label_ids.includes(label.id), 'rule: finishing a checklist adds a label');
await call('PATCH', `/automations/${rule.id}`, { enabled: false });
const bad = await fetch(`${base}/boards/${kb.id}/automations`, { method: 'POST', headers, body: JSON.stringify({ trigger: 'card_moved', action: 'move_to_list', action_value: 'nope' }) });
check(bad.status === 400, 'rules are validated');

// Covers
await call('PATCH', `/cards/${c2.id}`, { cover: 'color:#ef4444' });
full = await call('GET', `/boards/${kb.id}`);
check(full.cards.find((c) => c.id === c2.id).cover === 'color:#ef4444', 'color cover saved and on the card face');
const badCover = await fetch(`${base}/cards/${c2.id}`, { method: 'PATCH', headers, body: JSON.stringify({ cover: 'image:not-mine' }) });
check(badCover.status === 400, 'image covers must be an image on the card');

// Board backgrounds
const raw = (method, path, body) => fetch(base + path, { method, headers: { Authorization: headers.Authorization }, body });
const patchBg = (background) => fetch(`${base}/boards/${kb.id}`, { method: 'PATCH', headers, body: JSON.stringify({ background }) });
check((await call('PATCH', `/boards/${kb.id}`, { background: 'preset:ocean' })).background === 'preset:ocean', 'preset background saved');
check((await call('PATCH', `/boards/${kb.id}`, { background: 'color:#3b82f6' })).background === 'color:#3b82f6', 'color background saved');
check((await call('PATCH', `/boards/${kb.id}`, { background: 'url:https://example.com/bg.jpg' })).background === 'url:https://example.com/bg.jpg', 'https link background saved');
for (const bad of ['url:http://example.com/a.jpg', 'url:javascript:alert(1)', 'url:https://x.com/a.jpg");background:url("https://evil', 'preset:nope', 'image:../../rackboard.db:image/png', 'color:red;x'])
  check((await patchBg(bad)).status === 400, `background rejected: ${bad.slice(0, 40)}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==', 'base64');
const form = (bytes, name, type) => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); return f; };
let up = await raw('POST', `/boards/${kb.id}/background`, form(png, 'bg.png', 'image/png'));
const upped = await up.json();
check(up.status === 201 && /^image:[0-9a-f-]+:image\/png$/.test(upped.background), 'image background uploaded');
const got = await raw('GET', `/boards/${kb.id}/background`);
check(got.headers.get('content-type') === 'image/png' && got.headers.get('content-security-policy').includes('sandbox') && Buffer.from(await got.arrayBuffer()).equals(png), 'uploaded background served as image with sandbox CSP');
up = await raw('POST', `/boards/${kb.id}/background`, form('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'x.png', 'image/png'));
check(up.status === 415, 'non-images (SVG disguised as PNG) are rejected');
up = await raw('POST', `/boards/${kb.id}/background`, form(Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]), 'big.png', 'image/png'));
check(up.status === 413, 'oversized backgrounds are rejected');
check((await call('PATCH', `/boards/${kb.id}`, { background: null })).background === null, 'background removed');
check((await raw('GET', `/boards/${kb.id}/background`)).status === 404, 'removed image is no longer served');

// Copy card and templates
const copy = await call('POST', `/cards/${c2.id}/copy`, { list_id: doing.id, title: 'Copied' });
detail = await call('GET', `/cards/${copy.id}`);
check(detail.card.title === 'Copied' && detail.checklists[0].items[0].done === 0 && detail.card.label_ids.includes(label.id), 'copy keeps checklists (unchecked) and labels');
await call('PATCH', `/cards/${c2.id}`, { is_template: true });
const fromTpl = await call('POST', `/cards/${c2.id}/copy`, { list_id: todo.id, title: 'From template' });
check(fromTpl.is_template === 0, 'cards made from a template are normal cards');

// Copy board
const copyBoard = await call('POST', `/boards/${kb.id}/copy`, { name: 'Copy of smoke' });
const copied = await call('GET', `/boards/${copyBoard.id}`);
check(copied.lists.length === 3 && copied.cards.length >= 3 && (await call('GET', `/boards/${copyBoard.id}/automations`)).length === 3, 'copy board brings lists, cards and rules');

// Trello import
const trello = {
  name: 'From Trello', labels: [{ id: 'L1', name: 'Urgent', color: 'red' }],
  lists: [{ id: 'A', name: 'Todo', pos: 1 }, { id: 'B', name: 'Old', pos: 2, closed: true }],
  cards: [{ id: 'C1', name: 'Imported card', desc: 'Hello', idList: 'A', pos: 1, idLabels: ['L1'], due: '2026-11-01T15:00:00.000Z', dueComplete: false, cover: { color: 'green' },
    attachments: [{ name: 'Spec', url: 'https://example.com/spec' }] }],
  checklists: [{ id: 'K1', idCard: 'C1', name: 'Todo', pos: 1, checkItems: [{ name: 'One', state: 'complete', pos: 1 }, { name: 'Two', state: 'incomplete', pos: 2 }] }],
  actions: [{ type: 'commentCard', date: '2026-10-01T10:00:00.000Z', data: { text: 'Nice', card: { id: 'C1' } }, memberCreator: { fullName: 'Tina Trello' } }],
};
const imp = await call('POST', '/import/trello', trello);
check(imp.cards === 1 && imp.checklists === 1 && imp.comments === 1 && imp.lists === 2, 'Trello import counts');
const ib = await call('GET', `/boards/${imp.board_id}`);
const ic = await call('GET', `/cards/${ib.cards[0].id}`);
check(ib.lists.length === 1 && ic.card.cover && ic.card.label_ids.length === 1 && ic.card.description.includes('https://example.com/spec'), 'import maps lists, labels, covers and attachment links');
check(ic.checklists[0].items[0].done === 1 && ic.comments[0].author === 'Tina Trello' && ic.card.due_date?.startsWith('2026-11-01'), 'import maps checklists, comments and dates');
const notTrello = await fetch(`${base}/import/trello`, { method: 'POST', headers, body: '{"foo":1}' });
check(notTrello.status === 400, 'non-Trello JSON is rejected');

for (const id of [kb.id, copyBoard.id, imp.board_id]) await call('DELETE', `/boards/${id}`);
console.log('Features smoke test passed.');
