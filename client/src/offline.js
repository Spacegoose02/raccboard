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
  applyToCache(method, path, body || {});
}

// Mirror a queued edit into the cached boards, so the board doesn't snap back to its old state
// when it reloads from the cache while offline.
const flag = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
function applyToCache(method, path, body) {
  const m = path.match(/^\/(boards|lists|cards)\/([^/]+)(\/move)?$/);
  if (!m) return;
  const [, kind, id, move] = m;
  for (const key of Object.keys(localStorage)) {
    if (!/^rb-cache:\/boards\/[^/]+$/.test(key)) continue;
    const data = readCache(key.slice(CACHE_PREFIX.length));
    if (!data?.board) continue;
    let changed = false;
    const patch = (obj) => { changed = true; return { ...obj, ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, flag(v)])) }; };
    if (kind === 'boards' && data.board.id === id && method === 'PATCH') data.board = patch(data.board);
    if (kind === 'lists' && data.lists.some((l) => l.id === id)) {
      if (method === 'DELETE' || (method === 'PATCH' && body.archived)) { data.lists = data.lists.filter((l) => l.id !== id); changed = true; }
      else if (method === 'PATCH') data.lists = data.lists.map((l) => (l.id === id ? patch(l) : l));
    }
    if (kind === 'cards' && data.cards.some((c) => c.id === id)) {
      if (method === 'DELETE' || (method === 'PATCH' && body.archived)) { data.cards = data.cards.filter((c) => c.id !== id); changed = true; }
      else if (move && method === 'POST') {
        const card = { ...data.cards.find((c) => c.id === id), list_id: body.list_id };
        const rest = data.cards.filter((c) => c.id !== id);
        const inList = rest.filter((c) => c.list_id === body.list_id);
        const before = inList[body.index];
        const at = before ? rest.indexOf(before) : rest.length;
        rest.splice(at, 0, card);
        data.cards = rest;
        changed = true;
      } else if (method === 'PATCH') data.cards = data.cards.map((c) => (c.id === id ? patch(c) : c));
    }
    if (changed) writeCache(key.slice(CACHE_PREFIX.length), data);
  }
}

// send(method, path, body) performs the real request; it throws { offline: true } on network errors.
let flushing = false;
export async function flushQueue(send) {
  if (flushing) return;
  flushing = true;
  let sent = 0;
  const failed = [];
  try {
    for (let q = loadQueue(); q.length; q = loadQueue()) {
      const [item] = q;
      try {
        await send(item.method, item.path, item.body);
      } catch (e) {
        if (e.offline || e.status === 401) return; // still offline or signed out: try again later
        console.warn(`Dropped offline change ${item.method} ${item.path}: ${e.message}`);
        failed.push(e.message);
      }
      saveQueue(loadQueue().slice(1));
      sent += 1;
    }
  } finally {
    flushing = false;
    if (sent) window.dispatchEvent(new Event('rb:synced'));
    // Tell the person instead of losing their edit quietly.
    if (failed.length) {
      const label = `${failed.length} offline change${failed.length === 1 ? '' : 's'} couldn't be saved: ${failed[0]}`;
      window.dispatchEvent(new CustomEvent('rb:undo', { detail: { label, kind: 'error' } }));
    }
  }
}
