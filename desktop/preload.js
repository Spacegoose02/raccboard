const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...a) => {
  const r = await ipcRenderer.invoke(ch, ...a);
  if (!r.ok) { const e = new Error(r.error); e.status = r.status; throw e; }
  return r.data;
};

contextBridge.exposeInMainWorld('rb', {
  status: () => call('status'),
  signIn: (b) => call('signIn', b),
  signOut: () => call('signOut'),
  get: (p) => call('api', 'GET', p),
  patch: (p, b) => call('api', 'PATCH', p, b),
  post: (p, b) => call('api', 'POST', p, b ?? {}),
  pins: () => call('pins'),
  pin: (id) => call('pin', id),
  unpin: (id) => call('unpin', id),
  noteState: (id) => call('noteState', id),
  setOnTop: (id, on) => call('setOnTop', id, on),
  colorMenu: (id) => call('colorMenu', id),
  onColor: (fn) => ipcRenderer.on('color', (_e, c) => fn(c)),
  openInBrowser: (boardId, cardId) => call('openInBrowser', boardId, cardId),
  changed: () => call('changed'),
  onRefresh: (fn) => ipcRenderer.on('refresh', fn),
  onPins: (fn) => ipcRenderer.on('pins', (_e, p) => fn(p)),
});
