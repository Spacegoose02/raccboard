// End-to-end OIDC check: runs a tiny mock identity provider and a Rackboard server pointed at it,
// then follows the browser redirect flow. Usage: node scripts/smoke-oidc.js
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IDP_PORT = 4010;
const APP_PORT = 3010;
const ISSUER = `http://localhost:${IDP_PORT}`;
const APP = `http://localhost:${APP_PORT}`;
const CLIENT_ID = 'rackboard';
const CLIENT_SECRET = 'mock-secret';
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

/* ---------- mock identity provider ---------- */
const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await webcrypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', use: 'sig', alg: 'RS256' };
async function sign(payload) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, Buffer.from(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
const codes = new Map();
const PERSON = { sub: 'idp-user-42', email: 'rocky@example.com', email_verified: true, name: 'Rocky Raccoon', preferred_username: 'rocky' };

const idp = http.createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  const json = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/.well-known/openid-configuration') {
    return json({
      issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  }
  if (url.pathname === '/jwks') return json({ keys: [jwk] });
  if (url.pathname === '/authorize') {
    const code = b64url(randomBytes(16));
    codes.set(code, { challenge: url.searchParams.get('code_challenge'), redirect: url.searchParams.get('redirect_uri') });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state'));
    back.searchParams.set('iss', ISSUER);
    res.writeHead(302, { Location: back.href });
    return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    const entry = codes.get(form.get('code'));
    const challenge = b64url(createHash('sha256').update(form.get('code_verifier') || '').digest());
    if (!entry || entry.challenge !== challenge || form.get('client_secret') !== CLIENT_SECRET || entry.redirect !== form.get('redirect_uri')) {
      return json({ error: 'invalid_grant' }, 400);
    }
    codes.delete(form.get('code'));
    const iat = Math.floor(Date.now() / 1000);
    return json({
      access_token: b64url(randomBytes(16)), token_type: 'Bearer', expires_in: 300,
      id_token: await sign({ iss: ISSUER, aud: CLIENT_ID, iat, exp: iat + 300, ...PERSON }),
    });
  }
  json({ error: 'not_found' }, 404);
});
await new Promise((r) => idp.listen(IDP_PORT, r));

/* ---------- Rackboard pointed at the mock ---------- */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-oidc-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(APP_PORT), DATA_DIR: dataDir, OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT_ID, OIDC_CLIENT_SECRET: CLIENT_SECRET, OIDC_NAME: 'Mock IdP', PUBLIC_URL: APP },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const cleanup = () => { server.kill(); idp.close(); };
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${APP}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }

  const status = await fetch(`${APP}/api/auth/status`).then((r) => r.json());
  check(status.oidc.enabled && status.oidc.name === 'Mock IdP', 'OIDC advertised in auth status');

  const start = await fetch(`${APP}/api/auth/oidc/start?return=/settings`, { redirect: 'manual' });
  check(start.status === 302 && start.headers.get('location').startsWith(`${ISSUER}/authorize`), 'start redirects to the identity provider');
  const authorize = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const callbackUrl = authorize.headers.get('location');
  check(callbackUrl.startsWith(`${APP}/api/auth/oidc/callback`), 'provider redirects back to the callback');
  const callback = await fetch(callbackUrl, { redirect: 'manual' });
  const cookie = (callback.headers.get('set-cookie') || '').match(/rb_session=([^;]+)/)?.[1];
  check(callback.status === 302 && callback.headers.get('location') === '/#/settings', 'callback returns to the requested page');
  check(!!cookie, 'callback sets the session cookie');

  const me = await fetch(`${APP}/api/auth/me`, { headers: { Cookie: `rb_session=${cookie}` } }).then((r) => r.json());
  check(me.username === 'rocky' && me.display_name === 'Rocky Raccoon' && me.oidc && me.role === 'admin', 'account created from OIDC claims (first user is admin)');

  const replay = await fetch(callbackUrl, { redirect: 'manual' });
  check(replay.headers.get('location').startsWith('/#/login?error='), 'replayed callback is rejected');
  console.log('OIDC smoke test passed.');
} finally {
  cleanup();
}
