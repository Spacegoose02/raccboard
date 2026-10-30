import { getSettings } from './settings.js';
import { IS_NATIVE } from './config.js';
import { enqueue, flushQueue, pendingCount, isCacheable, isQueueable, readCache, writeCache } from './offline.js';

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

// Identifies this tab so live updates skip echoes of its own writes.
export const CLIENT_ID = Math.random().toString(36).slice(2);

function headers(extra = {}) {
  const token = IS_NATIVE && getSettings().authToken;
  extra = { ...extra, 'X-Client-Id': CLIENT_ID };
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function send(method, path, body) {
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
    throw Object.assign(new Error("Can't reach the server. Check your connection."), { offline: true });
  }
  window.dispatchEvent(new Event('rb:online'));
  if (pendingCount()) setTimeout(() => flushQueue(send), 0);
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

// Reads fall back to the last copy seen; queueable edits made offline are saved for later.
async function request(method, path, body) {
  const isForm = body instanceof FormData;
  try {
    const data = await send(method, path, body);
    if (method === 'GET' && isCacheable(path)) writeCache(path, data);
    return data;
  } catch (e) {
    if (!e.offline) throw e;
    if (method === 'GET') {
      const cached = isCacheable(path) && readCache(path);
      if (cached) return cached;
    } else if (!isForm && isQueueable(method, path)) {
      enqueue(method, path, body);
      return null;
    }
    throw e;
  }
}

// Replay queued edits when the browser says the network is back.
window.addEventListener('online', () => flushQueue(send));

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p) => request('DELETE', p),
  upload: (p, file, field = 'file') => { const f = new FormData(); f.append(field, file); return request('POST', p, f); },
};
