// @ts-check
import express from 'express';
import { db, now, uuid } from './db.js';
import { boardRole } from './access.js';
import { sendNotificationEmail } from './email.js';
import { PUBLIC_URL } from './dates.js';

// In-app notifications: @mentions in comments, being added to a card, and due-date reminders
// for cards you're a member of. Each one can also go out by email when SMTP is set up.
export const notificationsRouter = express.Router();

const cardLink = (boardId, cardId) => (PUBLIC_URL() ? `${PUBLIC_URL()}/#/b/${boardId}${cardId ? `/c/${cardId}` : ''}` : '');

/**
 * @param {{ userId: string, kind: string, text: string, boardId?: string, cardId?: string, actor?: string, dedupe?: string }} n
 */
export function notify({ userId, kind, boardId, cardId, actor, text, dedupe }) {
  const r = db.prepare(`INSERT OR IGNORE INTO notifications (id, user_id, kind, board_id, card_id, actor, text, dedupe, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uuid(), userId, kind, boardId || null, cardId || null, actor || null, text, dedupe || null, now());
  if (!r.changes) return;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (user?.notify_email) {
    const link = cardLink(boardId, cardId);
    sendNotificationEmail(user, `Raccboard: ${text}`, `${text}${link ? `\n\n${link}` : ''}\n`)
      .catch((e) => console.warn('Notification email failed:', e.message));
  }
}

// @username or @"Display Name" mentions in a comment, limited to people who can open the board.
export function notifyMentions({ body, card, who }) {
  const names = new Set([...body.matchAll(/@"([^"]{1,80})"|@([\w.-]{1,40})/g)].map((m) => (m[1] || m[2]).toLowerCase()));
  if (!names.size) return;
  const users = db.prepare('SELECT * FROM users').all()
    .filter((u) => names.has(u.username.toLowerCase()) || names.has(u.display_name.toLowerCase()));
  for (const u of users) {
    if (u.id === who.id || !boardRole(card.board_id, u)) continue;
    notify({ userId: u.id, kind: 'mention', boardId: card.board_id, cardId: card.id, actor: who.name, text: `${who.name} mentioned you on "${card.title}"` });
  }
}

// Due within the next 24 hours (or overdue today) on open cards: remind each member once per due date.
export function sendDueReminders() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT c.id, c.title, c.due_date, l.board_id, m.user_id FROM cards c
    JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id JOIN card_members m ON m.card_id = c.id
    WHERE c.archived = 0 AND l.archived = 0 AND b.archived = 0 AND c.completed = 0
      AND c.due_date IS NOT NULL AND substr(c.due_date, 1, 10) BETWEEN ? AND ?`).all(today, tomorrow);
  for (const r of rows) {
    const when = r.due_date.slice(0, 10) === today ? 'today' : 'tomorrow';
    notify({ userId: r.user_id, kind: 'due', boardId: r.board_id, cardId: r.id, text: `"${r.title}" is due ${when}`, dedupe: `due:${r.id}:${r.due_date}` });
  }
}
setInterval(() => { try { sendDueReminders(); } catch (e) { console.warn('Reminders failed:', e.message); } }, 15 * 60000).unref();
setTimeout(() => { try { sendDueReminders(); } catch { /* retried on the interval */ } }, 10000).unref();

notificationsRouter.get('/notifications', (req, res) => {
  const items = db.prepare(`SELECT n.*, b.name AS board_name FROM notifications n LEFT JOIN boards b ON b.id = n.board_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL').pluck().get(req.user.id);
  res.json({ items, unread, email: !!req.user.notify_email });
});

notificationsRouter.post('/notifications/read', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : null;
  if (ids) {
    const mark = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
    db.transaction(() => ids.forEach((id) => mark.run(now(), id, req.user.id)))();
  } else {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), req.user.id);
  }
  res.status(204).end();
});

notificationsRouter.put('/notifications/email', (req, res) => {
  db.prepare('UPDATE users SET notify_email = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, req.user.id);
  res.status(204).end();
});
