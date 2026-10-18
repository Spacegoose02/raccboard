import { useState } from 'react';
import { APP_MASCOT, APP_NAME, IS_NATIVE } from '../config.js';
import { setupAdmin, signIn, signUp, useAuth } from '../auth.js';

// Error passed back from the OIDC callback: #/login?error=...
function hashError() {
  const q = window.location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('error') || '' : '';
}

export default function SignIn() {
  const auth = useAuth();
  const [mode, setMode] = useState(auth.setupRequired ? 'setup' : 'login');
  const [form, setForm] = useState({ username: '', password: '', confirm: '', display_name: '', email: '' });
  const [error, setError] = useState(hashError);
  const [busy, setBusy] = useState(false);
  const field = (k) => ({ value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) });
  const creating = mode !== 'login';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (creating && form.password !== form.confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      if (mode === 'login') await signIn(form.username, form.password);
      else {
        const body = { username: form.username, password: form.password, display_name: form.display_name, email: form.email };
        await (mode === 'setup' ? setupAdmin(body) : signUp(body));
      }
      if (window.location.hash.startsWith('#/login')) window.location.hash = '/';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <div className="mascot-big">{APP_MASCOT}</div>
      <h2>{mode === 'setup' ? `Set up ${APP_NAME}` : mode === 'signup' ? 'Create an account' : `Sign in to ${APP_NAME}`}</h2>
      {mode === 'setup' && <p className="muted">Create the first account. It becomes the admin and can add everyone else in Settings → Users.</p>}

      <form className="stack" onSubmit={submit}>
        <label className="field">Username
          <input autoFocus autoComplete="username" autoCapitalize="off" autoCorrect="off" required {...field('username')} />
        </label>
        {creating && (
          <>
            <label className="field">Display name<input autoComplete="name" placeholder="Shown on comments" {...field('display_name')} /></label>
            <label className="field">Email (optional)<input type="email" autoComplete="email" {...field('email')} /></label>
          </>
        )}
        <label className="field">Password
          <input type="password" autoComplete={creating ? 'new-password' : 'current-password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} required minLength={creating ? 8 : undefined} {...field('password')} />
        </label>
        {creating && <label className="field">Confirm password<input type="password" autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} required {...field('confirm')} /></label>}
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {mode === 'login' && auth.oidc?.enabled && !IS_NATIVE && (
        <>
          <div className="divider"><span>or</span></div>
          <a className="btn wide sso" href={`/api/auth/oidc/start?return=${encodeURIComponent('/')}`}>Continue with {auth.oidc.name}</a>
        </>
      )}
      {mode === 'login' && auth.oidc?.enabled && IS_NATIVE && (
        <p className="muted small">Signed up with {auth.oidc.name}? Set a password in Settings → Profile on the web, then sign in here.</p>
      )}
      {auth.signup && !auth.setupRequired && (
        <button className="link-btn" onClick={() => { setError(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>
          {mode === 'login' ? 'No account? Create one' : 'Have an account? Sign in'}
        </button>
      )}
      {IS_NATIVE && <a className="link-btn" href="#/" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event('rb:change-server')); }}>Change server</a>}
    </div>
  );
}
