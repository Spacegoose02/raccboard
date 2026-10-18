import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'rackboard.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();

// Each entry upgrades the schema by one version (PRAGMA user_version).
const migrations = [
  `
  CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    position REAL NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    collapsed INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_lists_board ON lists(board_id);
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position REAL NOT NULL DEFAULT 0,
    start_date TEXT,
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_cards_list ON cards(list_id);
  CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );
  CREATE TABLE card_labels (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, label_id)
  );
  CREATE TABLE checklists (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE checklist_items (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    position REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE activity (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_activity_card ON activity(card_id);
  `,
  // v2: due dates on checklists (sublists)
  'ALTER TABLE checklists ADD COLUMN due_date TEXT;',
  // v3: accounts and sessions; comments/activity remember who wrote them
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    email TEXT,
    password_hash TEXT,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    oidc_issuer TEXT,
    oidc_sub TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_users_oidc ON users(oidc_issuer, oidc_sub) WHERE oidc_sub IS NOT NULL;
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  ALTER TABLE comments ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE activity ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
  `,
];

function migrate() {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
migrate();

export const DEFAULT_LABELS = [
  { name: 'In progress', color: '#3b82f6' },
  { name: 'Cancelled', color: '#ef4444' },
  { name: 'Future', color: '#a855f7' },
  { name: 'Done', color: '#22c55e' },
];

// who: { name, id } of the signed-in user
export function logActivity(boardId, cardId, who, text) {
  db.prepare('INSERT INTO activity (id, board_id, card_id, actor, user_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), boardId, cardId, who.name, who.id || null, text, now());
}
