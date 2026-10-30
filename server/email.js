import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { db, logActivity, UPLOAD_DIR } from './db.js';
import { assertBoard } from './access.js';
import { buildIcs, datedEvents, PUBLIC_URL, toEvent } from './dates.js';

// Email: server SMTP settings (admins) and "send this card by email" (anyone who can open the card).
export const emailRouter = express.Router();

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const env = (k) => (process.env[k] ?? '').trim();

// Settings come from the database (Settings → Email); environment variables fill in anything unset.
const KEYS = ['host', 'port', 'secure', 'user', 'pass', 'from'];
function smtpSettings() {
  const stored = Object.fromEntries(db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'smtp_%'").all()
    .map((r) => [r.key.slice(5), r.value]));
  const pick = (k) => stored[k] ?? env(`SMTP_${k.toUpperCase()}`);
  const port = Number(pick('port')) || 587;
  return {
    host: pick('host'),
    port,
    secure: pick('secure') ? ['true', '1', 'yes'].includes(String(pick('secure')).toLowerCase()) : port === 465,
    user: pick('user'),
    pass: pick('pass'),
    from: pick('from') || pick('user'),
  };
}
const configured = (s = smtpSettings()) => !!(s.host && s.from);
export const emailConfigured = () => configured();

export async function sendResetEmail(user, link, minutes) {
  const s = smtpSettings();
  await transport(s).sendMail({
    from: s.from,
    to: user.email,
    subject: 'Reset your Raccboard password',
    text: `Hi ${user.display_name},\n\nSomeone asked to reset the password for the Raccboard account "${user.username}".\n`
      + `Open this link within ${minutes} minutes to choose a new password:\n\n${link}\n\nIf it wasn't you, ignore this email; your password stays the same.`,
  });
}

function transport(s = smtpSettings()) {
  return nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000,
  });
}

const requireAdmin = (req) => { if (req.user.role !== 'admin') fail(403, 'Admins only'); };
const publicSettings = (s = smtpSettings()) => ({
  configured: configured(s), host: s.host, port: s.port, secure: s.secure, user: s.user, from: s.from, has_password: !!s.pass,
});

emailRouter.get('/email/status', (req, res) => {
  const s = smtpSettings();
  res.json(req.user.role === 'admin' ? publicSettings(s) : { configured: configured(s) });
});

emailRouter.put('/email/settings', (req, res) => {
  requireAdmin(req);
  const upsert = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const k of KEYS) {
      if (!(k in req.body)) continue;
      // An empty password field means "keep the current one" unless clear_password is set.
      if (k === 'pass' && !req.body.pass && !req.body.clear_password) continue;
      upsert.run(`smtp_${k}`, String(req.body[k] ?? '').trim().slice(0, 300));
    }
  })();
  res.json(publicSettings());
});

emailRouter.post('/email/test', async (req, res) => {
  requireAdmin(req);
  const s = smtpSettings();
  if (!configured(s)) fail(400, 'Set an SMTP host and From address first');
  const to = String(req.body.to || req.user.email || '').trim();
  if (!to) fail(400, 'Add an email address to your profile, or enter one to send the test to');
  try {
    await transport(s).sendMail({ from: s.from, to, subject: 'Raccboard test email 🦝', text: 'Email from Raccboard works.' });
  } catch (e) {
    fail(502, `Sending failed: ${e.message}`);
  }
  res.json({ ok: true, to });
});

/* ---------- Send a card ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isEmail = (e) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e);
const sent = new Map(); // userId -> timestamps, for a simple hourly limit

function cardDetails(cardId) {
  const card = db.prepare(`SELECT c.*, l.name AS list_name, l.board_id, b.name AS board_name FROM cards c
    JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id WHERE c.id = ?`).get(cardId) || fail(404, 'Card not found');
  card.labels = db.prepare('SELECT l.name, l.color FROM card_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.card_id = ?').all(card.id);
  card.members = db.prepare('SELECT u.display_name FROM card_members m JOIN users u ON u.id = m.user_id WHERE m.card_id = ?').pluck().all(card.id);
  card.checklists = db.prepare('SELECT * FROM checklists WHERE card_id = ? ORDER BY position').all(card.id);
  const items = db.prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY position');
  card.checklists.forEach((cl) => { cl.items = items.all(cl.id); });
  card.attachments = db.prepare('SELECT * FROM attachments WHERE card_id = ? ORDER BY created_at').all(card.id);
  return card;
}

function render(card, sender, note) {
  const url = PUBLIC_URL() ? `${PUBLIC_URL()}/#/b/${card.board_id}/c/${card.id}` : '';
  const dates = [card.start_date && `Start: ${card.start_date.replace('T', ' ')}`, card.due_date && `Due: ${card.due_date.replace('T', ' ')}`].filter(Boolean);
  const text = [
    note && `${sender} wrote:\n${note}\n`,
    card.title,
    `${card.board_name} › ${card.list_name}${card.completed ? ' · ✓ complete' : ''}`,
    dates.join(' · '),
    card.labels.length && `Labels: ${card.labels.map((l) => l.name).join(', ')}`,
    card.members.length && `Members: ${card.members.join(', ')}`,
    card.description && `\n${card.description}`,
    ...card.checklists.map((cl) => `\n${cl.title}${cl.due_date ? ` (due ${cl.due_date})` : ''}\n${cl.items.map((i) => `  [${i.done ? 'x' : ' '}] ${i.text}${i.due_date ? ` (due ${i.due_date})` : ''}`).join('\n')}`),
    url && `\nOpen in Raccboard: ${url}`,
  ].filter(Boolean).join('\n');

  const chip = (l) => `<span style="display:inline-block;background:${esc(l.color)};color:#fff;border-radius:4px;padding:1px 8px;margin-right:4px;font-size:12px;font-weight:600">${esc(l.name)}</span>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#172b4d">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #dfe1e6">
    ${note ? `<div style="background:#f4f5f7;border-radius:8px;padding:12px;margin-bottom:16px"><b>${esc(sender)}</b> wrote:<div style="white-space:pre-wrap;margin-top:4px">${esc(note)}</div></div>` : ''}
    <div style="color:#5e6c84;font-size:13px">${esc(card.board_name)} › ${esc(card.list_name)}</div>
    <h1 style="font-size:22px;margin:4px 0 12px">${card.completed ? '✓ ' : ''}${esc(card.title)}</h1>
    ${card.labels.length ? `<div style="margin-bottom:10px">${card.labels.map(chip).join('')}</div>` : ''}
    ${dates.length ? `<p style="margin:6px 0">🕑 ${esc(dates.join(' · '))}</p>` : ''}
    ${card.members.length ? `<p style="margin:6px 0">👤 ${esc(card.members.join(', '))}</p>` : ''}
    ${card.description ? `<div style="white-space:pre-wrap;border-top:1px solid #dfe1e6;padding-top:12px;margin-top:12px">${esc(card.description)}</div>` : ''}
    ${card.checklists.map((cl) => `<h3 style="font-size:15px;margin:16px 0 6px">☑ ${esc(cl.title)}${cl.due_date ? ` <span style="color:#5e6c84;font-weight:400">· due ${esc(cl.due_date)}</span>` : ''}</h3>
      <ul style="list-style:none;padding:0;margin:0">${cl.items.map((i) => `<li style="padding:2px 0">${i.done ? '☑' : '☐'} <span style="${i.done ? 'text-decoration:line-through;color:#5e6c84' : ''}">${esc(i.text)}</span>${i.due_date ? ` <span style="color:#5e6c84;font-size:12px">due ${esc(i.due_date)}</span>` : ''}</li>`).join('')}</ul>`).join('')}
    ${card.attachments.length ? `<p style="color:#5e6c84;font-size:13px;margin-top:16px">📎 ${card.attachments.map((a) => esc(a.filename)).join(', ')}</p>` : ''}
    ${url ? `<p style="margin-top:20px"><a href="${esc(url)}" style="background:#0c66e4;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;display:inline-block">Open in Raccboard</a></p>` : ''}
  </div>
  <p style="text-align:center;color:#8590a2;font-size:12px">Sent from Raccboard 🦝 by ${esc(sender)}</p>
</body></html>`;
  return { text, html };
}

emailRouter.post('/cards/:id/email', async (req, res) => {
  const card = cardDetails(req.params.id);
  assertBoard(card.board_id, 'viewer');
  const s = smtpSettings();
  if (!configured(s)) fail(400, 'Email is not set up on this server. An admin can set it up in Settings → Email.');

  const to = [...new Set(String(req.body.to || '').split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean))];
  if (!to.length) fail(400, 'Add at least one email address');
  if (to.length > 20) fail(400, 'Send to 20 addresses or fewer');
  const bad = to.find((e) => !isEmail(e));
  if (bad) fail(400, `"${bad}" doesn't look like an email address`);

  const recent = (sent.get(req.user.id) || []).filter((t) => t > Date.now() - 3600e3);
  if (recent.length >= 30) fail(429, 'You have sent a lot of emails this hour. Try again later.');

  const note = String(req.body.note || '').trim().slice(0, 5000);
  const { text, html } = render(card, req.user.display_name, note);
  const attachments = [];
  const events = datedEvents({ cardId: card.id }).map(toEvent);
  if (events.length) attachments.push({ filename: 'card.ics', content: buildIcs(events, card.title), contentType: 'text/calendar; charset=utf-8' });
  if (req.body.include_attachments) {
    const limit = Number(env('EMAIL_ATTACHMENT_MB') || 10) * 1024 * 1024;
    let total = 0;
    for (const a of card.attachments) {
      if (total + a.size > limit) break;
      total += a.size;
      attachments.push({ filename: a.filename, path: path.join(UPLOAD_DIR, path.basename(a.stored_name)), contentType: a.mime || undefined });
    }
    if (attachments.some((a) => a.path && !fs.existsSync(a.path))) fail(500, 'An attachment file is missing on the server');
  }

  try {
    await transport(s).sendMail({
      from: s.from,
      to,
      replyTo: req.user.email ? `"${req.user.display_name.replace(/"/g, '')}" <${req.user.email}>` : undefined,
      subject: `${card.title} · ${card.board_name}`,
      text, html, attachments,
    });
  } catch (e) {
    fail(502, `Sending failed: ${e.message}`);
  }
  sent.set(req.user.id, [...recent, Date.now()]);
  logActivity(card.board_id, card.id, req.who, `emailed this card to ${to.join(', ')}`);
  res.json({ ok: true, to });
});

// A short notification email (mentions, assignments, reminders). Silently skipped without SMTP.
export async function sendNotificationEmail(user, subject, text) {
  if (!user.email || !configured()) return;
  const s = smtpSettings();
  await transport(s).sendMail({ from: s.from, to: user.email, subject, text });
}
