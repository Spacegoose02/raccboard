import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { IS_NATIVE } from '../config.js';
import { timeAgo } from '../dates.js';

// "?google=..." on the settings URL after returning from Google.
function googleResult() {
  const q = window.location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('google') : null;
}

export default function CalendarSettings() {
  return (
    <>
      <h3>Calendar</h3>
      <FeedSettings />
      <GoogleSettings />
    </>
  );
}

function FeedSettings() {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.get('/calendar/feed').then((r) => setUrl(r.url)).catch(() => {}); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select instead */ }
  };
  const reset = async () => {
    if (!confirm('Make a new link? Calendars subscribed with the old link will stop updating.')) return;
    setUrl((await api.post('/calendar/feed/reset')).url);
  };
  return (
    <>
      <h4>Subscribe from any calendar app</h4>
      <p className="muted small">
        Everything with a date on your boards, as a live calendar feed. In Google Calendar use <b>Other calendars → + → From URL</b>.
        In Apple Calendar use <b>File → New Calendar Subscription</b>; in Outlook use <b>Add calendar → Subscribe from web</b>.
        Google refreshes subscribed calendars every few hours and needs to reach this server from the internet; for instant updates use Google sync below.
      </p>
      <div className="row feed-row">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Calendar feed URL" />
        <button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
        <button className="btn subtle" onClick={reset} title="Make a new secret link">Reset link</button>
      </div>
      <p className="muted small">Keep this link private: anyone with it can see your dates.</p>
    </>
  );
}

function GoogleSettings() {
  const [st, setSt] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [boards, setBoards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(() => {
    const r = googleResult();
    if (!r) return '';
    return r === 'connected' ? 'Google account connected ✓ Pick a calendar and boards below.' : `Google connection failed: ${r}`;
  });

  const load = useCallback(async () => {
    const s = await api.get('/google/status');
    setSt(s);
    if (s.connected) {
      api.get('/google/calendars').then(setCalendars).catch((e) => setMsg(e.message));
      api.get('/boards').then((b) => setBoards(b.filter((x) => !x.archived))).catch(() => {});
    }
  }, []);
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, [load]);

  const save = async (patch) => {
    setBusy(true);
    try { setSt(await api.patch('/google/settings', patch)); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await api.post('/google/sync');
      setSt(r);
      setMsg(`Synced: ${r.stats.created} added, ${r.stats.updated} updated, ${r.stats.deleted} removed.`);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const disconnect = async () => {
    const remove = confirm('Also delete the events Raccboard added to your Google Calendar?\n\nOK = delete them, Cancel = keep them');
    if (!confirm('Disconnect Google Calendar?')) return;
    setSt(await api.del(`/google${remove ? '?remove_events=1' : ''}`));
    setMsg('Disconnected.');
  };

  if (!st) return null;
  return (
    <>
      <h4>Google Calendar sync</h4>
      {!st.configured && (
        <p className="muted small">
          Not set up on this server. An admin can turn it on with a Google Cloud OAuth client
          (<code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>; see the README). Meanwhile use the feed above, or
          <b> Add to calendar</b> on any card.
        </p>
      )}
      {st.configured && !st.connected && (
        <>
          <p className="muted small">Push due dates from the boards you choose into one of your Google calendars. Changes show up within seconds.</p>
          {IS_NATIVE
            ? <p className="muted small">Connect Google from Raccboard in a web browser; the app then uses the same connection.</p>
            : <a className="btn primary" href="/api/google/connect">Connect Google Calendar</a>}
        </>
      )}
      {st.connected && (
        <div className="stack google-sync">
          <div className="muted small">Connected as <b>{st.email || 'your Google account'}</b>{st.last_sync ? ` · last sync ${timeAgo(st.last_sync)}` : ''} · {st.synced_events} event{st.synced_events === 1 ? '' : 's'}</div>
          {st.last_error && <p className="error small">{st.last_error}</p>}
          <label className="field">Google calendar
            <select value={st.calendar_id} disabled={busy} onChange={(e) => {
              const c = calendars.find((x) => x.id === e.target.value);
              save({ calendar_id: e.target.value, calendar_name: c?.name || '' });
            }}>
              <option value="">Choose a calendar…</option>
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? ' (main)' : ''}</option>)}
            </select>
          </label>
          <div className="field">Boards to sync
            <div className="board-checks">
              {boards.map((b) => (
                <label key={b.id} className="check-field">
                  <input type="checkbox" disabled={busy} checked={st.board_ids.includes(b.id)}
                    onChange={(e) => save({ board_ids: e.target.checked ? [...st.board_ids, b.id] : st.board_ids.filter((x) => x !== b.id) })} />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn" disabled={busy || !st.calendar_id} onClick={syncNow}>{busy ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn danger subtle" onClick={disconnect}>Disconnect</button>
          </div>
          <p className="muted small">One-way: Raccboard → Google. Edit dates here; edits made in Google are overwritten on the next sync.</p>
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
    </>
  );
}
