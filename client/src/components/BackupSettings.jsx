import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl } from '../api.js';

const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Admin: automatic database backups, plus "Back up now" and downloads.
export default function BackupSettings() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/admin/backups').then(setData).catch((e) => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const backupNow = async () => {
    setBusy(true);
    setMsg('');
    try { await api.post('/admin/backups'); await load(); setMsg('Backup made.'); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <>
      <h3>Backups</h3>
      <p className="muted">
        {data?.every_hours ? `The database is copied every ${data.every_hours} hours; the newest ${data.keep} are kept in the data folder under backups/.` : 'Automatic backups are off (BACKUP_HOURS=0).'}
        {' '}Attachments and uploaded images are separate files in the data folder; back that folder up too.
      </p>
      <button className="btn primary" onClick={backupNow} disabled={busy}>{busy ? 'Backing up…' : 'Back up now'}</button>
      {msg && <p className="muted">{msg}</p>}
      {data && (data.backups.length === 0 ? <p className="muted">No backups yet.</p> : (
        <ul className="backup-list">
          {data.backups.map((b) => (
            <li key={b.name}>
              <span>{new Date(b.created_at).toLocaleString()} · {size(b.size)}</span>
              <a className="btn subtle" href={apiUrl(`/admin/backups/${b.name}`)} download>Download</a>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}
