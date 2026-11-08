import express from 'express';
import { randomBytes } from 'node:crypto';
import { db, uuid, now, logActivity } from './db.js';
import { assertBoard, boardRole, VISIBLE_BOARDS_SQL, visibleParams } from './access.js';
import { runAutomations } from './features.js';

// Planning and power features: My work, sub-cards, bulk edit, saved views, sprints, time tracking,
// reports, public read-only links and email-to-board.
export const proRouter = express.Router();
// Routes that authenticate with a secret token in the URL instead of a session.
export const publicRouter = express.Router();

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const token = () => randomBytes(24).toString('base64url');
const nextPos = (listId) => (db.prepare('SELECT MAX(position) AS m FROM cards WHERE list_id = ?').get(listId).m ?? -1) + 1;
const cardRow = (id) => db.prepare('SELECT c.*, l.board_id, l.name AS list_name FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?').get(id);
const getCard = (id, level) => { const c = cardRow(id); if (!c) fail(404, 'Card not found'); assertBoard(c.board_id, level); return c; };
const getBoard = (id, level) => { const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(id); if (!b) fail(404, 'Board not found'); assertBoard(b.id, level); return b; };
export const cleanPriority = (v) => { const n = Math.round(Number(v)); return n >= 0 && n <= 4 ? n : 0; };

/* ---------- My work: everything assigned to me, on every board I can open ---------- */

proRouter.get('/my-work', (req, res) => {
  const includeDone = req.query.done === '1';
  const cards = db.prepare(`
    SELECT c.id, c.title, c.due_date, c.start_date, c.completed, c.completed_at, c.priority, c.estimate, c.updated_at,
      l.id AS list_id, l.name AS list_name, b.id AS board_id, b.name AS board_name, b.color AS board_color,
      (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id) AS check_total,
      (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id AND i.done = 1) AS check_done
    FROM card_members m JOIN cards c ON c.id = m.card_id JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id
    WHERE m.user_id = ? AND c.archived = 0 AND l.archived = 0 AND b.archived = 0 AND c.is_template = 0
      AND (${includeDone ? "c.completed = 0 OR c.completed_at >= datetime('now', '-7 days')" : 'c.completed = 0'})
      AND ${VISIBLE_BOARDS_SQL}
    ORDER BY c.completed, c.due_date IS NULL, c.due_date, c.priority DESC, c.updated_at DESC
    LIMIT 500`).all(req.user.id, ...visibleParams(req.user));
  // Checklist items assigned by due date on cards I'm on are already covered by the card.
  res.json({ cards });
});

/* ---------- Sub-cards ---------- */

proRouter.post('/cards/:id/subcards', (req, res) => {
  const parent = getCard(req.params.id);
  const title = str(req.body.title, 2000) || 'New sub-card';
  const listId = req.body.list_id && db.prepare('SELECT id FROM lists WHERE id = ? AND board_id = ?').pluck().get(req.body.list_id, parent.board_id);
  const list = listId || parent.list_id;
  const id = uuid();
  const t = now();
  db.transaction(() => {
    db.prepare('INSERT INTO cards (id, list_id, title, position, parent_id, sprint_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, list, title, nextPos(list), parent.id, parent.sprint_id, t, t);
    logActivity(parent.board_id, id, req.who, `added this as a sub-card of "${parent.title.slice(0, 200)}"`);
    logActivity(parent.board_id, parent.id, req.who, `added sub-card "${title.slice(0, 200)}"`);
  })();
  runAutomations('card_added', { cardId: id, listId: list, who: req.who });
  res.status(201).json(cardRow(id));
});

/* ---------- Bulk edit ---------- */

const BULK_ACTIONS = ['move', 'add_label', 'remove_label', 'add_member', 'remove_member', 'complete', 'incomplete', 'archive', 'priority', 'sprint', 'due_date'];
proRouter.post('/boards/:id/bulk', (req, res) => {
  const board = getBoard(req.params.id);
  const { action, value } = req.body;
  if (!BULK_ACTIONS.includes(action)) fail(400, 'Unknown bulk action');
  const ids = Array.isArray(req.body.card_ids) ? [...new Set(req.body.card_ids.map(String))].slice(0, 1000) : [];
  const cards = ids.map(cardRow).filter((c) => c && c.board_id === board.id);
  if (!cards.length) fail(400, 'Choose some cards first');
  const onBoard = (table, v) => db.prepare(`SELECT * FROM ${table} WHERE id = ? AND board_id = ?`).get(String(v || ''), board.id);
  const t = now();
  const touch = db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?');
  const log = (c, text) => logActivity(board.id, c.id, req.who, text);
  const moved = [];
  const completed = [];
  db.transaction(() => {
    if (action === 'move') {
      const list = onBoard('lists', value) || fail(400, 'Choose a list on this board');
      let pos = nextPos(list.id);
      for (const c of cards) {
        if (c.list_id === list.id) continue;
        db.prepare('UPDATE cards SET list_id = ?, position = ?, updated_at = ? WHERE id = ?').run(list.id, pos++, t, c.id);
        log(c, `moved this card from ${c.list_name} to ${list.name}`);
        moved.push([c.id, list.id]);
      }
    } else if (action === 'add_label' || action === 'remove_label') {
      const label = onBoard('labels', value) || fail(400, 'Choose a label');
      for (const c of cards) {
        if (action === 'add_label') db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(c.id, label.id);
        else db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?').run(c.id, label.id);
        touch.run(t, c.id);
      }
    } else if (action === 'add_member' || action === 'remove_member') {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(String(value || ''));
      if (!user || !boardRole(board.id, user)) fail(400, 'That person cannot open this board');
      for (const c of cards) {
        if (action === 'add_member') db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)').run(c.id, user.id);
        else db.prepare('DELETE FROM card_members WHERE card_id = ? AND user_id = ?').run(c.id, user.id);
        touch.run(t, c.id);
      }
    } else if (action === 'complete' || action === 'incomplete') {
      const done = action === 'complete' ? 1 : 0;
      for (const c of cards) {
        if (c.completed === done) continue;
        db.prepare('UPDATE cards SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(done, done ? t : null, t, c.id);
        log(c, done ? 'marked this card complete' : 'marked this card incomplete');
        if (done) completed.push(c.id);
      }
    } else if (action === 'archive') {
      for (const c of cards) { db.prepare('UPDATE cards SET archived = 1, updated_at = ? WHERE id = ?').run(t, c.id); log(c, 'archived this card'); }
    } else if (action === 'priority') {
      const p = cleanPriority(value);
      for (const c of cards) db.prepare('UPDATE cards SET priority = ?, updated_at = ? WHERE id = ?').run(p, t, c.id);
    } else if (action === 'sprint') {
      const sprint = value ? onBoard('sprints', value) || fail(400, 'Choose a sprint on this board') : null;
      for (const c of cards) db.prepare('UPDATE cards SET sprint_id = ?, updated_at = ? WHERE id = ?').run(sprint?.id || null, t, c.id);
    } else if (action === 'due_date') {
      const d = value ? day(String(value).slice(0, 10)) || fail(400, 'Use a date like 2026-12-31') : null;
      for (const c of cards) db.prepare('UPDATE cards SET due_date = ?, updated_at = ? WHERE id = ?').run(d, t, c.id);
    }
  })();
  for (const [cardId, listId] of moved) runAutomations('card_moved', { cardId, listId, who: req.who });
  for (const cardId of completed) runAutomations('card_completed', { cardId, who: req.who });
  res.json({ changed: cards.length });
});

/* ---------- Saved views (named filters) ---------- */

const viewOut = (v) => ({ ...v, filter: JSON.parse(v.filter) });
proRouter.get('/boards/:id/views', (req, res) => {
  const board = getBoard(req.params.id);
  res.json(db.prepare('SELECT * FROM saved_views WHERE board_id = ? AND (user_id = ? OR shared = 1) ORDER BY name COLLATE NOCASE')
    .all(board.id, req.user.id).map(viewOut));
});
proRouter.post('/boards/:id/views', (req, res) => {
  const board = getBoard(req.params.id, 'viewer');
  const name = str(req.body.name, 80) || fail(400, 'Name the view');
  const filter = JSON.stringify(req.body.filter && typeof req.body.filter === 'object' ? req.body.filter : {});
  if (filter.length > 5000) fail(400, 'That filter is too big');
  const shared = req.body.shared && boardRole(board.id, req.user) !== 'viewer' ? 1 : 0;
  const id = uuid();
  db.prepare('INSERT INTO saved_views (id, board_id, user_id, name, filter, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, board.id, req.user.id, name, filter, shared, now());
  res.status(201).json(viewOut(db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id)));
});
proRouter.delete('/views/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(req.params.id) || fail(404, 'View not found');
  const role = assertBoard(v.board_id, 'viewer');
  if (v.user_id !== req.user.id && role !== 'owner') fail(403, 'You can only delete your own views');
  db.prepare('DELETE FROM saved_views WHERE id = ?').run(v.id);
  res.status(204).end();
});

/* ---------- Sprints ---------- */

const SPRINT_STATUS = ['planned', 'active', 'closed'];
const getSprint = (id, level) => { const s = db.prepare('SELECT * FROM sprints WHERE id = ?').get(id) || fail(404, 'Sprint not found'); assertBoard(s.board_id, level); return s; };
proRouter.post('/boards/:id/sprints', (req, res) => {
  const board = getBoard(req.params.id);
  const count = db.prepare('SELECT COUNT(*) FROM sprints WHERE board_id = ?').pluck().get(board.id);
  const name = str(req.body.name, 80) || `Sprint ${count + 1}`;
  const id = uuid();
  db.prepare('INSERT INTO sprints (id, board_id, name, start_date, end_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, board.id, name, day(req.body.start_date), day(req.body.end_date), 'planned', now());
  logActivity(board.id, null, req.who, `created ${name}`);
  res.status(201).json(db.prepare('SELECT * FROM sprints WHERE id = ?').get(id));
});
// Closing a sprint moves its unfinished cards to the next planned sprint (or the backlog).
proRouter.patch('/sprints/:id', (req, res) => {
  const s = getSprint(req.params.id);
  const b = req.body;
  let rolled = 0;
  db.transaction(() => {
    if ('name' in b) db.prepare('UPDATE sprints SET name = ? WHERE id = ?').run(str(b.name, 80) || s.name, s.id);
    if ('start_date' in b) db.prepare('UPDATE sprints SET start_date = ? WHERE id = ?').run(day(b.start_date), s.id);
    if ('end_date' in b) db.prepare('UPDATE sprints SET end_date = ? WHERE id = ?').run(day(b.end_date), s.id);
    if ('status' in b && SPRINT_STATUS.includes(b.status) && b.status !== s.status) {
      if (b.status === 'active') db.prepare("UPDATE sprints SET status = 'planned' WHERE board_id = ? AND status = 'active'").run(s.board_id);
      db.prepare('UPDATE sprints SET status = ? WHERE id = ?').run(b.status, s.id);
      if (b.status === 'active' && !s.start_date) db.prepare('UPDATE sprints SET start_date = ? WHERE id = ?').run(now().slice(0, 10), s.id);
      if (b.status === 'closed') {
        const next = db.prepare("SELECT id FROM sprints WHERE board_id = ? AND status = 'planned' AND id != ? ORDER BY COALESCE(start_date, created_at) LIMIT 1").pluck().get(s.board_id, s.id);
        rolled = db.prepare('UPDATE cards SET sprint_id = ? WHERE sprint_id = ? AND completed = 0 AND archived = 0').run(next || null, s.id).changes;
      }
      logActivity(s.board_id, null, req.who, `${b.status === 'active' ? 'started' : b.status === 'closed' ? 'closed' : 'reopened'} ${s.name}${rolled ? ` (${rolled} unfinished card${rolled === 1 ? '' : 's'} carried over)` : ''}`);
    }
  })();
  res.json({ ...db.prepare('SELECT * FROM sprints WHERE id = ?').get(s.id), rolled });
});
proRouter.delete('/sprints/:id', (req, res) => {
  const s = getSprint(req.params.id);
  db.prepare('DELETE FROM sprints WHERE id = ?').run(s.id);
  res.status(204).end();
});

/* ---------- Time tracking ---------- */

const entry = (id) => db.prepare('SELECT t.*, u.display_name AS user_name FROM time_entries t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(id);
const stopTimers = (userId) => {
  const t = now();
  for (const e of db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL').all(userId)) {
    const minutes = Math.max(0, (Date.parse(t) - Date.parse(e.started_at)) / 60000);
    db.prepare('UPDATE time_entries SET ended_at = ?, minutes = ? WHERE id = ?').run(t, Math.round(minutes * 10) / 10, e.id);
  }
};
proRouter.get('/timer', (req, res) => {
  const e = db.prepare(`SELECT t.*, c.title AS card_title, l.board_id FROM time_entries t JOIN cards c ON c.id = t.card_id JOIN lists l ON l.id = c.list_id
    WHERE t.user_id = ? AND t.ended_at IS NULL`).get(req.user.id);
  res.json(e || null);
});
// One running timer per person: starting a new one stops the old one.
proRouter.post('/cards/:id/timer/start', (req, res) => {
  const card = getCard(req.params.id);
  const id = uuid();
  db.transaction(() => {
    stopTimers(req.user.id);
    db.prepare('INSERT INTO time_entries (id, card_id, user_id, started_at) VALUES (?, ?, ?, ?)').run(id, card.id, req.user.id, now());
  })();
  res.status(201).json(entry(id));
});
proRouter.post('/cards/:id/timer/stop', (req, res) => {
  getCard(req.params.id);
  stopTimers(req.user.id);
  res.status(204).end();
});
proRouter.post('/cards/:id/time', (req, res) => {
  const card = getCard(req.params.id);
  const minutes = Number(req.body.minutes);
  if (!(minutes > 0 && minutes <= 24 * 60 * 7)) fail(400, 'Enter a time between 1 minute and a week');
  const id = uuid();
  const t = now();
  db.prepare('INSERT INTO time_entries (id, card_id, user_id, started_at, ended_at, minutes, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, card.id, req.user.id, t, t, Math.round(minutes * 10) / 10, str(req.body.note, 200));
  res.status(201).json(entry(id));
});
proRouter.delete('/time/:id', (req, res) => {
  const e = db.prepare('SELECT t.*, l.board_id FROM time_entries t JOIN cards c ON c.id = t.card_id JOIN lists l ON l.id = c.list_id WHERE t.id = ?').get(req.params.id)
    || fail(404, 'Time entry not found');
  const role = assertBoard(e.board_id);
  if (e.user_id !== req.user.id && role !== 'owner') fail(403, 'You can only delete your own time');
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(e.id);
  res.status(204).end();
});

/* ---------- Reports ---------- */

const ymd = (d) => d.toISOString().slice(0, 10);
const weekStart = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
export function boardReport(boardId) {
  const cards = db.prepare(`SELECT c.id, c.list_id, c.completed, c.completed_at, c.created_at, c.priority, c.estimate, c.sprint_id, c.due_date
    FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = ? AND c.archived = 0 AND l.archived = 0 AND c.is_template = 0`).all(boardId);
  const lists = db.prepare('SELECT id, name, wip_limit FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position').all(boardId);
  const open = cards.filter((c) => !c.completed);
  const today = ymd(new Date());
  const byList = lists.map((l) => ({ id: l.id, name: l.name, wip_limit: l.wip_limit, open: open.filter((c) => c.list_id === l.id).length, done: cards.filter((c) => c.completed && c.list_id === l.id).length }));
  const priorities = [0, 1, 2, 3, 4].map((p) => open.filter((c) => (c.priority || 0) === p).length);
  const members = db.prepare(`SELECT u.id, u.display_name, COUNT(*) AS open, COALESCE(SUM(c.estimate), 0) AS points,
      SUM(CASE WHEN c.due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM card_members m JOIN users u ON u.id = m.user_id JOIN cards c ON c.id = m.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND c.archived = 0 AND l.archived = 0 AND c.completed = 0 AND c.is_template = 0
    GROUP BY u.id ORDER BY open DESC`).all(today, boardId);
  const unassigned = db.prepare(`SELECT COUNT(*) FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = ? AND c.archived = 0 AND l.archived = 0
    AND c.completed = 0 AND c.is_template = 0 AND NOT EXISTS (SELECT 1 FROM card_members WHERE card_id = c.id)`).pluck().get(boardId);
  // Created vs completed per week, last 8 weeks.
  const start = weekStart(new Date());
  start.setUTCDate(start.getUTCDate() - 7 * 7);
  const weeks = Array.from({ length: 8 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + 7 * i); return { week: ymd(d), created: 0, completed: 0 }; });
  const slot = (iso) => { if (!iso) return null; const i = Math.floor((Date.parse(iso) - start.getTime()) / (7 * 864e5)); return weeks[i] || null; };
  for (const c of cards) {
    const a = slot(c.created_at); if (a) a.created++;
    const b = c.completed && slot(c.completed_at); if (b) b.completed++;
  }
  // Cycle time: days from created to completed, for cards finished in the last 30 days.
  const recent = cards.filter((c) => c.completed && c.completed_at && Date.now() - Date.parse(c.completed_at) < 30 * 864e5)
    .map((c) => Math.max(0, (Date.parse(c.completed_at) - Date.parse(c.created_at)) / 864e5)).sort((x, y) => x - y);
  const cycle = recent.length ? { count: recent.length, median: recent[Math.floor(recent.length / 2)], avg: recent.reduce((s, x) => s + x, 0) / recent.length } : null;
  // Burndown for the active sprint: remaining cards and points per day.
  const sprint = db.prepare("SELECT * FROM sprints WHERE board_id = ? AND status = 'active'").get(boardId);
  let burndown = null;
  if (sprint) {
    const sc = cards.filter((c) => c.sprint_id === sprint.id);
    const from = sprint.start_date || today;
    const to = sprint.end_date && sprint.end_date > from ? sprint.end_date : today > from ? today : from;
    const days = [];
    for (let d = new Date(`${from}T00:00:00Z`); ymd(d) <= to && days.length < 120; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymd(d));
    const left = (dd) => sc.filter((c) => !(c.completed && c.completed_at && c.completed_at.slice(0, 10) <= dd));
    burndown = {
      sprint, total: sc.length, points: sc.reduce((s, c) => s + (c.estimate || 0), 0),
      days: days.map((d) => (d > today ? { day: d } : { day: d, cards: left(d).length, points: left(d).reduce((s, c) => s + (c.estimate || 0), 0) })),
    };
  }
  const time = db.prepare(`SELECT COALESCE(SUM(t.minutes), 0) FROM time_entries t JOIN cards c ON c.id = t.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND t.ended_at IS NOT NULL`).pluck().get(boardId);
  return {
    totals: { cards: cards.length, open: open.length, done: cards.length - open.length, overdue: open.filter((c) => c.due_date && c.due_date.slice(0, 10) < today).length, points_open: open.reduce((s, c) => s + (c.estimate || 0), 0), time_minutes: time },
    byList, priorities, members, unassigned, weeks, cycle, burndown,
  };
}
proRouter.get('/boards/:id/report', (req, res) => {
  const board = getBoard(req.params.id);
  res.json(boardReport(board.id));
});

/* ---------- Public read-only links ---------- */

proRouter.post('/boards/:id/public-link', (req, res) => {
  const board = getBoard(req.params.id, 'owner');
  const t = token();
  db.prepare('UPDATE boards SET public_token = ? WHERE id = ?').run(t, board.id);
  logActivity(board.id, null, req.who, 'turned on the public read-only link');
  res.json({ public_token: t });
});
proRouter.delete('/boards/:id/public-link', (req, res) => {
  const board = getBoard(req.params.id, 'owner');
  db.prepare('UPDATE boards SET public_token = NULL WHERE id = ?').run(board.id);
  logActivity(board.id, null, req.who, 'turned off the public read-only link');
  res.status(204).end();
});

// Only what a read-only page needs: no people, emails, comments, attachments or activity.
publicRouter.get('/public/:token', (req, res) => {
  const t = String(req.params.token);
  const board = t.length >= 20 && db.prepare('SELECT * FROM boards WHERE public_token = ?').get(t);
  if (!board) fail(404, 'This link is off or does not exist');
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  const lists = db.prepare('SELECT id, name, position FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position').all(board.id);
  const cards = db.prepare(`SELECT c.id, c.list_id, c.title, c.description, c.start_date, c.due_date, c.completed, c.priority, c.estimate, c.parent_id,
      CASE WHEN c.cover LIKE 'color:%' THEN c.cover END AS cover,
      (SELECT json_group_array(label_id) FROM card_labels WHERE card_id = c.id) AS label_ids,
      (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id) AS check_total,
      (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id AND i.done = 1) AS check_done
    FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = ? AND l.archived = 0 AND c.archived = 0 AND c.is_template = 0
    ORDER BY c.position`).all(board.id).map((c) => ({ ...c, label_ids: JSON.parse(c.label_ids) }));
  const labels = db.prepare('SELECT id, name, color FROM labels WHERE board_id = ? ORDER BY rowid').all(board.id);
  res.json({ board: { name: board.name, color: board.color }, lists, cards, labels });
});

/* ---------- Email to board ---------- */

// Turn it on: the owner gets a secret URL to point an inbound-email service (Mailgun, SendGrid,
// Postmark, Cloudflare Email Workers, a Zapier mail hook…) at. Each email becomes a card.
proRouter.post('/boards/:id/inbound', (req, res) => {
  const board = getBoard(req.params.id, 'owner');
  const listId = req.body.list_id && db.prepare('SELECT id FROM lists WHERE id = ? AND board_id = ? AND archived = 0').pluck().get(req.body.list_id, board.id);
  const t = req.body.rotate || !board.inbound_token ? token() : board.inbound_token;
  db.prepare('UPDATE boards SET inbound_token = ?, inbound_list_id = ? WHERE id = ?').run(t, listId || null, board.id);
  res.json({ inbound_token: t, inbound_list_id: listId || null });
});
proRouter.delete('/boards/:id/inbound', (req, res) => {
  const board = getBoard(req.params.id, 'owner');
  db.prepare('UPDATE boards SET inbound_token = NULL, inbound_list_id = NULL WHERE id = ?').run(board.id);
  res.status(204).end();
});

const pick = (b, keys) => { for (const k of keys) if (typeof b[k] === 'string' && b[k].trim()) return b[k]; return ''; };
publicRouter.post('/inbound/:token', express.urlencoded({ extended: false, limit: '2mb' }), (req, res) => {
  const t = String(req.params.token);
  const board = t.length >= 20 && db.prepare('SELECT * FROM boards WHERE inbound_token = ?').get(t);
  if (!board) fail(404, 'Not found');
  const b = req.body || {};
  const subject = str(pick(b, ['subject', 'Subject', 'title']), 2000) || '(no subject)';
  const text = pick(b, ['text', 'body-plain', 'stripped-text', 'TextBody', 'plain', 'body', 'description']).slice(0, 100000);
  const from = str(pick(b, ['from', 'From', 'sender', 'FromFull']), 300);
  const list = (board.inbound_list_id && db.prepare('SELECT * FROM lists WHERE id = ? AND archived = 0').get(board.inbound_list_id))
    || db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position LIMIT 1').get(board.id);
  if (!list) fail(409, 'This board has no lists to add cards to');
  const id = uuid();
  const ts = now();
  const description = `${from ? `*From ${from.replace(/[*_`[\]]/g, '')}*\n\n` : ''}${text}`;
  db.transaction(() => {
    db.prepare('INSERT INTO cards (id, list_id, title, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, list.id, subject, description, nextPos(list.id), ts, ts);
    logActivity(board.id, id, { name: 'Email', id: null }, `added this card to ${list.name} by email`);
  })();
  runAutomations('card_added', { cardId: id, listId: list.id, who: { name: 'Email', id: null } });
  res.status(201).json({ id });
});
