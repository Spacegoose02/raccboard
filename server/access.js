import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './db.js';

// Board access. Roles, lowest to highest: viewer < editor < owner.
//  - The board's owner_id is its owner. Boards without an owner (from before accounts, or whose
//    owner was deleted) are owned by every admin.
//  - board_shares grant a role to a user or to a team (all of its members).
// Viewers can read and comment; editors change lists and cards; owners also rename, share,
// archive, complete and delete the board.

export const RANK = { viewer: 1, editor: 2, owner: 3 };

const requestContext = new AsyncLocalStorage();
export const withRequest = (req, _res, next) => requestContext.run(req, next);
const currentUser = () => requestContext.getStore()?.user;
const currentMethod = () => requestContext.getStore()?.method || 'GET';

export function boardRole(boardId, user) {
  if (!user) return null;
  const b = db.prepare('SELECT owner_id FROM boards WHERE id = ?').get(boardId);
  if (!b) return null;
  if (b.owner_id === user.id || (!b.owner_id && user.role === 'admin')) return 'owner';
  const roles = db.prepare(`SELECT role FROM board_shares WHERE board_id = ?
      AND (user_id = ? OR team_id IN (SELECT team_id FROM team_members WHERE user_id = ?))`).pluck().all(boardId, user.id, user.id);
  return roles.reduce((best, r) => (RANK[r] > (RANK[best] || 0) ? r : best), null);
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Throws unless the current user has at least `level` on the board. Without a level, reads need
// viewer and writes need editor. No access at all looks like "not found" so boards don't leak.
export function assertBoard(boardId, level) {
  const need = level || (currentMethod() === 'GET' ? 'viewer' : 'editor');
  const req = requestContext.getStore();
  const role = boardRole(boardId, currentUser());
  req?.touchedBoards?.add(String(boardId));
  if (!role) throw httpError(404, 'Board not found');
  if (RANK[role] < RANK[need]) {
    throw httpError(403, need === 'owner' ? 'Only the board owner can do that' : 'You have view-only access to this board');
  }
  return role;
}

// SQL condition: boards the user can see (bind userId, userId, userId, isAdmin).
export const VISIBLE_BOARDS_SQL = `(b.owner_id = ? OR (b.owner_id IS NULL AND ?) OR EXISTS (
  SELECT 1 FROM board_shares s WHERE s.board_id = b.id
    AND (s.user_id = ? OR s.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?))))`;
export const visibleParams = (user) => [user.id, user.role === 'admin' ? 1 : 0, user.id, user.id];

// Users who can open a board (for member pickers).
export function boardUsers(boardId) {
  return db.prepare(`
    SELECT u.* FROM users u WHERE u.id = (SELECT owner_id FROM boards WHERE id = ?)
       OR ((SELECT owner_id FROM boards WHERE id = ?) IS NULL AND u.role = 'admin')
       OR u.id IN (SELECT user_id FROM board_shares WHERE board_id = ? AND user_id IS NOT NULL)
       OR u.id IN (SELECT tm.user_id FROM team_members tm JOIN board_shares s ON s.team_id = tm.team_id WHERE s.board_id = ?)
    ORDER BY u.display_name COLLATE NOCASE`).all(boardId, boardId, boardId, boardId);
}
