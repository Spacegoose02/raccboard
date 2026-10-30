// App-wide undo/redo. Actions push { label, undo, redo } after they succeed; Ctrl+Z / Ctrl+Shift+Z
// (or Ctrl+Y) replay them, and a toast offers a one-click Undo for the latest action.
const done = [];
const undone = [];
const MAX = 50;

const emit = (detail) => window.dispatchEvent(new CustomEvent('rb:undo', { detail }));

export function pushUndo(action) {
  done.push(action);
  if (done.length > MAX) done.shift();
  undone.length = 0;
  emit({ label: action.label, kind: 'did' });
}

async function replay(from, to, method, kind) {
  const action = from.pop();
  if (!action) return;
  try {
    await action[method]();
    to.push(action);
    emit({ label: action.label, kind });
  } catch (e) {
    emit({ label: `Couldn't ${kind === 'undid' ? 'undo' : 'redo'}: ${e.message}`, kind: 'error' });
  }
}
export const undo = () => replay(done, undone, 'undo', 'undid');
export const redo = () => replay(undone, done, 'redo', 'redid');

const typing = (t) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable;
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
});
