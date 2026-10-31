// Public API tokens and outgoing board webhooks.
import express from 'express';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { db, uuid, now } from './db.js';
import { assertBoard } from './access.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export const integrationsRouter = express.Router();

/* ---------- Personal API tokens ---------- */
// Only the hash is stored; the token itself is shown once when created.
integrationsRouter.get('/tokens', (req, res) => {
  res.json(db.prepare('SELECT id, name, hint, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id));
});

integrationsRouter.post('/tokens', (req, res) => {
  if (req.apiToken) fail(403, 'API tokens cannot create more tokens');
  const name = String(req.body?.name || '').trim().slice(0, 80) || 'API token';
  const token = 'rb_' + randomBytes(24).toString('base64url');
  const id = sha256(token);
  db.prepare('INSERT INTO api_tokens (id, user_id, name, hint, created_at) VALUES (?, ?, ?, ?, ?)').run(id, req.user.id, name, token.slice(-4), now());
  res.status(201).json({ id, name, hint: token.slice(-4), token });
});

integrationsRouter.delete('/tokens/:id', (req, res) => {
  db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.status(204).end();
});

/* ---------- Webhooks ---------- */
const publicHook = ({ secret: _s, ...h }) => h;

integrationsRouter.get('/boards/:id/webhooks', (req, res) => {
  assertBoard(req.params.id, 'owner');
  res.json(db.prepare('SELECT * FROM webhooks WHERE board_id = ? ORDER BY created_at').all(req.params.id).map(publicHook));
});

integrationsRouter.post('/boards/:id/webhooks', (req, res) => {
  assertBoard(req.params.id, 'owner');
  let url;
  try { url = new URL(String(req.body?.url || '')); } catch { fail(400, 'Enter a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) fail(400, 'Webhook URLs must be http or https');
  if (db.prepare('SELECT COUNT(*) AS n FROM webhooks WHERE board_id = ?').get(req.params.id).n >= 10) fail(400, 'A board can have at most 10 webhooks');
  const hook = { id: uuid(), board_id: req.params.id, url: url.href, secret: randomBytes(20).toString('hex'), created_by: req.user.id, created_at: now() };
  db.prepare('INSERT INTO webhooks (id, board_id, url, secret, created_by, created_at) VALUES (@id, @board_id, @url, @secret, @created_by, @created_at)').run(hook);
  // The signing secret is returned once, like an API token.
  res.status(201).json(hook);
});

integrationsRouter.delete('/boards/:id/webhooks/:hook', (req, res) => {
  assertBoard(req.params.id, 'owner');
  db.prepare('DELETE FROM webhooks WHERE id = ? AND board_id = ?').run(req.params.hook, req.params.id);
  res.status(204).end();
});

integrationsRouter.post('/boards/:id/webhooks/:hook/test', async (req, res) => {
  assertBoard(req.params.id, 'owner');
  const hook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND board_id = ?').get(req.params.hook, req.params.id);
  if (!hook) fail(404, 'Webhook not found');
  res.json({ status: await deliver(hook, { event: 'ping', board_id: hook.board_id, at: now() }) });
});

// Signed POST: X-Raccboard-Signature is sha256=HMAC(secret, body), like GitHub's.
async function deliver(hook, payload) {
  const body = JSON.stringify(payload);
  let status;
  try {
    const r = await fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Raccboard-Webhook', 'X-Raccboard-Event': payload.event,
        'X-Raccboard-Signature': 'sha256=' + createHmac('sha256', hook.secret).update(body).digest('hex') },
      body, redirect: 'manual', signal: AbortSignal.timeout(5000),
    });
    status = String(r.status);
  } catch (e) {
    status = e.name === 'TimeoutError' ? 'timeout' : 'error';
  }
  db.prepare('UPDATE webhooks SET last_status = ?, last_sent_at = ? WHERE id = ?').run(status, now(), hook.id);
  return status;
}

// Called after a successful write that touched a board (see realtime.broadcastWrites).
export function fireWebhooks(boardId, req) {
  const hooks = db.prepare('SELECT * FROM webhooks WHERE board_id = ?').all(boardId);
  if (!hooks.length) return;
  const payload = { event: 'board.changed', board_id: boardId, method: req.method, path: req.originalUrl.replace(/^\/api/, '').split('?')[0], by: req.user ? { id: req.user.id, name: req.user.display_name } : null, at: now() };
  for (const h of hooks) deliver(h, payload);
}
