import { getSettings } from './settings.js';
import { IS_NATIVE } from './config.js';

// In the browser the API is same-origin and the session is an HttpOnly cookie.
// In the Android app it lives at the configured server URL and the session is a Bearer token.
function base() {
  return IS_NATIVE ? (getSettings().serverUrl || '').replace(/\/+$/, '') : '';
}

export function apiUrl(path) {
  const url = `${base()}/api${path}`;
  const token = IS_NATIVE && getSettings().authToken;
  // <img> and download links can't send headers, so the app passes its token in the URL.
  return token ? `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}` : url;
}

function headers(extra = {}) {
  const token = IS_NATIVE && getSettings().authToken;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function request(method, path, body) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(`${base()}/api${path}`, {
      method,
      headers: headers(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    window.dispatchEvent(new Event('rb:offline')); // network error: server unreachable
    throw new Error("Can't reach the server. Check your connection.");
  }
  window.dispatchEvent(new Event('rb:online'));
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('rb:signed-out'));
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p) => request('DELETE', p),
  upload: (p, file, field = 'file') => { const f = new FormData(); f.append(field, file); return request('POST', p, f); },
};
