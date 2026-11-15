import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDismiss } from './ui.jsx';
import { refreshAuth } from '../auth.js';

// Admin: the single sign-on (OIDC) provider, e.g. TinyAuth, Authelia, Authentik, Keycloak or Google.
export default function SignInSettings() {
  const [s, setS] = useState(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { api.get('/auth/oidc/settings').then(setS).catch((e) => setMsg(e.message)); }, []);
  if (!s) return <><h3>Sign-in</h3><p className="muted">{msg || 'Loading…'}</p></>;

  const saved = (next) => { setS(next); setEditing(false); refreshAuth(); };
  const remove = async () => {
    if (!window.confirm(`Remove ${s.name}? People who signed in with it will need a password to sign in.`)) return;
    try { saved(await api.del('/auth/oidc/settings')); } catch (e) { setMsg(e.message); }
  };

  return (
    <>
      <h3>Sign-in</h3>
      <p className="muted small">
        Let people sign in with your own identity provider (TinyAuth, Authelia, Authentik, Keycloak…) or any other
        OpenID Connect provider. Raccboard finds everything else from the issuer's <code>/.well-known/openid-configuration</code>.
      </p>
      {s.enabled ? (
        <div className="sso-provider">
          <div>
            <b>{s.name}</b>
            <div className="muted small">{s.issuer}{s.show ? '' : ' · hidden from the sign-in page'}</div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn danger" onClick={remove}>Remove</button>
          </div>
        </div>
      ) : (
        <button className="btn primary" onClick={() => setEditing(true)}>+ Add sign-in provider</button>
      )}
      <p className="muted small">Redirect URL to give your provider: <code className="copyable">{s.redirect_uri}</code></p>
      {msg && <p className="error small">{msg}</p>}
      {editing && <ProviderDialog initial={s} onClose={() => setEditing(false)} onSaved={saved} />}
    </>
  );
}

function ProviderDialog({ initial, onClose, onSaved }) {
  const isNew = !initial.enabled;
  const [form, setForm] = useState({
    name: isNew ? '' : initial.name, issuer: initial.issuer, client_id: initial.client_id, client_secret: '',
    scopes: initial.scopes, auto_create: isNew ? false : initial.auto_create, show: isNew ? true : initial.show,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const ref = useDismiss(true, onClose);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onSaved(await api.put('/auth/oidc/settings', form)); } catch (x) { setErr(x.message); setBusy(false); }
  };
  const copy = () => { navigator.clipboard?.writeText(initial.redirect_uri).then(() => setCopied(true)); };

  return (
    <div className="modal-backdrop">
      <form ref={ref} className="modal sso-dialog" onSubmit={save} role="dialog" aria-label={isNew ? 'Add sign-in provider' : `Edit ${initial.name}`}>
        <div className="sso-dialog-head">
          <h3>{isNew ? 'Add sign-in provider' : `Edit ${initial.name}`}</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <label className="field">Name on the sign-in button
          <input value={form.name} onChange={set('name')} placeholder="TinyAuth" required autoFocus /></label>
        <label className="field">Issuer URL
          <input className="mono" value={form.issuer} onChange={set('issuer')} placeholder="https://auth.example.com" required autoCapitalize="off" spellCheck={false} /></label>
        <label className="field">Client ID
          <input className="mono" value={form.client_id} onChange={set('client_id')} required autoCapitalize="off" spellCheck={false} autoComplete="off" /></label>
        <label className="field">Client secret
          <input className="mono" type="password" value={form.client_secret} onChange={set('client_secret')} autoComplete="new-password"
            placeholder={initial.has_secret ? 'Saved; leave empty to keep it' : 'Leave empty for a public (PKCE-only) client'} /></label>
        <label className="field">Extra scopes (optional)
          <input className="mono" value={form.scopes} onChange={set('scopes')} placeholder="openid, profile and email are always asked for" autoCapitalize="off" spellCheck={false} /></label>
        <label className="field">Redirect URL (add this to your provider)
          <span className="row"><input className="mono" readOnly value={initial.redirect_uri} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button></span></label>
        <label className="check-field big"><input type="checkbox" checked={form.auto_create} onChange={set('auto_create')} /> Create an account for anyone who signs in with it</label>
        <p className="muted small">
          Only turn this on for a provider that just lets in people you trust (your own TinyAuth or Authelia). With Google it would
          let anyone with a Google account in. When it's off, people need an existing account with the same verified email, or one
          already linked. New accounts are regular users; adjust them under Users.
        </p>
        <label className="check-field big"><input type="checkbox" checked={form.show} onChange={set('show')} /> Show on the sign-in page</label>
        {err && <p className="error small">{err}</p>}
        <div className="row sso-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
