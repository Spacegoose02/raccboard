// @ts-check
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from './db.js';
import { requireAdmin } from './auth.js';

// Database backups: a consistent online copy (SQLite's backup API, safe while the app runs)
// every BACKUP_HOURS (default 24), keeping the newest BACKUP_KEEP (default 7) in DATA_DIR/backups.
// Admins can list, make and download them in Settings → Backups. Attachments and uploaded images
// live next to the database in DATA_DIR and are not part of these files.
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 7);
const HOURS = Number(process.env.BACKUP_HOURS ?? 24);
const NAME = /^raccboard-\d{8}-\d{6}\.db$/;

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => NAME.test(f)).sort().reverse()
    .map((name) => { const st = fs.statSync(path.join(BACKUP_DIR, name)); return { name, size: st.size, created_at: st.mtime.toISOString() }; });
}

export async function makeBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `raccboard-${stamp}.db`;
  await db.backup(path.join(BACKUP_DIR, name));
  for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
  return name;
}

if (HOURS > 0) {
  const run = () => makeBackup().catch((e) => console.warn('Backup failed:', e.message));
  // First one a minute after start-up if the newest is older than the interval.
  setTimeout(() => {
    const newest = listBackups()[0];
    if (!newest || Date.now() - Date.parse(newest.created_at) > HOURS * 3600e3) run();
  }, 60e3).unref();
  setInterval(run, HOURS * 3600e3).unref();
}

export const backupsRouter = express.Router();
backupsRouter.use('/admin/backups', requireAdmin);

backupsRouter.get('/admin/backups', (_req, res) => {
  res.json({ backups: listBackups(), keep: KEEP, every_hours: HOURS > 0 ? HOURS : null });
});

backupsRouter.post('/admin/backups', async (_req, res) => {
  const name = await makeBackup();
  res.status(201).json({ name });
});

backupsRouter.get('/admin/backups/:name', (req, res) => {
  const name = String(req.params.name);
  if (!NAME.test(name) || !fs.existsSync(path.join(BACKUP_DIR, name))) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }
  res.download(path.join(BACKUP_DIR, name), name);
});
