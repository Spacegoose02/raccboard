import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Popover } from './ui.jsx';

// "✉ Email" on a card: send a formatted copy (with an .ics for its dates) to one or more addresses.
export default function EmailCard({ card, people, attachmentCount, onSent }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [withFiles, setWithFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { if (open && !status) api.get('/email/status').then(setStatus).catch(() => setStatus({ configured: false })); }, [open, status]);

  const send = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.post(`/cards/${card.id}/email`, { to, note, include_attachments: withFiles });
      setMsg(`Sent to ${r.to.join(', ')} ✓`);
      setTo('');
      setNote('');
      onSent?.();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  };
  const suggestions = people.filter((p) => p.email);
  const add = (email) => setTo((t) => (t.split(/[\s,;]+/).includes(email) ? t : [t.trim(), email].filter(Boolean).join(', ')));

  return (
    <span className="email-card">
      <button className="btn subtle small-btn" onClick={() => setOpen((o) => !o)} title="Send this card by email">✉ Email</button>
      {open && (
        <Popover title="Email this card" onClose={() => setOpen(false)} className="email-pop">
          {status && !status.configured ? (
            <p className="muted small">Email isn't set up on this server yet. An admin can add mail server details in Settings → Email.</p>
          ) : (
            <div className="stack">
              <label className="field">To
                <input type="email" multiple autoFocus placeholder="name@example.com, another@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              {suggestions.length > 0 && (
                <div className="chips">
                  {suggestions.map((p) => <button key={p.id} className="chip" onClick={() => add(p.email)}>+ {p.display_name}</button>)}
                </div>
              )}
              <label className="field">Note (optional)
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Can you pick these up on the way home?" />
              </label>
              {attachmentCount > 0 && (
                <label className="check-field"><input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} /> Include attachments ({attachmentCount})</label>
              )}
              <button className="btn primary" disabled={busy || !to.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
              <p className="muted small">Includes the description, checklists and a calendar file for its dates. Replies go to your email address.</p>
            </div>
          )}
          {msg && <p className={msg.endsWith('✓') ? 'muted small' : 'error small'}>{msg}</p>}
        </Popover>
      )}
    </span>
  );
}
