// Browser hardening headers for the web app and API.
// The Android app loads its own bundle and only calls the API, so these don't affect it.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Markdown descriptions may show images from elsewhere.
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
}

// Cookie-authenticated writes must come from our own page. Bearer-token requests (Android app,
// scripts) carry no ambient credentials and are exempt.
export function sameOriginWrites(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || (req.get('Authorization') || '').startsWith('Bearer ')) return next();
  if (!(req.get('Cookie') || '').includes('rb_session=')) return next();
  const origin = req.get('Origin') || req.get('Referer');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host')) return next(Object.assign(new Error('Cross-site request blocked'), { status: 403 }));
  }
  next();
}

// Small fixed-window rate limiter kept in memory. Old entries are swept so the map can't grow forever.
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t - v.first > windowMs) hits.delete(k); }, windowMs).unref();
  return {
    blocked(key) { const h = hits.get(key); return !!h && Date.now() - h.first < windowMs && h.count >= max; },
    hit(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.first > windowMs) hits.set(key, { first: Date.now(), count: 1 });
      else h.count += 1;
    },
    clear(key) { hits.delete(key); },
    clearMatching(fn) { for (const k of hits.keys()) if (fn(k)) hits.delete(k); },
  };
}
