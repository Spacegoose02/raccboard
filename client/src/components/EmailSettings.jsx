import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

// Admin: the mail server Rackboard sends through (Gmail, Fastmail, your ISP, a relay…).
export default function EmailSettings() {
  const { user } = useAuth();
  const [form, setForm] = useState(null);
  const [testTo, setTestTo] = useState(user.email || '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/email/status').then((s) => setForm({ ...s, port: String(s.port || 587), pass: '' })).catch((e) => setMsg(e.message));
  }, []);
  if (!form) return <><h3>Email</h3><p className="muted">{msg || 'Loading…'}</p></>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const s = await api.put('/email/settings', { host: form.host, port: form.port, secure: form.secure ? 'true' : 'false', user: form.user, pass: form.pass, from: form.from });
      setForm({ ...s, port: String(s.port), pass: '' });
      setMsg('Saved ✓');
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    setMsg('Sending test…');
    try { const r = await api.post('/email/test', { to: testTo }); setMsg(`Test email sent to ${r.to} ✓`); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <>
      <h3>Email</h3>
      <p className="muted small">
        The mail server used for "✉ Email" on cards. For Gmail use <code>smtp.gmail.com</code>, port 587, your address as the user, and an
        <b> app password</b> (Google Account → Security → App passwords). <code>SMTP_*</code> environment variables also work.
      </p>
      <div className="form-grid">
        <label className="field">SMTP server<input value={form.host} onChange={set('host')} placeholder="smtp.example.com" autoCapitalize="off" /></label>
        <label className="field">Port<input inputMode="numeric" value={form.port} onChange={set('port')} /></label>
        <label className="field">Username<input value={form.user} onChange={set('user')} autoComplete="off" autoCapitalize="off" /></label>
        <label className="field">Password<input type="password" value={form.pass} onChange={set('pass')} autoComplete="new-password"
          placeholder={form.has_password ? 'Saved (leave blank to keep)' : ''} /></label>
        <label className="field">From address<input value={form.from} onChange={set('from')} placeholder='Rackboard <kanban@example.com>' /></label>
        <label className="check-field"><input type="checkbox" checked={!!form.secure} onChange={set('secure')} /> Use SSL/TLS from the start (port 465)</label>
      </div>
      <div className="row wrap">
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
        <input type="email" className="test-to" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to…" />
        <button className="btn" disabled={busy || !form.configured} onClick={test}>Send test</button>
      </div>
      <p className="muted small">{form.configured ? 'Email is set up.' : 'Not set up yet.'} The password is stored in the server database.</p>
      {msg && <p className={msg.includes('✓') || msg.startsWith('Sending') ? 'muted small' : 'error small'}>{msg}</p>}
    </>
  );
}
