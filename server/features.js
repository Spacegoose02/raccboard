import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, uuid, now, logActivity, DEFAULT_LABELS, UPLOAD_DIR } from './db.js';
import { assertBoard } from './access.js';
import { BOARD_TEMPLATES } from './templates.js';

// Trello-style extras: copy card, card and board templates, automation rules, Trello import.
export const featuresRouter = express.Router();

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nextPos = (table, col, parent) =>
  (db.prepare(`SELECT MAX(position) AS m FROM ${table} WHERE ${col} = ?`).get(parent).m ?? -1) + 1;
const cardRow = (id) => db.prepare('SELECT c.*, l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?').get(id);
const listRow = (id) => db.prepare('SELECT * FROM lists WHERE id = ?').get(id);

/* ---------- Copying cards ---------- */

// Copies a card into a list. keep: { checklists, labels, members, dates, attachments, description } (all default true).
export function copyCard(src, targetList, { title, keep = {}, who, asTemplate = false, index } = {}) {
  const k = { checklists: true, labels: true, members: true, dates: true, attachments: true, description: true, ...keep };
  const id = uuid();
  const t = now();
  const sameBoard = targetList.board_id === src.board_id;
  const copied = [];
  db.transaction(() => {
    db.prepare(`INSERT INTO cards (id, list_id, title, description, position, start_date, due_date, cover, is_template, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, targetList.id, title || src.title, k.description ? src.description : '', nextPos('cards', 'list_id', targetList.id),
        k.dates ? src.start_date : null, k.dates ? src.due_date : null,
        src.cover?.startsWith('color:') ? src.cover : null, asTemplate ? 1 : 0, t, t);
    if (k.checklists) {
      for (const cl of db.prepare('SELECT * FROM checklists WHERE card_id = ? ORDER BY position').all(src.id)) {
        const clId = uuid();
        db.prepare('INSERT INTO checklists (id, card_id, title, position, due_date) VALUES (?, ?, ?, ?, ?)').run(clId, id, cl.title, cl.position, k.dates ? cl.due_date : null);
        for (const it of db.prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY position').all(cl.id)) {
          db.prepare('INSERT INTO checklist_items (id, checklist_id, text, done, due_date, position) VALUES (?, ?, ?, 0, ?, ?)')
            .run(uuid(), clId, it.text, k.dates ? it.due_date : null, it.position);
        }
      }
    }
    // Labels and members belong to a board, so they only carry over within it.
    if (k.labels && sameBoard) db.prepare('INSERT INTO card_labels (card_id, label_id) SELECT ?, label_id FROM card_labels WHERE card_id = ?').run(id, src.id);
    if (k.members && sameBoard) db.prepare('INSERT INTO card_members (card_id, user_id) SELECT ?, user_id FROM card_members WHERE card_id = ?').run(id, src.id);
    if (k.attachments) {
      for (const a of db.prepare('SELECT * FROM attachments WHERE card_id = ?').all(src.id)) {
        const stored = uuid();
        const from = path.join(UPLOAD_DIR, path.basename(a.stored_name));
        if (!fs.existsSync(from)) continue;
        fs.copyFileSync(from, path.join(UPLOAD_DIR, stored));
        copied.push(stored);
        db.prepare('INSERT INTO attachments (id, card_id, filename, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuid(), id, a.filename, stored, a.mime, a.size, t);
      }
    }
    if (Number.isInteger(index)) {
      const ids = db.prepare('SELECT id FROM cards WHERE list_id = ? AND id != ? AND archived = 0 ORDER BY position').pluck().all(targetList.id, id);
      ids.splice(Math.max(0, Math.min(ids.length, index)), 0, id);
      const upd = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
      ids.forEach((cid, i) => upd.run(i, cid));
    }
    if (who) logActivity(targetList.board_id, id, who, src.is_template && !asTemplate ? `created this card from template "${src.title}"` : `copied this card from "${src.title}"`);
  })();
  return id;
}

featuresRouter.post('/cards/:id/copy', (req, res) => {
  const src = cardRow(req.params.id) || fail(404, 'Card not found');
  assertBoard(src.board_id, 'viewer');
  const target = listRow(req.body.list_id || src.list_id) || fail(404, 'List not found');
  assertBoard(target.board_id, 'editor');
  const keep = typeof req.body.keep === 'object' && req.body.keep ? req.body.keep : {};
  const id = copyCard(src, target, {
    title: str(req.body.title, 300), keep, who: req.who, asTemplate: !!req.body.template,
    index: Number.isInteger(req.body.index) ? req.body.index : undefined,
  });
  runAutomations('card_added', { cardId: id, listId: target.id, who: req.who });
  res.status(201).json(cardRow(id));
});

/* ---------- Board templates and copying boards ---------- */

featuresRouter.get('/board-templates', (_req, res) => {
  res.json(BOARD_TEMPLATES.map(({ id, name, description, color, lists }) => ({ id, name, description, color, lists: lists.map((l) => l.name) })));
});

// Creates a board owned by `user` from a built-in template or an existing board.
export function createBoardFrom({ user, who, name, color, templateId, fromBoardId, includeCards = true }) {
  const boardId = uuid();
  const position = (db.prepare('SELECT MAX(position) AS m FROM boards').get().m ?? -1) + 1;
  db.transaction(() => {
    if (fromBoardId) {
      const src = db.prepare('SELECT * FROM boards WHERE id = ?').get(fromBoardId);
      db.prepare('INSERT INTO boards (id, name, color, position, created_at, owner_id, layout) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(boardId, name || `${src.name} (copy)`, color || src.color, position, now(), user.id, src.layout);
      const labelMap = new Map();
      for (const l of db.prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY rowid').all(src.id)) {
        const id = uuid();
        labelMap.set(l.id, id);
        db.prepare('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)').run(id, boardId, l.name, l.color);
      }
      const listMap = new Map();
      for (const l of db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position').all(src.id)) {
        const id = uuid();
        listMap.set(l.id, id);
        db.prepare('INSERT INTO lists (id, board_id, name, position, due_date, collapsed) VALUES (?, ?, ?, ?, ?, ?)').run(id, boardId, l.name, l.position, l.due_date, l.collapsed);
        if (!includeCards) continue;
        for (const c of db.prepare('SELECT c.*, ? AS board_id FROM cards c WHERE list_id = ? AND archived = 0 ORDER BY position').all(src.id, l.id)) {
          const newId = copyCard(c, { id, board_id: boardId }, { keep: { labels: false, members: false, attachments: false }, asTemplate: !!c.is_template });
          for (const lid of db.prepare('SELECT label_id FROM card_labels WHERE card_id = ?').pluck().all(c.id)) {
            if (labelMap.has(lid)) db.prepare('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)').run(newId, labelMap.get(lid));
          }
        }
      }
      for (const r of db.prepare('SELECT * FROM automations WHERE board_id = ?').all(src.id)) {
        const mapRef = (v) => (r.action === 'move_to_list' ? listMap.get(v) : labelMap.get(v)) || v;
        db.prepare(`INSERT INTO automations (id, board_id, trigger, trigger_list_id, action, action_value, enabled, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uuid(), boardId, r.trigger, r.trigger_list_id ? listMap.get(r.trigger_list_id) || null : null, r.action, r.action_value && mapRef(r.action_value), r.enabled, now());
      }
      logActivity(boardId, null, who, `created this board as a copy of "${src.name}"`);
      return;
    }
    const tpl = BOARD_TEMPLATES.find((t) => t.id === templateId) || fail(400, 'Unknown template');
    db.prepare('INSERT INTO boards (id, name, color, position, created_at, owner_id, layout) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(boardId, name || tpl.name, color || tpl.color, position, now(), user.id, tpl.layout || null);
    const labelIds = new Map();
    for (const l of tpl.labels || DEFAULT_LABELS) {
      const id = uuid();
      labelIds.set(l.name, id);
      db.prepare('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)').run(id, boardId, l.name, l.color);
    }
    const listIds = new Map();
    tpl.lists.forEach((l, i) => {
      const listId = uuid();
      listIds.set(l.name, listId);
      db.prepare('INSERT INTO lists (id, board_id, name, position) VALUES (?, ?, ?, ?)').run(listId, boardId, l.name, i);
      (l.cards || []).forEach((c, j) => {
        const cardId = uuid();
        const t = now();
        db.prepare('INSERT INTO cards (id, list_id, title, description, position, is_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(cardId, listId, c.title, c.description || '', j, c.template ? 1 : 0, t, t);
        (c.labels || []).forEach((n) => labelIds.has(n) && db.prepare('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)').run(cardId, labelIds.get(n)));
        (c.checklists || []).forEach((cl, k) => {
          const clId = uuid();
          db.prepare('INSERT INTO checklists (id, card_id, title, position) VALUES (?, ?, ?, ?)').run(clId, cardId, cl.title, k);
          cl.items.forEach((text, m) => db.prepare('INSERT INTO checklist_items (id, checklist_id, text, position) VALUES (?, ?, ?, ?)').run(uuid(), clId, text, m));
        });
      });
    });
    for (const r of tpl.rules || []) {
      const ref = (v) => (r.action === 'move_to_list' ? listIds.get(v) : labelIds.get(v)) || v;
      db.prepare(`INSERT INTO automations (id, board_id, trigger, trigger_list_id, action, action_value, enabled, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
        .run(uuid(), boardId, r.trigger, r.list ? listIds.get(r.list) : null, r.action, r.value != null ? ref(r.value) : null, now());
    }
    logActivity(boardId, null, who, `created board "${name || tpl.name}" from the ${tpl.name} template`);
  })();
  return boardId;
}

featuresRouter.post('/boards/:id/copy', (req, res) => {
  assertBoard(req.params.id, 'viewer');
  const id = createBoardFrom({
    user: req.user, who: req.who, fromBoardId: req.params.id, name: str(req.body.name, 120),
    includeCards: req.body.include_cards !== false,
  });
  res.status(201).json({ ...db.prepare('SELECT * FROM boards WHERE id = ?').get(id), my_role: 'owner' });
});

/* ---------- Automation rules (Butler-style) ---------- */

// trigger: card_added | card_moved | card_completed | checklist_completed (list-scoped ones may name a list)
// action: complete | uncomplete | archive | move_to_list | add_label | remove_label | join_actor | set_due_days | remove_due
export const TRIGGERS = ['card_added', 'card_moved', 'card_completed', 'checklist_completed'];
export const ACTIONS = ['complete', 'uncomplete', 'archive', 'move_to_list', 'add_label', 'remove_label', 'join_actor', 'set_due_days', 'remove_due'];

let running = false;
// Runs the board's enabled rules for an event. Changes made by rules don't trigger more rules, so they can't loop.
export function runAutomations(trigger, { cardId, listId, who }) {
  if (running) return;
  const card = cardRow(cardId);
  if (!card) return;
  const rules = db.prepare(`SELECT * FROM automations WHERE board_id = ? AND trigger = ? AND enabled = 1
    AND (trigger_list_id IS NULL OR trigger_list_id = ?) ORDER BY created_at`).all(card.board_id, trigger, listId || card.list_id);
  if (!rules.length) return;
  running = true;
  try {
    for (const r of rules) {
      const c = cardRow(cardId);
      if (!c) break;
      const log = (text) => logActivity(c.board_id, c.id, { name: 'Automation', id: null }, text);
      const touch = () => db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now(), c.id);
      switch (r.action) {
        case 'complete': if (!c.completed) { db.prepare('UPDATE cards SET completed = 1 WHERE id = ?').run(c.id); touch(); log('marked this card complete'); } break;
        case 'uncomplete': if (c.completed) { db.prepare('UPDATE cards SET completed = 0 WHERE id = ?').run(c.id); touch(); log('marked this card incomplete'); } break;
        case 'archive': if (!c.archived) { db.prepare('UPDATE cards SET archived = 1 WHERE id = ?').run(c.id); touch(); log('archived this card'); } break;
        case 'remove_due': if (c.due_date) { db.prepare('UPDATE cards SET due_date = NULL WHERE id = ?').run(c.id); touch(); log('removed the due date'); } break;
        case 'set_due_days': {
          const d = new Date();
          d.setDate(d.getDate() + (Number(r.action_value) || 0));
          const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          db.prepare('UPDATE cards SET due_date = ? WHERE id = ?').run(due, c.id); touch(); log(`set the due date to ${due}`);
          break;
        }
        case 'add_label': {
          const l = db.prepare('SELECT * FROM labels WHERE id = ? AND board_id = ?').get(r.action_value, c.board_id);
          if (l && db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(c.id, l.id).changes) log(`added label "${l.name || l.color}"`);
          break;
        }
        case 'remove_label': {
          const l = db.prepare('SELECT * FROM labels WHERE id = ? AND board_id = ?').get(r.action_value, c.board_id);
          if (l && db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?').run(c.id, l.id).changes) log(`removed label "${l.name || l.color}"`);
          break;
        }
        case 'join_actor':
          if (who?.id && db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)').run(c.id, who.id).changes) log(`added ${who.name} to this card`);
          break;
        case 'move_to_list': {
          const to = db.prepare('SELECT * FROM lists WHERE id = ? AND board_id = ?').get(r.action_value, c.board_id);
          if (to && to.id !== c.list_id) {
            const from = listRow(c.list_id);
            db.prepare('UPDATE cards SET list_id = ?, position = ? WHERE id = ?').run(to.id, nextPos('cards', 'list_id', to.id), c.id);
            touch();
            log(`moved this card from ${from.name} to ${to.name}`);
          }
          break;
        }
        default: break;
      }
    }
  } finally {
    running = false;
  }
}

function cleanRule(boardId, b) {
  const trigger = TRIGGERS.includes(b.trigger) ? b.trigger : fail(400, 'Unknown trigger');
  const action = ACTIONS.includes(b.action) ? b.action : fail(400, 'Unknown action');
  const listId = b.trigger_list_id ? String(b.trigger_list_id) : null;
  if (listId && !db.prepare('SELECT 1 FROM lists WHERE id = ? AND board_id = ?').get(listId, boardId)) fail(400, 'That list is not on this board');
  let value = b.action_value == null ? null : String(b.action_value).slice(0, 64);
  if (action === 'move_to_list' && !db.prepare('SELECT 1 FROM lists WHERE id = ? AND board_id = ?').get(value, boardId)) fail(400, 'Choose a list to move to');
  if (['add_label', 'remove_label'].includes(action) && !db.prepare('SELECT 1 FROM labels WHERE id = ? AND board_id = ?').get(value, boardId)) fail(400, 'Choose a label');
  if (action === 'set_due_days') value = String(Math.max(0, Math.min(365, Math.round(Number(value) || 0))));
  return { trigger, listId, action, value };
}

featuresRouter.get('/boards/:id/automations', (req, res) => {
  assertBoard(req.params.id, 'viewer');
  res.json(db.prepare('SELECT * FROM automations WHERE board_id = ? ORDER BY created_at').all(req.params.id));
});

featuresRouter.post('/boards/:id/automations', (req, res) => {
  assertBoard(req.params.id, 'editor');
  const r = cleanRule(req.params.id, req.body);
  const id = uuid();
  db.prepare(`INSERT INTO automations (id, board_id, trigger, trigger_list_id, action, action_value, enabled, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).run(id, req.params.id, r.trigger, r.listId, r.action, r.value, now());
  res.status(201).json(db.prepare('SELECT * FROM automations WHERE id = ?').get(id));
});

featuresRouter.patch('/automations/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id) || fail(404, 'Rule not found');
  assertBoard(rule.board_id, 'editor');
  if ('enabled' in req.body) db.prepare('UPDATE automations SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, rule.id);
  res.json(db.prepare('SELECT * FROM automations WHERE id = ?').get(rule.id));
});

featuresRouter.delete('/automations/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id) || fail(404, 'Rule not found');
  assertBoard(rule.board_id, 'editor');
  db.prepare('DELETE FROM automations WHERE id = ?').run(rule.id);
  res.status(204).end();
});

/* ---------- Import from Trello (board JSON export) ---------- */

const TRELLO_COLORS = {
  green: '#4bce97', yellow: '#e2b203', orange: '#fea362', red: '#f87168', purple: '#9f8fef',
  blue: '#579dff', sky: '#6cc3e0', lime: '#94c748', pink: '#e774bb', black: '#8590a2',
  green_dark: '#1f845a', yellow_dark: '#946f00', orange_dark: '#c25100', red_dark: '#c9372c', purple_dark: '#6e5dc6',
  blue_dark: '#0c66e4', sky_dark: '#227d9b', lime_dark: '#5b7f24', pink_dark: '#ae4787', black_dark: '#626f86',
  green_light: '#baf3db', yellow_light: '#f8e6a0', orange_light: '#fedec8', red_light: '#ffd5d2', purple_light: '#dfd8fd',
  blue_light: '#cce0ff', sky_light: '#c6edfb', lime_light: '#d3f1a7', pink_light: '#fdd0ec', black_light: '#dcdfe4',
};
// Trello stores UTC instants; Raccboard stores local wall-clock times.
function trelloDate(v, dateOnly = false) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return dateOnly ? day : `${day}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function importTrello(json, user, who) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.lists) || !Array.isArray(json.cards)) fail(400, "That doesn't look like a Trello board export (Menu → Print, export and share → Export as JSON)");
  const boardId = uuid();
  const t = now();
  const byPos = (a, b) => (a.pos ?? 0) - (b.pos ?? 0);
  const stats = { lists: 0, cards: 0, checklists: 0, comments: 0, labels: 0 };
  db.transaction(() => {
    db.prepare('INSERT INTO boards (id, name, color, position, created_at, owner_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(boardId, str(json.name, 120) || 'Imported from Trello', TRELLO_COLORS[json.prefs?.background] || null,
        (db.prepare('SELECT MAX(position) AS m FROM boards').get().m ?? -1) + 1, t, user.id);
    const labels = new Map();
    for (const l of json.labels || []) {
      if (!l.color && !l.name) continue;
      const id = uuid();
      labels.set(l.id, id);
      db.prepare('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)').run(id, boardId, str(l.name, 60), TRELLO_COLORS[l.color] || '#64748b');
      stats.labels++;
    }
    const lists = new Map();
    [...json.lists].sort(byPos).forEach((l, i) => {
      const id = uuid();
      lists.set(l.id, id);
      db.prepare('INSERT INTO lists (id, board_id, name, position, archived) VALUES (?, ?, ?, ?, ?)').run(id, boardId, str(l.name, 120) || 'List', i, l.closed ? 1 : 0);
      stats.lists++;
    });
    const cards = new Map();
    const positions = new Map();
    for (const c of [...json.cards].sort(byPos)) {
      const listId = lists.get(c.idList);
      if (!listId) continue;
      const id = uuid();
      cards.set(c.id, id);
      const pos = positions.get(listId) || 0;
      positions.set(listId, pos + 1);
      const links = (c.attachments || []).filter((a) => a.url).map((a) => `- [${a.name || a.url}](${a.url})`);
      const description = [typeof c.desc === 'string' ? c.desc : '', links.length ? `**Trello attachments**\n${links.join('\n')}` : ''].filter(Boolean).join('\n\n').slice(0, 100000);
      const cover = c.cover?.color && TRELLO_COLORS[c.cover.color] ? `color:${TRELLO_COLORS[c.cover.color]}` : null;
      db.prepare(`INSERT INTO cards (id, list_id, title, description, position, start_date, due_date, completed, archived, cover, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, listId, str(c.name, 300) || 'Card', description, pos, trelloDate(c.start, true), trelloDate(c.due),
          c.dueComplete ? 1 : 0, c.closed ? 1 : 0, cover, t, c.dateLastActivity || t);
      for (const lid of c.idLabels || []) if (labels.has(lid)) db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(id, labels.get(lid));
      stats.cards++;
    }
    for (const cl of [...(json.checklists || [])].sort(byPos)) {
      const cardId = cards.get(cl.idCard);
      if (!cardId) continue;
      const id = uuid();
      db.prepare('INSERT INTO checklists (id, card_id, title, position) VALUES (?, ?, ?, ?)').run(id, cardId, str(cl.name, 200) || 'Checklist', nextPos('checklists', 'card_id', cardId));
      [...(cl.checkItems || [])].sort(byPos).forEach((it, i) => {
        db.prepare('INSERT INTO checklist_items (id, checklist_id, text, done, due_date, position) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuid(), id, str(it.name, 500) || 'Item', it.state === 'complete' ? 1 : 0, trelloDate(it.due), i);
      });
      stats.checklists++;
    }
    for (const a of json.actions || []) {
      if (a.type !== 'commentCard' || !cards.has(a.data?.card?.id) || typeof a.data.text !== 'string') continue;
      db.prepare('INSERT INTO comments (id, card_id, author, user_id, body, created_at) VALUES (?, ?, ?, NULL, ?, ?)')
        .run(uuid(), cards.get(a.data.card.id), str(a.memberCreator?.fullName, 60) || 'Trello user', a.data.text.slice(0, 20000), a.date || t);
      stats.comments++;
    }
    logActivity(boardId, null, who, `imported this board from Trello (${stats.cards} cards)`);
  })();
  return { board_id: boardId, ...stats };
}

featuresRouter.post('/import/trello', (req, res) => {
  res.status(201).json(importTrello(req.body, req.user, req.who));
});

