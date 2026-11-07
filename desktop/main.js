// Raccboard Notes: a tray app that pins Raccboard cards to the desktop as sticky notes.
// All API calls run here in the main process; windows talk to it over IPC (see preload.js).
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, safeStorage, shell, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const POLL_MS = 20_000;
const NOTE_W = 260, NOTE_H = 300;

/* ---------- Settings (userData/notes.json) ---------- */
const file = () => path.join(app.getPath('userData'), 'notes.json');
let store = { serverUrl: '', token: '', notes: {}, startWithWindows: true };
function load() {
  try { store = { ...store, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { /* first run */ }
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(file(), JSON.stringify(store, null, 2)), 300);
}
// The session token is encrypted with Windows DPAPI when available.
const getToken = () => {
  if (!store.token) return '';
  try { return store.token.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(store.token.slice(4), 'base64')) : store.token; } catch { return ''; }
};
const setToken = (t) => {
  store.token = !t ? '' : safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(t).toString('base64') : t;
  save();
};

/* ---------- API ---------- */
async function api(method, p, body) {
  if (!store.serverUrl) throw new Error('Not connected to a server');
  const token = getToken();
  let res;
  try {
    res = await fetch(`${store.serverUrl}/api${p}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("Can't reach the server"); }
  if (res.status === 401 && !p.startsWith('/auth/')) { setToken(''); showPicker(); }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return res.status === 204 ? null : res.json();
}

/* ---------- Windows ---------- */
const prefs = (extra = {}) => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, ...extra });
const noteWins = new Map(); // cardId -> BrowserWindow
let picker = null, tray = null;

function showPicker() {
  if (picker && !picker.isDestroyed()) { picker.show(); picker.focus(); return; }
  picker = new BrowserWindow({ width: 420, height: 600, title: 'Raccboard Notes', icon: iconPath(), autoHideMenuBar: true, webPreferences: prefs() });
  picker.loadFile(path.join(__dirname, 'renderer', 'picker.html'));
  picker.on('closed', () => { picker = null; });
}

// Keeps a saved note on screen if its monitor was unplugged.
function onScreen(b) {
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x + 40 > a.x && b.x < a.x + a.width - 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40);
  if (visible) return b;
  const a = screen.getPrimaryDisplay().workArea;
  return { ...b, x: a.x + a.width - NOTE_W - 40, y: a.y + 40 };
}

function openNote(cardId) {
  const existing = noteWins.get(cardId);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
  let saved = store.notes[cardId];
  if (!saved) {
    const a = screen.getPrimaryDisplay().workArea;
    const n = Object.keys(store.notes).length;
    saved = store.notes[cardId] = { x: a.x + a.width - NOTE_W - 40 - (n % 5) * 30, y: a.y + 40 + (n % 5) * 30, width: NOTE_W, height: NOTE_H, onTop: false };
    save();
  }
  const b = onScreen(saved);
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 180, minHeight: 120,
    frame: false, skipTaskbar: true, alwaysOnTop: !!saved.onTop, resizable: true, maximizable: false, fullscreenable: false,
    backgroundColor: '#fff7b1', show: false, webPreferences: prefs(),
  });
  win.loadFile(path.join(__dirname, 'renderer', 'note.html'), { query: { card: cardId } });
  win.once('ready-to-show', () => win.showInactive());
  const remember = () => {
    if (win.isDestroyed() || !store.notes[cardId]) return;
    store.notes[cardId] = { ...store.notes[cardId], ...win.getBounds() };
    save();
  };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => noteWins.delete(cardId));
  noteWins.set(cardId, win);
}

function unpin(cardId) {
  delete store.notes[cardId];
  save();
  const w = noteWins.get(cardId);
  if (w && !w.isDestroyed()) w.close();
  broadcastPins();
}

function broadcastPins() {
  if (picker && !picker.isDestroyed()) picker.webContents.send('pins', Object.keys(store.notes));
  rebuildTray();
}

/* ---------- Tray ---------- */
function iconPath() { return path.join(__dirname, 'icon.png'); }
function rebuildTray() {
  if (!tray) return;
  const n = Object.keys(store.notes).length;
  tray.setToolTip(`Raccboard Notes (${n} pinned)`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Pin a card…', click: showPicker },
    { label: 'Show all notes', enabled: n > 0, click: () => noteWins.forEach((w) => w.showInactive()) },
    { label: 'Hide all notes', enabled: n > 0, click: () => noteWins.forEach((w) => w.hide()) },
    { label: 'Refresh now', click: refreshAll },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: store.startWithWindows, click: (i) => { store.startWithWindows = i.checked; save(); applyLogin(); } },
    { label: 'Open Raccboard in browser', enabled: !!store.serverUrl, click: () => shell.openExternal(store.serverUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}
function applyLogin() {
  if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: store.startWithWindows });
}

/* ---------- Sync ---------- */
function refreshAll() { noteWins.forEach((w) => !w.isDestroyed() && w.webContents.send('refresh')); }

/* ---------- IPC ---------- */
const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
  try { return { ok: true, data: await fn(e, ...a) }; } catch (err) { return { ok: false, error: err.message, status: err.status }; }
});
handle('status', async () => {
  if (!store.serverUrl || !getToken()) return { serverUrl: store.serverUrl, user: null };
  const s = await api('GET', '/auth/status');
  if (!s.user) setToken('');
  return { serverUrl: store.serverUrl, user: s.user };
});
handle('signIn', async (_e, { serverUrl, username, password }) => {
  store.serverUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(store.serverUrl)) store.serverUrl = 'http://' + store.serverUrl;
  save();
  const r = await api('POST', '/auth/login', { username, password });
  setToken(r.token);
  noteWinsFromStore();
  return r.user;
});
handle('signOut', async () => {
  try { await api('POST', '/auth/logout'); } catch { /* already gone */ }
  setToken('');
  noteWins.forEach((w) => w.close());
});
handle('api', (_e, method, p, body) => {
  // Only the routes the notes need.
  if (!/^\/(boards|cards|items|checklists)(\/|$)/.test(p)) throw new Error('Not allowed');
  return api(method, p, body);
});
handle('pins', () => Object.keys(store.notes));
handle('pin', (_e, cardId) => { openNote(cardId); broadcastPins(); });
handle('unpin', (_e, cardId) => unpin(cardId));
handle('noteState', (_e, cardId) => store.notes[cardId] || null);
handle('setOnTop', (e, cardId, on) => {
  if (!store.notes[cardId]) return;
  store.notes[cardId].onTop = !!on; save();
  BrowserWindow.fromWebContents(e.sender)?.setAlwaysOnTop(!!on);
});
const NOTE_COLORS = [
  ['Yellow', '#ffe14d'], ['Orange', '#ff9a3c'], ['Pink', '#ff6fa8'], ['Purple', '#a77bff'],
  ['Blue', '#4da3ff'], ['Green', '#4cd07a'], ['Gray', '#9aa0a6'],
];
handle('colorMenu', (e, cardId) => {
  const note = store.notes[cardId]; if (!note) return;
  const win = BrowserWindow.fromWebContents(e.sender);
  const pick = (color) => () => {
    if (!store.notes[cardId]) return;
    store.notes[cardId].color = color; save();
    if (!e.sender.isDestroyed()) e.sender.send('color', color);
  };
  Menu.buildFromTemplate([
    { label: 'Note color', enabled: false },
    { label: 'Use label color', type: 'radio', checked: !note.color, click: pick(null) },
    ...NOTE_COLORS.map(([label, hex]) => ({ label, type: 'radio', checked: note.color === hex, click: pick(hex) })),
  ]).popup({ window: win });
});
handle('openInBrowser', (_e, boardId, cardId) => shell.openExternal(`${store.serverUrl}/#/b/${boardId}/c/${cardId}`));
handle('changed', (e) => { // a note edited its card: refresh the others showing the same data
  noteWins.forEach((w) => { if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('refresh'); });
});

function noteWinsFromStore() { if (getToken()) Object.keys(store.notes).forEach(openNote); }

/* ---------- Boot ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showPicker);
app.setAppUserModelId('com.raccboard.notes');
app.on('window-all-closed', () => { /* stay in the tray */ });

app.whenReady().then(() => {
  load();
  applyLogin();
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
  tray.on('click', showPicker);
  rebuildTray();
  if (getToken() && Object.keys(store.notes).length) noteWinsFromStore();
  else showPicker();
  setInterval(refreshAll, POLL_MS);
});
