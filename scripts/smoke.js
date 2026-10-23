// API smoke test: node scripts/smoke.js [baseUrl]
// On a fresh server it creates the first (admin) account. On an existing one it signs in with
// SMOKE_USER / SMOKE_PASSWORD, which must be an admin.
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000') + '/api';
const SMOKE_USER = process.env.SMOKE_USER || 'smoke';
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || 'smoke-test-password';
const headers = { 'Content-Type': 'application/json' };

async function call(method, path, body, token) {
  const h = token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : headers;
  const res = await fetch(base + path, { method, headers: h, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const health = await call('GET', '/health');
check(health.ok, 'health');

const anon = await fetch(base + '/boards');
check(anon.status === 401, 'API requires sign-in');
const status = await call('GET', '/auth/status');
const session = status.setupRequired
  ? await call('POST', '/auth/setup', { username: SMOKE_USER, password: SMOKE_PASSWORD, display_name: 'Smoke Test' })
  : await call('POST', '/auth/login', { username: SMOKE_USER, password: SMOKE_PASSWORD });
headers.Authorization = `Bearer ${session.token}`;
check(session.user.role === 'admin', status.setupRequired ? 'first account created as admin' : 'signed in');
const bad = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: SMOKE_USER, password: 'wrong-password' }) });
check(bad.status === 401, 'wrong password rejected');
const me = await call('PATCH', '/auth/me', { display_name: 'Smoke Test', avatar: 'raccoon:3' });
check(me.avatar === 'raccoon:3' && me.display_name === 'Smoke Test', 'profile and raccoon avatar saved');
const extraName = `smoke-${Date.now()}`;
const extra = await call('POST', '/users', { username: extraName, password: 'another-password', display_name: 'Extra' });
check((await call('GET', '/users')).some((u) => u.id === extra.id), 'admin creates a user');

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
check(detail.activity.every((a) => a.actor === 'Smoke Test' && a.user_id === session.user.id), 'activity records the signed-in user');
check(detail.comments[0].user_id === session.user.id, 'comment records the signed-in user');

const form = new FormData();
form.append('file', new Blob(['hello raccoon']), 'note.txt');
const up = await fetch(`${base}/cards/${card.id}/attachments`, { method: 'POST', body: form, headers: { Authorization: headers.Authorization } });
const att = await up.json();
const dl = await fetch(`${base}/attachments/${att.id}?access_token=${session.token}`).then((r) => r.text());
check(dl === 'hello raccoon', 'attachment upload and download');

const cl2 = await call('POST', `/cards/${card2.id}/checklists`, { title: 'Shopping', due_date: '2026-12-24' });
check(cl2.due_date === '2026-12-24', 'checklist (sublist) created with due date');
await call('POST', `/checklists/${cl2.id}/items`, { text: 'Rollers' });
await call('PATCH', `/checklists/${cl2.id}`, { due_date: '2026-12-20' });
full = await call('GET', `/boards/${board.id}`);
check(full.cards.find((c) => c.id === card2.id).next_sub_due === '2026-12-20', 'next sublist due date on card face');
const dated = await call('GET', `/dates?board=${board.id}&from=2026-09-01&to=2026-12-31`);
check(['card', 'checklist', 'item'].every((t) => dated.some((d) => d.type === t)), 'calendar dates include cards, sublists and items');
const outside = await call('GET', `/dates?board=${board.id}&from=2027-01-01&to=2027-01-31`);
check(outside.length === 0, 'calendar date range is respected');
const feed = await call('GET', '/calendar/feed');
// The feed URL uses the server's public address; fetch the same path on the test server.
const local = (url) => base.replace(/\/api$/, '') + new URL(url).pathname;
const ics = await fetch(local(feed.url)).then((r) => r.text());
check(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('SUMMARY:☑ Shopping · Buy brushes'), 'calendar feed (.ics) works without signing in');
const cardIcs = await fetch(`${base}/cards/${card2.id}/ics?access_token=${session.token}`).then((r) => r.text());
check(cardIcs.includes('DTSTART;VALUE=DATE:20261220'), 'card .ics download');
const reset = await call('POST', '/calendar/feed/reset');
const old = await fetch(local(feed.url));
check(reset.url !== feed.url && old.status === 404, 'resetting the feed link disables the old one');
await call('PATCH', `/lists/${todo.id}`, { due_date: '2026-11-30' });
const archivedCount = await call('POST', `/lists/${doing.id}/archive-cards`);
full = await call('GET', `/boards/${board.id}`);
check(archivedCount.archived === 2 && full.cards.length === 0, 'archive all cards in a list');
check(full.lists.find((l) => l.id === todo.id).due_date === '2026-11-30', 'list due date');

await call('PATCH', `/boards/${board.id}`, { completed: true });
const boards = await call('GET', '/boards');
check(boards.find((b) => b.id === board.id).completed_at, 'complete board');

/* ----- sharing, teams and card members ----- */
// Regression: an admin resets someone's password, and they can sign in with it (with any username case).
await call('PATCH', `/users/${extra.id}`, { password: 'reset-by-admin-1' });
const afterReset = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: extraName.toUpperCase(), password: 'reset-by-admin-1' }) });
check(afterReset.ok, 'admin password reset lets the user sign in');
const spaced = await fetch(`${base}/users/${extra.id}`, { method: 'PATCH', headers, body: JSON.stringify({ password: 'trailing-space ' }) });
check(spaced.status === 400, 'passwords with a leading or trailing space are rejected');
await call('PATCH', `/users/${extra.id}`, { password: 'another-password' });
// Usernames can be changed by the user or an admin; the old name stops working, the password stays.
const renamed = await call('PATCH', `/users/${extra.id}`, { username: `  ${extraName}-NEW ` });
check(renamed.username === `${extraName}-new`, 'admin renames a user (trimmed, lowercased)');
const oldName = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: extraName, password: 'another-password' }) });
check(oldName.status === 401, 'the old username no longer signs in');
const taken = await fetch(`${base}/users/${extra.id}`, { method: 'PATCH', headers, body: JSON.stringify({ username: SMOKE_USER }) });
check(taken.status === 409, 'renaming to a taken username is refused');
const extraToken = (await call('POST', '/auth/login', { username: `${extraName}-new`, password: 'another-password' })).token;
const self = await call('PATCH', '/auth/me', { username: extraName }, extraToken);
check(self.username === extraName, 'a user changes their own username in Profile');
const other = (await call('POST', '/auth/login', { username: extraName, password: 'another-password' })).token;
const status404 = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other}` }, body: body && JSON.stringify(body) });
  return r.status;
};
const shared = await call('POST', '/boards', { name: 'Shared board' });
const sharedList = await call('POST', `/boards/${shared.id}/lists`, { name: 'Family' });
const sharedCard = await call('POST', `/lists/${sharedList.id}/cards`, { title: 'Plan the trip' });
check(!(await call('GET', '/boards', null, other)).some((b) => b.id === shared.id), 'boards are private by default');
check(await status404('GET', `/boards/${shared.id}`) === 404, 'no access looks like not found');

await call('PUT', `/boards/${shared.id}/shares`, { user_id: extra.id, role: 'viewer' });
const asViewer = await call('GET', `/boards/${shared.id}`, null, other);
check(asViewer.board.my_role === 'viewer' && asViewer.cards.length === 1, 'viewer can open a shared board');
check(await status404('POST', `/lists/${sharedList.id}/cards`, { title: 'nope' }) === 403, 'viewer cannot add cards');
check(await status404('PATCH', `/boards/${shared.id}`, { name: 'Hijacked' }) === 403, 'viewer cannot rename the board');
await call('POST', `/cards/${sharedCard.id}/comments`, { body: 'Viewer comment' }, other);
check(true, 'viewer can comment');

await call('PUT', `/boards/${shared.id}/shares`, { user_id: extra.id, role: 'editor' });
await call('POST', `/lists/${sharedList.id}/cards`, { title: 'Book hotel' }, other);
check(await status404('DELETE', `/boards/${shared.id}`) === 403, 'editor can add cards but not delete the board');

const shareList = await call('GET', `/boards/${shared.id}/shares`);
await call('DELETE', `/boards/${shared.id}/shares/${shareList.shares[0].id}`);
check(await status404('GET', `/boards/${shared.id}`) === 404, 'removing a share revokes access');

const team = await call('POST', '/teams', { name: 'Smoke family' });
await call('PUT', `/teams/${team.id}/members/${extra.id}`);
await call('PUT', `/boards/${shared.id}/shares`, { team_id: team.id, role: 'editor' });
check((await call('GET', `/boards/${shared.id}`, null, other)).board.my_role === 'editor', 'sharing with a team gives its members access');

await call('PUT', `/cards/${sharedCard.id}/members/${extra.id}`);
const withMember = await call('GET', `/boards/${shared.id}`);
check(withMember.cards.find((c) => c.id === sharedCard.id).member_ids.includes(extra.id), 'card member shown on the card face');
check(withMember.people.some((p) => p.id === extra.id), 'board lists the people who can be added');
await call('DELETE', `/teams/${team.id}/members/${extra.id}`);
const nobody = await fetch(`${base}/cards/${sharedCard.id}/members/${extra.id}`, { method: 'PUT', headers });
check(nobody.status === 400, 'cannot add a member who has no access');
await call('DELETE', `/teams/${team.id}`);
await call('DELETE', `/boards/${shared.id}`);

// Regression checks for bug fixes
{
  const bl = await call('POST', `/boards/${board.id}/lists`, { name: 'Old stuff' });
  const bc = await call('POST', `/lists/${bl.id}/cards`, { title: 'Forgotten' });
  await call('PATCH', `/cards/${bc.id}`, { archived: true });
  await call('PATCH', `/lists/${bl.id}`, { archived: true });
  await call('PATCH', `/cards/${bc.id}`, { archived: false });
  check((await call('GET', `/boards/${board.id}`)).lists.some((l) => l.id === bl.id), 'restoring a card also restores its archived list');
  const sc = await call('POST', `/lists/${bl.id}/cards`, { title: 'Start only' });
  await call('PATCH', `/cards/${sc.id}`, { start_date: '2026-11-05' });
  check((await call('GET', `/dates?board=${board.id}`)).some((e) => e.id === sc.id && e.date === '2026-11-05'), 'cards with only a start date show on the calendar');
  const team = await call('POST', '/teams', { name: 'Smoke team' });
  const demote = await fetch(`${base}/teams/${team.id}/members/${session.user.id}`, { method: 'PUT', headers, body: JSON.stringify({ role: 'member' }) });
  check(demote.status === 400, "a team's only owner can't be demoted");
  await call('DELETE', `/teams/${team.id}`);
}


await call('DELETE', `/boards/${board.id}`);
await call('DELETE', `/users/${extra.id}`);
await call('POST', '/auth/logout');
const after = await fetch(base + '/boards', { headers });
check(after.status === 401, 'sign-out ends the session');
console.log('Smoke test passed.');
