// @ts-check
import express from 'express';
import { assertBoard } from './access.js';
import { publicUser } from './auth.js';

// Live board updates over Server-Sent Events. Every successful write that touched a board
// (assertBoard records it on the request) tells that board's open tabs to refresh, and each
// board stream also carries who else is looking at it.

const streams = new Map(); // boardId -> Set<{ res, user, clientId }>

export const realtimeRouter = express.Router();

function send(boardId, event, data, skipClientId) {
  for (const s of streams.get(boardId) || []) {
    if (skipClientId && s.clientId === skipClientId) continue;
    s.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

function presence(boardId) {
  const seen = new Map();
  for (const s of streams.get(boardId) || []) seen.set(s.user.id, s.user);
  send(boardId, 'presence', [...seen.values()]);
}

realtimeRouter.get('/boards/:id/events', (req, res) => {
  const boardId = String(req.params.id);
  assertBoard(boardId, 'viewer');
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const u = publicUser(req.user);
  const entry = { res, user: { id: u.id, display_name: u.display_name, avatar: u.avatar }, clientId: String(req.query.client || '') };
  if (!streams.has(boardId)) streams.set(boardId, new Set());
  streams.get(boardId).add(entry);
  presence(boardId);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    const set = streams.get(boardId);
    set?.delete(entry);
    if (!set?.size) streams.delete(boardId);
    else presence(boardId);
  });
});

// Mounted before the routes: after a successful write, notify every board it touched.
export function broadcastWrites(req, res, next) {
  if (req.method === 'GET') return next();
  req.touchedBoards = new Set();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    for (const id of req.touchedBoards) send(id, 'change', { by: req.user?.id }, req.get('X-Client-Id'));
  });
  next();
}
