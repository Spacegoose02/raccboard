// Account recovery from a shell, e.g. on Unraid:
//   docker exec -it rackboard node server/cli.js list-users
//   docker exec -it rackboard node server/cli.js reset-password <username> <new-password>
//   docker exec -it rackboard node server/cli.js make-admin <username>
// Works while the server is running; no restart needed.

// docker exec runs as root: switch to the data owner first so new files (WAL, uploads) keep the right owner.
if (process.getuid?.() === 0 && process.env.PUID) {
  process.setgid(Number(process.env.PGID || process.env.PUID));
  process.setuid(Number(process.env.PUID));
}

const { db } = await import('./db.js');
const { hashPassword } = await import('./auth.js');

const [command, ...args] = process.argv.slice(2);
const findUser = (name) => db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(name || '').trim());
const usage = () => {
  console.log(`Usage:
  node server/cli.js list-users
  node server/cli.js reset-password <username> <new-password>
  node server/cli.js make-admin <username>`);
  process.exit(command ? 1 : 0);
};
const die = (msg) => { console.error(msg); process.exit(1); };
const noSuchUser = (name) => die(`No user "${name}". Users: ${db.prepare('SELECT username FROM users ORDER BY username').pluck().all().join(', ') || '(none yet)'}`);

switch (command) {
  case 'list-users': {
    const users = db.prepare('SELECT username, display_name, role, email, password_hash IS NOT NULL AS has_pw, oidc_sub IS NOT NULL AS sso FROM users ORDER BY username').all();
    if (!users.length) console.log('No users yet. Open Rackboard in a browser to create the first (admin) account.');
    for (const u of users) {
      console.log(`${u.username.padEnd(24)} ${u.role.padEnd(6)} ${u.display_name}${u.email ? ` <${u.email}>` : ''}${u.sso ? ' [single sign-on]' : ''}${u.has_pw ? '' : ' [no password]'}`);
    }
    break;
  }
  case 'reset-password': {
    const [name, password] = args;
    if (!name || password === undefined) usage();
    const user = findUser(name) || noSuchUser(name);
    if (password.length < 8) die('Password must be at least 8 characters.');
    if (password !== password.trim()) die('Password cannot start or end with a space.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    console.log(`Password reset for ${user.username}. They were signed out everywhere and can sign in now.`);
    console.log('If sign-in says "Too many attempts", wait 15 minutes or restart the container.');
    break;
  }
  case 'make-admin': {
    const [name] = args;
    if (!name) usage();
    const user = findUser(name) || noSuchUser(name);
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    console.log(`${user.username} is now an admin.`);
    break;
  }
  default:
    usage();
}
process.exit(0);
