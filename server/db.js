import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKGROUND_DIR = path.join(UPLOAD_DIR, 'backgrounds');
fs.mkdirSync(BACKGROUND_DIR, { recursive: true });

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
  // v4: board owners, teams/families, board sharing and card members
  `
  ALTER TABLE boards ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
  UPDATE boards SET owner_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1);
  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE team_members (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (team_id, user_id)
  );
  CREATE TABLE board_shares (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((user_id IS NULL) != (team_id IS NULL))
  );
  CREATE UNIQUE INDEX idx_shares_user ON board_shares(board_id, user_id) WHERE user_id IS NOT NULL;
  CREATE UNIQUE INDEX idx_shares_team ON board_shares(board_id, team_id) WHERE team_id IS NOT NULL;
  CREATE TABLE card_members (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, user_id)
  );
  CREATE INDEX idx_card_members_user ON card_members(user_id);
  `,
  // v5: calendar feed tokens and Google Calendar sync
  `
  ALTER TABLE users ADD COLUMN ical_token TEXT;
  CREATE UNIQUE INDEX idx_users_ical ON users(ical_token) WHERE ical_token IS NOT NULL;
  CREATE TABLE google_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    expires_at INTEGER,
    calendar_id TEXT,
    calendar_name TEXT,
    board_ids TEXT NOT NULL DEFAULT '[]',
    last_sync TEXT,
    last_error TEXT
  );
  CREATE TABLE google_events (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uid TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (user_id, uid)
  );
  `,
  // v6: server-wide settings (email/SMTP)
  `
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `,
  // v7: one-time password reset links (stored hashed)
  `
  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);
  `,
  // v8: card covers, card templates and automation rules
  `
  ALTER TABLE cards ADD COLUMN cover TEXT;
  ALTER TABLE cards ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    trigger TEXT NOT NULL,
    trigger_list_id TEXT REFERENCES lists(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    action_value TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_automations_board ON automations(board_id);
  `,
  // v9: board backgrounds
  'ALTER TABLE boards ADD COLUMN background TEXT;',
  // v10: board layout ('simple' = plain checkbox rows)
  'ALTER TABLE boards ADD COLUMN layout TEXT;',
  // v11: notifications inbox (mentions, card assignments, due-date reminders)
  `
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    board_id TEXT REFERENCES boards(id) ON DELETE CASCADE,
    card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
    actor TEXT,
    text TEXT NOT NULL,
    dedupe TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
  CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe) WHERE dedupe IS NOT NULL;
  ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;
  `,
  // v12: indexes for the per-card counts on board load (they were full scans per card)
  `
  CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_card ON attachments(card_id);
  CREATE INDEX IF NOT EXISTS idx_checklists_card ON checklists(card_id);
  CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON checklist_items(checklist_id);
  CREATE INDEX IF NOT EXISTS idx_card_labels_card ON card_labels(card_id);
  CREATE INDEX IF NOT EXISTS idx_card_labels_label ON card_labels(label_id);
  CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id);
  CREATE INDEX IF NOT EXISTS idx_activity_board ON activity(board_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_board_shares_board ON board_shares(board_id);
  CREATE INDEX IF NOT EXISTS idx_cards_list_position ON cards(list_id, archived, position);
  `,
  // v13: full-text search over card titles, descriptions and comments (kept in sync by triggers)
  `
  CREATE VIRTUAL TABLE cards_fts USING fts5(card_id UNINDEXED, title, description, comments, tokenize = 'unicode61 remove_diacritics 2');
  INSERT INTO cards_fts (card_id, title, description, comments)
    SELECT c.id, c.title, COALESCE(c.description, ''), COALESCE((SELECT group_concat(body, ' ') FROM comments WHERE card_id = c.id), '') FROM cards c;
  CREATE TRIGGER cards_fts_insert AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts (card_id, title, description, comments) VALUES (new.id, new.title, COALESCE(new.description, ''), '');
  END;
  CREATE TRIGGER cards_fts_update AFTER UPDATE OF title, description ON cards BEGIN
    UPDATE cards_fts SET title = new.title, description = COALESCE(new.description, '') WHERE card_id = new.id;
  END;
  CREATE TRIGGER cards_fts_delete AFTER DELETE ON cards BEGIN
    DELETE FROM cards_fts WHERE card_id = old.id;
  END;
  CREATE TRIGGER cards_fts_comment_insert AFTER INSERT ON comments BEGIN
    UPDATE cards_fts SET comments = COALESCE((SELECT group_concat(body, ' ') FROM comments WHERE card_id = new.card_id), '') WHERE card_id = new.card_id;
  END;
  CREATE TRIGGER cards_fts_comment_delete AFTER DELETE ON comments BEGIN
    UPDATE cards_fts SET comments = COALESCE((SELECT group_concat(body, ' ') FROM comments WHERE card_id = old.card_id), '') WHERE card_id = old.card_id;
  END;
  `,  // v14: custom fields per board (text, number, date, select, checkbox) and their values on cards
  `
  CREATE TABLE board_fields (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    show_on_card INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_board_fields_board ON board_fields(board_id, position);
  CREATE TABLE card_field_values (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    field_id TEXT NOT NULL REFERENCES board_fields(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    PRIMARY KEY (card_id, field_id)
  );
  CREATE INDEX idx_card_field_values_field ON card_field_values(field_id);
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
