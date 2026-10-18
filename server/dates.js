import { db } from './db.js';
import { VISIBLE_BOARDS_SQL, visibleParams } from './access.js';

// Everything with a date: cards (with their start date), sublists, checklist items and lists.
// Scope (pick one): user (boards they can see), boardIds (already access-checked), or cardId.
// from/to are YYYY-MM-DD, inclusive. Archived cards, lists and boards are left out.
export function datedEvents({ user, boardIds, cardId, from = '0000-01-01', to = '9999-12-31' }) {
  let scope;
  let params;
  if (cardId) {
    scope = 'c.id = ?';
    params = [cardId];
  } else if (boardIds) {
    if (!boardIds.length) return [];
    scope = `b.id IN (${boardIds.map(() => '?').join(',')})`;
    params = boardIds;
  } else {
    scope = VISIBLE_BOARDS_SQL;
    params = visibleParams(user);
  }
  const live = `b.archived = 0 AND l.archived = 0 AND ${scope}`;
  const inRange = (col) => `substr(${col}, 1, 10) BETWEEN ? AND ?`;
  const cardsJoin = 'JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id';
  const rows = [
    ...db.prepare(`
      SELECT 'card' AS type, c.id, c.id AS card_id, c.title, c.description, c.due_date AS date, c.start_date, c.completed AS done,
        l.name AS list_name, b.id AS board_id, b.name AS board_name, b.color AS board_color,
        (SELECT json_group_array(label_id) FROM card_labels WHERE card_id = c.id) AS label_ids,
        (SELECT json_group_array(user_id) FROM card_members WHERE card_id = c.id) AS member_ids
      FROM cards c ${cardsJoin}
      WHERE c.archived = 0 AND ${live} AND c.due_date IS NOT NULL
        AND substr(COALESCE(c.start_date, c.due_date), 1, 10) <= ? AND substr(c.due_date, 1, 10) >= ?`)
      .all(...params, to, from),
    ...db.prepare(`
      SELECT 'checklist' AS type, cl.id, c.id AS card_id, cl.title || ' · ' || c.title AS title, cl.due_date AS date,
        NOT EXISTS (SELECT 1 FROM checklist_items i WHERE i.checklist_id = cl.id AND i.done = 0) AS done,
        l.name AS list_name, b.id AS board_id, b.name AS board_name, b.color AS board_color
      FROM checklists cl JOIN cards c ON c.id = cl.card_id ${cardsJoin}
      WHERE c.archived = 0 AND ${live} AND cl.due_date IS NOT NULL AND ${inRange('cl.due_date')}`)
      .all(...params, from, to),
    ...db.prepare(`
      SELECT 'item' AS type, i.id, c.id AS card_id, i.text || ' · ' || c.title AS title, i.due_date AS date, i.done,
        l.name AS list_name, b.id AS board_id, b.name AS board_name, b.color AS board_color
      FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id JOIN cards c ON c.id = cl.card_id ${cardsJoin}
      WHERE c.archived = 0 AND ${live} AND i.due_date IS NOT NULL AND ${inRange('i.due_date')}`)
      .all(...params, from, to),
    // Lists have no card, so a card scope skips them.
    ...(cardId ? [] : db.prepare(`
      SELECT 'list' AS type, l.id, NULL AS card_id, l.name AS title, l.due_date AS date, 0 AS done,
        l.name AS list_name, b.id AS board_id, b.name AS board_name, b.color AS board_color
      FROM lists l JOIN boards b ON b.id = l.board_id
      WHERE ${live} AND l.due_date IS NOT NULL AND ${inRange('l.due_date')}`)
      .all(...params, from, to)),
  ].map((r) => ({
    ...r,
    done: !!r.done,
    label_ids: r.label_ids ? JSON.parse(r.label_ids) : [],
    member_ids: r.member_ids ? JSON.parse(r.member_ids) : [],
  }));
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- Turning dated rows into calendar events ---------- */

const pad = (n) => String(n).padStart(2, '0');
const nextDay = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const plusMinutes = (dt, m) => {
  const [d, t] = dt.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const x = new Date(Date.UTC(y, mo - 1, da, h, mi + m));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
};

export const PUBLIC_URL = () => (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');

// A neutral event shape: { uid, title, description, url, allDay, start, end } where all-day events use
// YYYY-MM-DD (end exclusive) and timed events use local YYYY-MM-DDTHH:mm (floating, in the server's zone).
export function toEvent(r) {
  const prefix = { card: '', checklist: '☑ ', item: '• ', list: '▤ ' }[r.type];
  const url = PUBLIC_URL() ? `${PUBLIC_URL()}/#/b/${r.board_id}${r.card_id ? `/c/${r.card_id}` : ''}` : '';
  const where = r.type === 'list' ? r.board_name : `${r.board_name} › ${r.list_name}`;
  const description = [where, r.type === 'card' && r.description ? r.description.slice(0, 2000) : '', url].filter(Boolean).join('\n\n');
  const title = `${r.done ? '✓ ' : ''}${prefix}${r.title}`;
  const due = r.date;
  const base = { uid: `${r.type}-${r.id}@rackboard`, kind: r.type, ref: r.id, title, description, url };
  if (r.type === 'card' && r.start_date) {
    return { ...base, allDay: true, start: r.start_date.slice(0, 10), end: nextDay(due.slice(0, 10)) };
  }
  if (due.length > 10) return { ...base, allDay: false, start: due.slice(0, 16), end: plusMinutes(due.slice(0, 16), 30) };
  return { ...base, allDay: true, start: due, end: nextDay(due) };
}

/* ---------- iCalendar (RFC 5545) ---------- */

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => d.replace(/-/g, '');
const icsDateTime = (dt) => `${dt.slice(0, 10).replace(/-/g, '')}T${dt.slice(11, 16).replace(':', '')}00`;

// Lines longer than 75 octets are folded with CRLF + space.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch, 'utf8') > (parts.length ? 74 : 75)) { parts.push(current); current = ''; }
    current += ch;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(events, calName = 'Rackboard') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rackboard//Kanban//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(calName)}`,
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end)}`);
    else lines.push(`DTSTART:${icsDateTime(e.start)}`, `DTEND:${icsDateTime(e.end)}`);
    lines.push(`SUMMARY:${icsText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
