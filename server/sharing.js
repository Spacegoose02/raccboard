import express from 'express';
import { db, uuid, now, logActivity } from './db.js';
import { assertBoard, RANK } from './access.js';
import { publicUser } from './auth.js';

// Teams (families, households, groups) and board sharing.
export const sharingRouter = express.Router();

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const cleanName = (v) => String(v || '').trim().slice(0, 80);

function teamWithMembers(team, viewer) {
  const members = db.prepare(`SELECT u.*, tm.role AS team_role FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? ORDER BY tm.role DESC, u.display_name COLLATE NOCASE`).all(team.id)
    
    .map((u) => ({ ...publicUser(u, viewer), team_role: u.team_role }));
  return { ...team, members };
}

// Team owners (and admins) manage a team.
function getTeam(req, id, manage = false) {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) || fail(404, 'Team not found');
  const mine = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').pluck().get(team.id, req.user.id);
  if (!mine && req.user.role !== 'admin') fail(404, 'Team not found');
  if (manage && mine !== 'owner' && req.user.role !== 'admin') fail(403, 'Only team owners can do that');
  return team;
}

/* ---------- Teams ---------- */

// Teams you belong to (admins see all teams).
sharingRouter.get('/teams', (req, res) => {
  const teams = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM teams ORDER BY name COLLATE NOCASE').all()
    : db.prepare(`SELECT t.* FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = ?
                  ORDER BY t.name COLLATE NOCASE`).all(req.user.id);
  res.json(teams.map((t) => teamWithMembers(t, req.user)));
});

sharingRouter.post('/teams', (req, res) => {
  const name = cleanName(req.body.name) || fail(400, 'Give the team a name');
  const id = uuid();
  db.transaction(() => {
    db.prepare('INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(id, name, req.user.id, now());
    db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user.id);
  })();
  res.status(201).json(teamWithMembers(db.prepare('SELECT * FROM teams WHERE id = ?').get(id), req.user));
});

sharingRouter.patch('/teams/:id', (req, res) => {
  const team = getTeam(req, req.params.id, true);
  const name = cleanName(req.body.name);
  if (name) db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, team.id);
  res.json(teamWithMembers(db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id), req.user));
});

sharingRouter.delete('/teams/:id', (req, res) => {
  const team = getTeam(req, req.params.id, true);
  db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
  res.status(204).end();
});

sharingRouter.put('/teams/:id/members/:userId', (req, res) => {
  const team = getTeam(req, req.params.id, true);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId) || fail(404, 'User not found');
  const role = req.body?.role === 'owner' ? 'owner' : 'member';
  const owners = db.prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner'").pluck().all(team.id);
  if (role === 'member' && owners.length === 1 && owners[0] === user.id) fail(400, 'A team needs an owner. Make someone else owner first.');
  db.prepare(`INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)
              ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role`).run(team.id, user.id, role);
  res.json(teamWithMembers(team, req.user));
});

// Owners remove anyone; members can leave.
sharingRouter.delete('/teams/:id/members/:userId', (req, res) => {
  const leaving = req.params.userId === req.user.id;
  const team = getTeam(req, req.params.id, !leaving);
  const owners = db.prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner'").pluck().all(team.id);
  if (owners.length === 1 && owners[0] === req.params.userId) fail(400, 'A team needs an owner. Make someone else owner first, or delete the team.');
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(team.id, req.params.userId);
  res.status(204).end();
});

/* ---------- Board sharing ---------- */

function shares(boardId) {
  return db.prepare(`
    SELECT s.*, u.username, u.display_name, u.avatar, t.name AS team_name
    FROM board_shares s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN teams t ON t.id = s.team_id
    WHERE s.board_id = ? ORDER BY s.team_id IS NULL, COALESCE(t.name, u.display_name) COLLATE NOCASE`).all(boardId);
}

sharingRouter.get('/boards/:id/shares', (req, res) => {
  const role = assertBoard(req.params.id, 'viewer');
  const board = db.prepare('SELECT owner_id FROM boards WHERE id = ?').get(req.params.id);
  const owner = board.owner_id ? publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(board.owner_id), req.user) : null;
  res.json({ owner, shares: shares(req.params.id), my_role: role });
});

// Body: { user_id | team_id, role: viewer | editor | owner }. Re-sharing updates the role.
sharingRouter.put('/boards/:id/shares', (req, res) => {
  assertBoard(req.params.id, 'owner');
  const role = RANK[req.body.role] ? req.body.role : fail(400, 'Role must be viewer, editor or owner');
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  let label;
  if (req.body.user_id) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body.user_id) || fail(404, 'User not found');
    if (user.id === board.owner_id) fail(400, 'That person already owns this board');
    db.prepare(`INSERT INTO board_shares (id, board_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (board_id, user_id) WHERE user_id IS NOT NULL DO UPDATE SET role = excluded.role`)
      .run(uuid(), board.id, user.id, role, now());
    label = user.display_name;
  } else if (req.body.team_id) {
    const team = getTeam(req, req.body.team_id);
    db.prepare(`INSERT INTO board_shares (id, board_id, team_id, role, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (board_id, team_id) WHERE team_id IS NOT NULL DO UPDATE SET role = excluded.role`)
      .run(uuid(), board.id, team.id, role, now());
    label = `team "${team.name}"`;
  } else fail(400, 'Choose a person or a team');
  logActivity(board.id, null, req.who, `shared the board with ${label} (${role})`);
  res.json({ shares: shares(board.id) });
});

sharingRouter.delete('/boards/:id/shares/:shareId', (req, res) => {
  const share = db.prepare('SELECT * FROM board_shares WHERE id = ? AND board_id = ?').get(req.params.shareId, req.params.id) || fail(404, 'Share not found');
  // Owners remove anyone; people can remove their own access.
  if (share.user_id !== req.user.id) assertBoard(req.params.id, 'owner');
  db.prepare('DELETE FROM board_shares WHERE id = ?').run(share.id);
  res.json({ shares: shares(req.params.id) });
});

// Hand the board to someone else; the previous owner keeps owner access through a share.
sharingRouter.post('/boards/:id/transfer', (req, res) => {
  assertBoard(req.params.id, 'owner');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body.user_id) || fail(404, 'User not found');
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  db.transaction(() => {
    db.prepare('UPDATE boards SET owner_id = ? WHERE id = ?').run(user.id, board.id);
    db.prepare('DELETE FROM board_shares WHERE board_id = ? AND user_id = ?').run(board.id, user.id);
    if (board.owner_id && board.owner_id !== user.id) {
      db.prepare(`INSERT INTO board_shares (id, board_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)
                  ON CONFLICT (board_id, user_id) WHERE user_id IS NOT NULL DO UPDATE SET role = 'owner'`).run(uuid(), board.id, board.owner_id, now());
    }
    logActivity(board.id, null, req.who, `made ${user.display_name} the board owner`);
  })();
  res.json({ ok: true });
});
