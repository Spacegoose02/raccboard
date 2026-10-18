// Account recovery CLI check: node scripts/smoke-cli.js
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_PORT = 3050;
const APP = `http://localhost:${APP_PORT}`;
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
const env = { ...process.env, DATA_DIR: dataDir, PUID: '', PGID: '' };
const cli = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, ['server/cli.js', ...args], { env, encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
};
const login = (username, password) => fetch(`${APP}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });

const server = spawn(process.execPath, ['server/index.js'], { env: { ...env, PORT: String(APP_PORT) }, stdio: ['ignore', 'inherit', 'inherit'] });
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${APP}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
  check(cli('list-users').out.includes('No users yet'), 'list-users on a fresh install');
  const setup = await fetch(`${APP}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'underwood02', password: 'forgotten-pass-1' }) }).then((r) => r.json());
  await fetch(`${APP}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setup.token}` }, body: JSON.stringify({ username: 'helper', password: 'helper-pass-1' }) });

  check(/underwood02\s+admin/.test(cli('list-users').out), 'list-users shows accounts and roles');
  const reset = cli('reset-password', 'Underwood02', 'Recovered-pass-1');
  check(reset.code === 0 && reset.out.includes('Password reset for underwood02'), 'reset-password works (username is case-insensitive)');
  check((await login('underwood02', 'Recovered-pass-1')).ok, 'can sign in with the new password while the server keeps running');
  check(!(await login('underwood02', 'forgotten-pass-1')).ok, 'the old password no longer works');
  const missing = cli('reset-password', 'nobody', 'whatever-123');
  check(missing.code === 1 && missing.out.includes('Users: helper, underwood02'), 'unknown user lists the real usernames');
  check(cli('reset-password', 'helper', 'short').code === 1, 'too-short passwords are refused');
  check(cli('make-admin', 'helper').out.includes('now an admin') && /helper\s+admin/.test(cli('list-users').out), 'make-admin promotes a user');
  console.log('CLI smoke test passed.');
} finally {
  server.kill();
}
