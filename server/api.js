import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, uuid, now, logActivity, DEFAULT_LABELS, UPLOAD_DIR } from './db.js';
import { authRouter, publicUser, requireUser } from './auth.js';
import { assertBoard, boardRole, boardUsers, VISIBLE_BOARDS_SQL, visibleParams, withRequest } from './access.js';
import { sharingRouter } from './sharing.js';

export const api = express.Router();
// The Android app is served from its own origin (http://localhost), so allow cross-origin calls.
// It authenticates with a Bearer token, never cookies, so a wildcard origin is safe.
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
api.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
api.use(express.json({ limit: '2mb' }));

api.get('/health', (_req, res) => res.json({ ok: true }));

// Sign-in, profiles and user admin. Everything after requireUser needs a session.
api.use(authRouter);
api.use(requireUser);
api.use(withRequest);
api.use(sharingRouter);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const notFound = (what) => { throw new HttpError(404, `${what} not found`); };
const bool = (v) => (v ? 1 : 0);
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const dateOrNull = (v) => (v ? String(v).slice(0, 32) : null);

// Build an UPDATE from whitelisted fields present in the body.
function patch(table, id, body, fields) {
  const sets = [];
  const vals = [];
  for (const [key, conv] of Object.entries(fields)) {
    if (key in body) { sets.push(`${key} = ?`); vals.push(conv(body[key])); }
  }
  if (!sets.length) return;
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

// Every getter checks the current user's access to the row's board (see access.js):
// reads need viewer, writes need editor, unless a level is given.
const guard = (row, what, level) => { if (!row) notFound(what); assertBoard(row.board_id, level); return row; };
const getBoard = (id, level) => { const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(id); if (!b) notFound('Board'); assertBoard(b.id, level); return b; };
const getList = (id, level) => guard(db.prepare('SELECT * FROM lists WHERE id = ?').get(id), 'List', level);
const getCard = (id, level) =>
  guard(db.prepare('SELECT c.*, l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?').get(id), 'Card', level);
const getChecklist = (id, level) =>
  guard(db.prepare(`SELECT cl.*, l.board_id FROM checklists cl JOIN cards c ON c.id = cl.card_id
              JOIN lists l ON l.id = c.list_id WHERE cl.id = ?`).get(id), 'Checklist', level);
const getItem = (id, level) =>
  guard(db.prepare(`SELECT i.*, cl.card_id, l.board_id FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id
              JOIN cards c ON c.id = cl.card_id JOIN lists l ON l.id = c.list_id WHERE i.id = ?`).get(id), 'Item', level);
const getLabel = (id, level) => guard(db.prepare('SELECT * FROM labels WHERE id = ?').get(id), 'Label', level);
const getAttachment = (id, level) =>
  guard(db.prepare(`SELECT a.*, l.board_id FROM attachments a JOIN cards c ON c.id = a.card_id
              JOIN lists l ON l.id = c.list_id WHERE a.id = ?`).get(id), 'Attachment', level);
const touchCard = (id) => db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now(), id);
const nextPos = (table, col, parent) =>
  (db.prepare(`SELECT MAX(position) AS m FROM ${table} WHERE ${col} = ?`).get(parent).m ?? -1) + 1;

/* ---------- Boards ---------- */

api.get('/boards', (req, res) => {
  const boards = db.prepare(`
    SELECT b.*, (SELECT display_name FROM users WHERE id = b.owner_id) AS owner_name,
      (SELECT COUNT(*) FROM cards c JOIN lists l ON l.id = c.list_id
        WHERE l.board_id = b.id AND c.archived = 0 AND l.archived = 0) AS card_count,
      (SELECT COUNT(*) FROM cards c JOIN lists l ON l.id = c.list_id
        WHERE l.board_id = b.id AND c.archived = 0 AND l.archived = 0 AND c.completed = 1) AS done_count
    FROM boards b WHERE ${VISIBLE_BOARDS_SQL} ORDER BY b.position, b.created_at`).all(...visibleParams(req.user))
    .map((b) => ({ ...b, my_role: boardRole(b.id, req.user) }));
  res.json(boards);
});

api.post('/boards', (req, res) => {
  const name = str(req.body.name, 120) || 'Untitled board';
  const id = uuid();
  db.transaction(() => {
    db.prepare('INSERT INTO boards (id, name, color, position, created_at, owner_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, str(req.body.color, 32) || null, nextPosAll('boards'), now(), req.user.id);
    const ins = db.prepare('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)');
    for (const l of DEFAULT_LABELS) ins.run(uuid(), id, l.name, l.color);
    logActivity(id, null, req.who, `created board "${name}"`);
  })();
  res.status(201).json({ ...getBoard(id), my_role: 'owner' });
});
function nextPosAll(table) {
  return (db.prepare(`SELECT MAX(position) AS m FROM ${table}`).get().m ?? -1) + 1;
}

api.get('/boards/:id', (req, res) => {
  const board = getBoard(req.params.id);
  const lists = db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position').all(board.id);
  const cards = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM comments WHERE card_id = c.id) AS comment_count,
      (SELECT COUNT(*) FROM attachments WHERE card_id = c.id) AS attachment_count,
      (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id) AS check_total,
      (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id AND i.done = 1) AS check_done,
      (SELECT json_group_array(label_id) FROM card_labels WHERE card_id = c.id) AS label_ids,
      (SELECT json_group_array(user_id) FROM card_members WHERE card_id = c.id) AS member_ids,
      (SELECT MIN(d) FROM (
        SELECT i.due_date AS d FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id
          WHERE cl.card_id = c.id AND i.done = 0 AND i.due_date IS NOT NULL
        UNION ALL
        SELECT cl.due_date FROM checklists cl WHERE cl.card_id = c.id AND cl.due_date IS NOT NULL
          AND EXISTS (SELECT 1 FROM checklist_items i WHERE i.checklist_id = cl.id AND i.done = 0))) AS next_sub_due
    FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND l.archived = 0 AND c.archived = 0
    ORDER BY c.position`).all(board.id)
    .map((c) => ({ ...c, label_ids: JSON.parse(c.label_ids), member_ids: JSON.parse(c.member_ids) }));
  const labels = db.prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY rowid').all(board.id);
  const people = boardUsers(board.id).map(publicUser);
  res.json({ board: { ...board, my_role: boardRole(board.id, req.user) }, lists, cards, labels, people });
});

api.get('/boards/:id/archived', (req, res) => {
  const board = getBoard(req.params.id);
  const lists = db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 1 ORDER BY name').all(board.id);
  const cards = db.prepare(`SELECT c.*, l.name AS list_name FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND c.archived = 1 ORDER BY c.updated_at DESC`).all(board.id);
  res.json({ lists, cards });
});

api.patch('/boards/:id', (req, res) => {
  const board = getBoard(req.params.id, 'owner');
  const b = req.body;
  db.transaction(() => {
    patch('boards', board.id, b, { name: (v) => str(v, 120) || board.name, color: (v) => str(v, 32) || null, archived: bool });
    if ('completed' in b) {
      db.prepare('UPDATE boards SET completed_at = ? WHERE id = ?').run(b.completed ? now() : null, board.id);
      logActivity(board.id, null, req.who, b.completed ? 'completed the board' : 'reopened the board');
    }
    if ('name' in b && str(b.name) && str(b.name) !== board.name) {
      logActivity(board.id, null, req.who, `renamed board to "${str(b.name, 120)}"`);
    }
  })();
  res.json({ ...getBoard(board.id), my_role: boardRole(board.id, req.user) });
});

api.delete('/boards/:id', (req, res) => {
  const board = getBoard(req.params.id, 'owner');
  const files = db.prepare(`SELECT a.stored_name FROM attachments a JOIN cards c ON c.id = a.card_id
    JOIN lists l ON l.id = c.list_id WHERE l.board_id = ?`).all(board.id);
  db.prepare('DELETE FROM boards WHERE id = ?').run(board.id);
  files.forEach((f) => removeUpload(f.stored_name));
  res.status(204).end();
});

/* ---------- Lists ---------- */

api.post('/boards/:id/lists', (req, res) => {
  const board = getBoard(req.params.id);
  const id = uuid();
  const name = str(req.body.name, 120) || 'New list';
  db.prepare('INSERT INTO lists (id, board_id, name, position, due_date) VALUES (?, ?, ?, ?, ?)')
    .run(id, board.id, name, nextPos('lists', 'board_id', board.id), dateOrNull(req.body.due_date));
  logActivity(board.id, null, req.who, `added list "${name}"`);
  res.status(201).json(getList(id));
});

api.put('/boards/:id/lists/order', (req, res) => {
  const board = getBoard(req.params.id);
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const upd = db.prepare('UPDATE lists SET position = ? WHERE id = ? AND board_id = ?');
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id, board.id)))();
  res.json({ ok: true });
});

api.patch('/lists/:id', (req, res) => {
  const list = getList(req.params.id);
  patch('lists', list.id, req.body, {
    name: (v) => str(v, 120) || list.name, due_date: dateOrNull, collapsed: bool, archived: bool,
  });
  if ('archived' in req.body) {
    logActivity(list.board_id, null, req.who, `${req.body.archived ? 'archived' : 'restored'} list "${list.name}"`);
  }
  res.json(getList(list.id));
});

// Archive every card in a list (the list itself stays).
api.post('/lists/:id/archive-cards', (req, res) => {
  const list = getList(req.params.id);
  const r = db.prepare('UPDATE cards SET archived = 1, updated_at = ? WHERE list_id = ? AND archived = 0').run(now(), list.id);
  if (r.changes) logActivity(list.board_id, null, req.who, `archived ${r.changes} card${r.changes === 1 ? '' : 's'} in "${list.name}"`);
  res.json({ archived: r.changes });
});

api.delete('/lists/:id', (req, res) => {
  const list = getList(req.params.id);
  const files = db.prepare('SELECT a.stored_name FROM attachments a JOIN cards c ON c.id = a.card_id WHERE c.list_id = ?').all(list.id);
  db.prepare('DELETE FROM lists WHERE id = ?').run(list.id);
  files.forEach((f) => removeUpload(f.stored_name));
  res.status(204).end();
});

/* ---------- Cards ---------- */

api.post('/lists/:id/cards', (req, res) => {
  const list = getList(req.params.id);
  const id = uuid();
  const title = str(req.body.title, 300) || 'New card';
  const t = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO cards (id, list_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, list.id, title, nextPos('cards', 'list_id', list.id), t, t);
    logActivity(list.board_id, id, req.who, `added this card to ${list.name}`);
  })();
  res.status(201).json(getCard(id));
});

api.get('/cards/:id', (req, res) => {
  const card = getCard(req.params.id);
  const list = getList(card.list_id);
  const label_ids = db.prepare('SELECT label_id FROM card_labels WHERE card_id = ?').pluck().all(card.id);
  const member_ids = db.prepare('SELECT user_id FROM card_members WHERE card_id = ?').pluck().all(card.id);
  const checklists = db.prepare('SELECT * FROM checklists WHERE card_id = ? ORDER BY position').all(card.id);
  const items = db.prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY position');
  checklists.forEach((cl) => { cl.items = items.all(cl.id); });
  const attachments = db.prepare('SELECT * FROM attachments WHERE card_id = ? ORDER BY created_at DESC').all(card.id);
  const comments = db.prepare('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at DESC').all(card.id);
  const activity = db.prepare('SELECT * FROM activity WHERE card_id = ? ORDER BY created_at DESC LIMIT 200').all(card.id);
  res.json({ card: { ...card, list_name: list.name, label_ids, member_ids, my_role: boardRole(card.board_id, req.user) }, checklists, attachments, comments, activity });
});

api.patch('/cards/:id', (req, res) => {
  const card = getCard(req.params.id);
  const b = req.body;
  db.transaction(() => {
    patch('cards', card.id, b, {
      title: (v) => str(v, 300) || card.title,
      description: (v) => (typeof v === 'string' ? v.slice(0, 100000) : ''),
      start_date: dateOrNull, due_date: dateOrNull, completed: bool, archived: bool,
    });
    touchCard(card.id);
    const log = (t) => logActivity(card.board_id, card.id, req.who, t);
    if ('completed' in b && bool(b.completed) !== card.completed) log(b.completed ? 'marked this card complete' : 'marked this card incomplete');
    if ('archived' in b && bool(b.archived) !== card.archived) log(b.archived ? 'archived this card' : 'restored this card');
    if ('title' in b && str(b.title) && str(b.title, 300) !== card.title) log(`renamed this card to "${str(b.title, 300)}"`);
    if ('description' in b && b.description !== card.description) log('updated the description');
    if ('due_date' in b && dateOrNull(b.due_date) !== card.due_date) log(b.due_date ? `set the due date to ${b.due_date}` : 'removed the due date');
    if ('start_date' in b && dateOrNull(b.start_date) !== card.start_date) log(b.start_date ? `set the start date to ${b.start_date}` : 'removed the start date');
  })();
  res.json(getCard(card.id));
});

// Move a card to (list_id, index). All positions in the target list are rewritten in one transaction.
api.post('/cards/:id/move', (req, res) => {
  const card = getCard(req.params.id);
  const target = getList(req.body.list_id || card.list_id);
  if (target.board_id !== card.board_id) throw new HttpError(400, 'Cannot move a card to another board');
  db.transaction(() => {
    const ids = db.prepare('SELECT id FROM cards WHERE list_id = ? AND id != ? AND archived = 0 ORDER BY position')
      .pluck().all(target.id, card.id);
    const index = Math.max(0, Math.min(ids.length, Number.isInteger(req.body.index) ? req.body.index : ids.length));
    ids.splice(index, 0, card.id);
    const upd = db.prepare('UPDATE cards SET list_id = ?, position = ? WHERE id = ?');
    ids.forEach((id, i) => upd.run(target.id, i, id));
    if (target.id !== card.list_id) {
      const from = getList(card.list_id);
      touchCard(card.id);
      logActivity(card.board_id, card.id, req.who, `moved this card from ${from.name} to ${target.name}`);
    }
  })();
  res.json(getCard(card.id));
});

api.delete('/cards/:id', (req, res) => {
  const card = getCard(req.params.id);
  const files = db.prepare('SELECT stored_name FROM attachments WHERE card_id = ?').all(card.id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
  files.forEach((f) => removeUpload(f.stored_name));
  res.status(204).end();
});

/* ---------- Labels ---------- */

api.post('/boards/:id/labels', (req, res) => {
  const board = getBoard(req.params.id);
  const id = uuid();
  db.prepare('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)')
    .run(id, board.id, str(req.body.name, 60), str(req.body.color, 32) || '#64748b');
  res.status(201).json(db.prepare('SELECT * FROM labels WHERE id = ?').get(id));
});

api.patch('/labels/:id', (req, res) => {
  const label = getLabel(req.params.id);
  patch('labels', label.id, req.body, { name: (v) => str(v, 60), color: (v) => str(v, 32) || label.color });
  res.json(db.prepare('SELECT * FROM labels WHERE id = ?').get(label.id));
});

api.delete('/labels/:id', (req, res) => {
  getLabel(req.params.id);
  db.prepare('DELETE FROM labels WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

api.put('/cards/:id/labels/:labelId', (req, res) => {
  const card = getCard(req.params.id);
  const label = db.prepare('SELECT * FROM labels WHERE id = ? AND board_id = ?').get(req.params.labelId, card.board_id) || notFound('Label');
  const r = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(card.id, label.id);
  if (r.changes) logActivity(card.board_id, card.id, req.who, `added label "${label.name || label.color}"`);
  res.json({ ok: true });
});

api.delete('/cards/:id/labels/:labelId', (req, res) => {
  const card = getCard(req.params.id);
  const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.labelId);
  const r = db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?').run(card.id, req.params.labelId);
  if (r.changes && label) logActivity(card.board_id, card.id, req.who, `removed label "${label.name || label.color}"`);
  res.status(204).end();
});

/* ---------- Card members ---------- */

api.put('/cards/:id/members/:userId', (req, res) => {
  const card = getCard(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId) || notFound('User');
  if (!boardRole(card.board_id, user)) throw new HttpError(400, `${user.display_name} can't open this board. Share it with them first.`);
  const r = db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)').run(card.id, user.id);
  if (r.changes) logActivity(card.board_id, card.id, req.who, user.id === req.user.id ? 'joined this card' : `added ${user.display_name} to this card`);
  res.json({ ok: true });
});

api.delete('/cards/:id/members/:userId', (req, res) => {
  const card = getCard(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  const r = db.prepare('DELETE FROM card_members WHERE card_id = ? AND user_id = ?').run(card.id, req.params.userId);
  if (r.changes && user) logActivity(card.board_id, card.id, req.who, user.id === req.user.id ? 'left this card' : `removed ${user.display_name} from this card`);
  res.status(204).end();
});

/* ---------- Checklists (sublists) ---------- */

api.post('/cards/:id/checklists', (req, res) => {
  const card = getCard(req.params.id);
  const id = uuid();
  const title = str(req.body.title, 200) || 'Checklist';
  db.prepare('INSERT INTO checklists (id, card_id, title, position, due_date) VALUES (?, ?, ?, ?, ?)')
    .run(id, card.id, title, nextPos('checklists', 'card_id', card.id), dateOrNull(req.body.due_date));
  logActivity(card.board_id, card.id, req.who, `added checklist "${title}"`);
  res.status(201).json({ ...db.prepare('SELECT * FROM checklists WHERE id = ?').get(id), items: [] });
});

api.patch('/checklists/:id', (req, res) => {
  const cl = getChecklist(req.params.id);
  patch('checklists', cl.id, req.body, { title: (v) => str(v, 200) || cl.title, due_date: dateOrNull });
  if ('due_date' in req.body && dateOrNull(req.body.due_date) !== cl.due_date) {
    logActivity(cl.board_id, cl.card_id, req.who, req.body.due_date ? `set "${cl.title}" due ${req.body.due_date}` : `removed the due date from "${cl.title}"`);
  }
  res.json(db.prepare('SELECT * FROM checklists WHERE id = ?').get(cl.id));
});

api.delete('/checklists/:id', (req, res) => {
  const cl = getChecklist(req.params.id);
  db.prepare('DELETE FROM checklists WHERE id = ?').run(cl.id);
  logActivity(cl.board_id, cl.card_id, req.who, `removed checklist "${cl.title}"`);
  res.status(204).end();
});

api.post('/checklists/:id/items', (req, res) => {
  const cl = getChecklist(req.params.id);
  const id = uuid();
  db.prepare('INSERT INTO checklist_items (id, checklist_id, text, due_date, position) VALUES (?, ?, ?, ?, ?)')
    .run(id, cl.id, str(req.body.text, 500) || 'Item', dateOrNull(req.body.due_date), nextPos('checklist_items', 'checklist_id', cl.id));
  res.status(201).json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id));
});

api.patch('/items/:id', (req, res) => {
  const item = getItem(req.params.id);
  patch('checklist_items', item.id, req.body, { text: (v) => str(v, 500) || item.text, done: bool, due_date: dateOrNull });
  if ('done' in req.body && bool(req.body.done) !== item.done) {
    logActivity(item.board_id, item.card_id, req.who, `${req.body.done ? 'completed' : 'unchecked'} "${item.text}"`);
  }
  res.json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(item.id));
});

api.delete('/items/:id', (req, res) => {
  getItem(req.params.id);
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

/* ---------- Attachments ---------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, _file, cb) => cb(null, uuid()),
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024 },
});

function removeUpload(stored) {
  fs.rm(path.join(UPLOAD_DIR, path.basename(stored)), { force: true }, () => {});
}

api.post('/cards/:id/attachments', upload.single('file'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded');
  let card;
  try { card = getCard(req.params.id); } catch (e) { removeUpload(req.file.filename); throw e; }
  // multer decodes the multipart filename as latin1; restore UTF-8.
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const id = uuid();
  db.prepare('INSERT INTO attachments (id, card_id, filename, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, card.id, filename, req.file.filename, req.file.mimetype, req.file.size, now());
  logActivity(card.board_id, card.id, req.who, `attached ${filename}`);
  res.status(201).json(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id));
});

api.get('/attachments/:id', (req, res) => {
  const a = getAttachment(req.params.id);
  if (a.mime) res.type(a.mime);
  const disposition = req.query.inline ? 'inline' : 'attachment';
  res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
});

api.delete('/attachments/:id', (req, res) => {
  const a = getAttachment(req.params.id);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  removeUpload(a.stored_name);
  logActivity(a.board_id, a.card_id, req.who, `removed attachment ${a.filename}`);
  res.status(204).end();
});

/* ---------- Comments ---------- */

api.post('/cards/:id/comments', (req, res) => {
  const card = getCard(req.params.id, 'viewer');
  const body = typeof req.body.body === 'string' ? req.body.body.trim().slice(0, 20000) : '';
  if (!body) throw new HttpError(400, 'Comment is empty');
  const id = uuid();
  db.prepare('INSERT INTO comments (id, card_id, author, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, card.id, req.who.name, req.who.id, body, now());
  res.status(201).json(db.prepare('SELECT * FROM comments WHERE id = ?').get(id));
});

api.delete('/comments/:id', (req, res) => {
  const c = guard(db.prepare(`SELECT cm.*, l.board_id FROM comments cm JOIN cards c ON c.id = cm.card_id
    JOIN lists l ON l.id = c.list_id WHERE cm.id = ?`).get(req.params.id), 'Comment', 'viewer');
  if (c.user_id !== req.user.id && boardRole(c.board_id, req.user) !== 'owner') throw new HttpError(403, 'You can only delete your own comments');
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.status(204).end();
});

api.use((_req, _res) => { throw new HttpError(404, 'Not found'); });

// eslint-disable-next-line no-unused-vars
api.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});
