// API smoke test: node scripts/smoke.js [baseUrl]
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000') + '/api';
const headers = { 'Content-Type': 'application/json', 'X-User': 'Smoke Test' };

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const health = await call('GET', '/health');
check(health.ok, 'health');

const board = await call('POST', '/boards', { name: 'Smoke board' });
check(board.id, 'create board');
const todo = await call('POST', `/boards/${board.id}/lists`, { name: 'To do' });
const doing = await call('POST', `/boards/${board.id}/lists`, { name: 'Doing' });
check(todo.id && doing.id, 'create two lists');

const card = await call('POST', `/lists/${todo.id}/cards`, { title: 'Paint the fence' });
const card2 = await call('POST', `/lists/${doing.id}/cards`, { title: 'Buy brushes' });
check(card.list_id === todo.id, 'create cards');

await call('POST', `/cards/${card.id}/move`, { list_id: doing.id, index: 0 });
let full = await call('GET', `/boards/${board.id}`);
const inDoing = full.cards.filter((c) => c.list_id === doing.id).map((c) => c.id);
check(inDoing[0] === card.id && inDoing[1] === card2.id, 'move card to top of other list');

const cl = await call('POST', `/cards/${card.id}/checklists`, { title: 'Supplies' });
const item = await call('POST', `/checklists/${cl.id}/items`, { text: 'Primer', due_date: '2026-11-01' });
await call('POST', `/checklists/${cl.id}/items`, { text: 'Paint' });
await call('PATCH', `/items/${item.id}`, { done: true });
await call('POST', `/cards/${card.id}/comments`, { body: 'Start on the **north** side.' });
const label = full.labels.find((l) => l.name === 'In progress');
await call('PUT', `/cards/${card.id}/labels/${label.id}`);
await call('PATCH', `/cards/${card.id}`, { completed: true, due_date: '2026-10-01' });

full = await call('GET', `/boards/${board.id}`);
const face = full.cards.find((c) => c.id === card.id);
check(face.check_total === 2 && face.check_done === 1, 'checklist progress on card face');
check(face.comment_count === 1 && face.label_ids.includes(label.id), 'comment count and label on card face');

const detail = await call('GET', `/cards/${card.id}`);
check(detail.checklists[0].items.length === 2, 'card detail has checklist items');
check(detail.activity.some((a) => a.text.startsWith('moved this card')), 'activity log records move');
check(detail.activity.every((a) => a.actor === 'Smoke Test'), 'actor taken from X-User');

const form = new FormData();
form.append('file', new Blob(['hello raccoon']), 'note.txt');
const up = await fetch(`${base}/cards/${card.id}/attachments`, { method: 'POST', body: form, headers: { 'X-User': 'Smoke Test' } });
const att = await up.json();
const dl = await fetch(`${base}/attachments/${att.id}`).then((r) => r.text());
check(dl === 'hello raccoon', 'attachment upload and download');

const cl2 = await call('POST', `/cards/${card2.id}/checklists`, { title: 'Shopping', due_date: '2026-12-24' });
check(cl2.due_date === '2026-12-24', 'checklist (sublist) created with due date');
await call('POST', `/checklists/${cl2.id}/items`, { text: 'Rollers' });
await call('PATCH', `/checklists/${cl2.id}`, { due_date: '2026-12-20' });
full = await call('GET', `/boards/${board.id}`);
check(full.cards.find((c) => c.id === card2.id).next_sub_due === '2026-12-20', 'next sublist due date on card face');
await call('PATCH', `/lists/${todo.id}`, { due_date: '2026-11-30' });
const archivedCount = await call('POST', `/lists/${doing.id}/archive-cards`);
full = await call('GET', `/boards/${board.id}`);
check(archivedCount.archived === 2 && full.cards.length === 0, 'archive all cards in a list');
check(full.lists.find((l) => l.id === todo.id).due_date === '2026-11-30', 'list due date');

await call('PATCH', `/boards/${board.id}`, { completed: true });
const boards = await call('GET', '/boards');
check(boards.find((b) => b.id === board.id).completed_at, 'complete board');

await call('DELETE', `/boards/${board.id}`);
console.log('Smoke test passed.');
