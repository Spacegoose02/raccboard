// Offline support. Board data you've opened is kept in localStorage so it still shows without a
// connection, and edits made offline wait in a queue that replays, in order, once the server is
// reachable again.
const CACHE_PREFIX = 'rb-cache:';
const QUEUE_KEY = 'rb-queue';

// Reads that are worth keeping for offline viewing.
const CACHEABLE = [/^\/auth\/status$/, /^\/users$/, /^\/boards$/, /^\/boards\/[^/?]+$/, /^\/notifications$/];
export const isCacheable = (path) => CACHEABLE.some((re) => re.test(path));

// Edits that can wait: they return nothing the caller depends on. Creating things (which returns a
// new id) and uploads still need the server.
const QUEUEABLE = [
  ['PATCH', /./], ['PUT', /./], ['DELETE', /./],
  ['POST', /^\/cards\/[^/]+\/move$/], ['POST', /^\/cards\/[^/]+\/comments$/], ['POST', /^\/notifications\/read$/],
];
export const isQueueable = (method, path) => QUEUEABLE.some(([m, re]) => m === method && re.test(path));

export function readCache(path) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + path)); } catch { return null; }
}
export function writeCache(path, data) {
  try { localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data)); } catch { /* storage full: skip */ }
}
export function clearOffline() {
  for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX) || k === QUEUE_KEY) localStorage.removeItem(k);
  notify();
}

const loadQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } };
const saveQueue = (q) => { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); notify(); };
const notify = () => window.dispatchEvent(new CustomEvent('rb:queue', { detail: loadQueue().length }));
export const pendingCount = () => loadQueue().length;

export function enqueue(method, path, body) {
  saveQueue([...loadQueue(), { method, path, body, at: Date.now() }]);
}

// send(method, path, body) performs the real request; it throws { offline: true } on network errors.
let flushing = false;
export async function flushQueue(send) {
  if (flushing) return;
  flushing = true;
  let sent = 0;
  try {
    for (let q = loadQueue(); q.length; q = loadQueue()) {
      const [item] = q;
      try {
        await send(item.method, item.path, item.body);
      } catch (e) {
        if (e.offline || e.status === 401) return; // still offline or signed out: try again later
        console.warn(`Dropped offline change ${item.method} ${item.path}: ${e.message}`);
      }
      saveQueue(loadQueue().slice(1));
      sent += 1;
    }
  } finally {
    flushing = false;
    if (sent) window.dispatchEvent(new Event('rb:synced'));
  }
}
