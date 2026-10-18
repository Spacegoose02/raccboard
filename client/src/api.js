import { getSettings } from './settings.js';
import { IS_NATIVE } from './config.js';

// In the browser the API is same-origin; in the Android app it lives at the configured server URL.
export function apiUrl(path) {
  const base = IS_NATIVE ? (getSettings().serverUrl || '').replace(/\/+$/, '') : '';
  return `${base}/api${path}`;
}

function headers(extra = {}) {
  const name = getSettings().displayName;
  return name ? { ...extra, 'X-User': encodeURIComponent(name) } : extra;
}

async function request(method, path, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(apiUrl(path), {
    method,
    headers: headers(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p) => request('DELETE', p),
  upload: (p, file) => { const f = new FormData(); f.append('file', file); return request('POST', p, f); },
};
