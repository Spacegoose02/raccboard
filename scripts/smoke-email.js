// End-to-end email check against a tiny in-process SMTP server. Usage: node scripts/smoke-email.js
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SMTP_PORT = 2526;
const APP_PORT = 3030;
const APP = `http://localhost:${APP_PORT}`;
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

/* ---------- mock SMTP server: accepts everything, records messages ---------- */
const messages = [];
const smtp = net.createServer((sock) => {
  let buffer = '';
  let inData = false;
  let current = { from: '', to: [], data: '', auth: false };
  const reply = (line) => sock.write(`${line}\r\n`);
  reply('220 mock.smtp ready');
  sock.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (inData) {
        if (line === '.') { inData = false; messages.push(current); current = { from: '', to: [], data: '', auth: current.auth }; reply('250 queued'); }
        else current.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { reply('250-mock.smtp'); reply('250-AUTH PLAIN LOGIN'); reply('250 8BITMIME'); }
      else if (cmd === 'HELO') reply('250 mock.smtp');
      else if (cmd === 'AUTH') { current.auth = true; reply('235 ok'); }
      else if (cmd === 'MAIL') { current.from = line; reply('250 ok'); }
      else if (cmd === 'RCPT') { current.to.push(line.match(/<(.+)>/)?.[1]); reply('250 ok'); }
      else if (cmd === 'DATA') { inData = true; reply('354 go'); }
      else if (cmd === 'QUIT') { reply('221 bye'); sock.end(); }
      else if (cmd === 'RSET' || cmd === 'NOOP') reply('250 ok');
      else reply('502 not implemented');
    }
  });
});
await new Promise((r) => smtp.listen(SMTP_PORT, r));

/* ---------- Raccboard ---------- */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-email-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(APP_PORT), DATA_DIR: dataDir, PUBLIC_URL: APP },
  stdio: ['ignore', 'inherit', 'inherit'],
});
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${APP}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
  const setup = await fetch(`${APP}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mailer', password: 'email-test-pw', display_name: 'Mae Mailer', email: 'mae@example.com' }) }).then((r) => r.json());
  const H = { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' };
  const call = (method, p, body) => fetch(`${APP}/api${p}`, { method, headers: H, body: body && JSON.stringify(body) });
  const json = async (method, p, body) => { const r = await call(method, p, body); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${await r.text()}`); return r.json(); };

  const board = await json('POST', '/boards', { name: 'Groceries' });
  const list = await json('POST', `/boards/${board.id}/lists`, { name: 'This week' });
  const card = await json('POST', `/lists/${list.id}/cards`, { title: 'Big shop <Saturday>' });
  await json('PATCH', `/cards/${card.id}`, { description: 'Use the coupons & the list below.', due_date: '2026-10-24' });
  const cl = await json('POST', `/cards/${card.id}/checklists`, { title: 'Produce' });
  await json('POST', `/checklists/${cl.id}/items`, { text: 'Apples' });
  const form = new FormData();
  form.append('file', new Blob(['milk, eggs, bread']), 'list.txt');
  await fetch(`${APP}/api/cards/${card.id}/attachments`, { method: 'POST', headers: { Authorization: H.Authorization }, body: form });

  check(!(await json('GET', '/email/status')).configured, 'email starts unconfigured');
  const early = await call('POST', `/cards/${card.id}/email`, { to: 'a@example.com' });
  check(early.status === 400, 'sending without a mail server is refused');

  const saved = await json('PUT', '/email/settings', { host: 'localhost', port: String(SMTP_PORT), secure: 'false', user: 'smtp-user', pass: 'smtp-secret', from: 'Raccboard <kanban@example.com>' });
  check(saved.configured && saved.has_password && !('pass' in saved), 'admin saves SMTP settings; the password is never returned');
  await json('PUT', '/email/settings', { host: 'localhost', pass: '' });
  check((await json('GET', '/email/status')).has_password, 'saving with a blank password keeps the old one');

  await json('POST', '/email/test', {});
  check(messages.length === 1 && messages[0].to[0] === 'mae@example.com' && messages[0].auth, 'test email goes to the admin with SMTP auth');

  const bad = await call('POST', `/cards/${card.id}/email`, { to: 'not-an-address' });
  check(bad.status === 400, 'invalid addresses are rejected');

  const sent = await json('POST', `/cards/${card.id}/email`, { to: 'sam@example.com, pat@example.com', note: 'Can you do this one?', include_attachments: true });
  check(sent.to.length === 2, 'card email accepted for two recipients');
  const msg = messages[1];
  check(msg.to.includes('sam@example.com') && msg.to.includes('pat@example.com'), 'both recipients reached the mail server');
  // Non-ASCII subjects are MIME-encoded (=?UTF-8?Q?Big_shop...).
  check(/Subject: .*Big[ _]shop/.test(msg.data) && /Reply-To: .*mae@example\.com/.test(msg.data), 'subject and reply-to are set');
  check(msg.data.includes('&lt;Saturday&gt;') && msg.data.includes('Can you do this one?'), 'HTML body escapes the title and includes the note');
  check(msg.data.includes('text/calendar') && msg.data.includes('filename=card.ics'), 'calendar file attached for the due date');
  check(msg.data.includes('list.txt'), 'card attachment included');
  // Bodies are quoted-printable: undo soft line breaks and =XX escapes before looking for the link.
  const decoded = msg.data.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  check(decoded.includes(`${APP}/#/b/${board.id}/c/${card.id}`), 'link back to the card');
  const detail = await json('GET', `/cards/${card.id}`);
  check(detail.activity.some((a) => a.text.startsWith('emailed this card to')), 'activity log records the email');

  // Forgot password: same answer for unknown accounts, one-time link, signs out old sessions.
  const post = (p, body) => fetch(`${APP}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  check((await (await fetch(`${APP}/api/auth/status`)).json()).forgot, 'forgot-password is offered once email works');
  const before = messages.length;
  check((await post('/auth/forgot', { username: 'nobody-here' })).ok && messages.length === before, 'unknown account gets the same answer and no email');
  await post('/auth/forgot', { username: 'MAE@example.com' });
  for (let i = 0; i < 40 && messages.length === before; i++) await new Promise((r) => setTimeout(r, 100));
  const resetMail = messages.at(-1).data.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const token = resetMail.match(/#\/reset\/([\w-]+)/)?.[1];
  check(messages.at(-1).to[0] === 'mae@example.com' && token, 'reset link emailed to the account address');
  const reset = await post('/auth/reset', { token, password: 'brand-new-pass' });
  check(reset.ok && (await reset.json()).token, 'reset link sets a new password and signs in');
  check((await call('GET', '/boards')).status === 401, 'old sessions are signed out after a reset');
  check((await post('/auth/reset', { token, password: 'another-pass-1' })).status === 400, 'reset link works only once');
  check((await post('/auth/login', { username: 'mailer', password: 'brand-new-pass' })).ok, 'new password signs in');
  console.log('Email smoke test passed.');
} finally {
  server.kill();
  smtp.close();
}
