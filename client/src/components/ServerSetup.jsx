import { useState } from 'react';
import { APP_MASCOT, APP_NAME } from '../config.js';
import { getSettings, updateSettings } from '../settings.js';

export function normalizeServerUrl(input) {
  let url = input.trim().replace(/\/+$/, '').replace(/\/api$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

// Checks that a Rackboard server answers at the URL before saving it.
export async function testServer(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error('Not a Rackboard server');
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Timed out' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

export function ServerForm({ onSaved, buttonLabel = 'Connect' }) {
  const [url, setUrl] = useState(getSettings().serverUrl || '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    const u = normalizeServerUrl(url);
    if (!u) return;
    setBusy(true);
    setStatus('Checking…');
    try {
      await testServer(u);
      updateSettings({ serverUrl: u });
      setUrl(u);
      setStatus('Connected ✓');
      onSaved?.(u);
    } catch (e) {
      setStatus(`Could not reach ${u}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="http://192.168.1.50:3000"
        value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} />
      <button className="btn primary" disabled={busy} onClick={connect}>{buttonLabel}</button>
      {status && <p className={status.startsWith('Could not') ? 'error' : 'muted'}>{status}</p>}
    </div>
  );
}

export default function ServerSetup({ onDone }) {
  return (
    <div className="setup">
      <div className="mascot-big">{APP_MASCOT}</div>
      <h2>Welcome to {APP_NAME}</h2>
      <p className="muted">Enter the address of your {APP_NAME} server, the same one you open in a browser (for example your Unraid box on port 3000).</p>
      <ServerForm onSaved={onDone} />
    </div>
  );
}
