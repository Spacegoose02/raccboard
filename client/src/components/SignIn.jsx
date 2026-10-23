import { useState } from 'react';
import { APP_MASCOT, APP_NAME, IS_NATIVE } from '../config.js';
import { requestReset, resetPassword, setupAdmin, signIn, signUp, useAuth } from '../auth.js';

// Error passed back from the OIDC callback: #/login?error=...
function hashError() {
  const q = window.location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('error') || '' : '';
}

export default function SignIn({ resetToken }) {
  const auth = useAuth();
  const [mode, setMode] = useState(resetToken ? 'reset' : auth.setupRequired ? 'setup' : 'login');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ username: '', password: '', confirm: '', display_name: '', email: '' });
  const [error, setError] = useState(hashError);
  const [busy, setBusy] = useState(false);
  const field = (k) => ({ value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) });
  const creating = mode === 'setup' || mode === 'signup';
  const newPassword = creating || mode === 'reset';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword && form.password !== form.confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await requestReset(form.username);
        setNotice('If that account has an email address, a reset link is on its way. It works for 30 minutes.');
        return;
      }
      if (mode === 'reset') {
        await resetPassword(resetToken, form.password);
        window.location.hash = '/';
        return;
      }
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
      <h2>{{ setup: `Set up ${APP_NAME}`, signup: 'Create an account', forgot: 'Forgot your password?', reset: 'Choose a new password' }[mode] || `Sign in to ${APP_NAME}`}</h2>
      {mode === 'forgot' && <p className="muted">Enter your username or email. We'll email you a link to set a new password.</p>}
      {mode === 'setup' && <p className="muted">Create the first account. It becomes the admin and can add everyone else in Settings → Users.</p>}

      <form className="stack" onSubmit={submit}>
        {mode !== 'reset' && (
          <label className="field">{mode === 'forgot' ? 'Username or email' : `Username${mode === 'login' ? ' (not your display name)' : ''}`}
            <input autoFocus autoComplete="username" autoCapitalize="off" autoCorrect="off" required {...field('username')} />
          </label>
        )}
        {creating && (
          <>
            <label className="field">Display name<input autoComplete="name" placeholder="Shown on comments" {...field('display_name')} /></label>
            <label className="field">Email (optional)<input type="email" autoComplete="email" {...field('email')} /></label>
          </>
        )}
        {mode !== 'forgot' && (
          <label className="field">{mode === 'reset' ? 'New password' : 'Password'}
            <input type="password" autoFocus={mode === 'reset'} autoComplete={newPassword ? 'new-password' : 'current-password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} required minLength={newPassword ? 8 : undefined} {...field('password')} />
          </label>
        )}
        {newPassword && <label className="field">Confirm password<input type="password" autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} required {...field('confirm')} /></label>}
        {error && <p className="error">{error}</p>}
        {notice && <p className="muted">{notice}</p>}
        <button className="btn primary" disabled={busy || !!notice} type="submit">
          {busy ? 'Please wait…' : { login: 'Sign in', forgot: 'Email me a link', reset: 'Save password' }[mode] || 'Create account'}
        </button>
      </form>
      {mode === 'login' && auth.forgot && (
        <button className="link-btn" onClick={() => { setError(''); setMode('forgot'); }}>Forgot password?</button>
      )}
      {(mode === 'forgot' || mode === 'reset') && (
        <button className="link-btn" onClick={() => { setError(''); setNotice(''); setMode('login'); window.location.hash = '/login'; }}>Back to sign in</button>
      )}

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
