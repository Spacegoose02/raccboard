import { useEffect, useState } from 'react';
import { undo } from '../undo.js';

const VERB = { did: '', undid: 'Undone: ', redid: 'Redone: ', error: '' };

export function UndoToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    let timer;
    const on = (e) => { setToast(e.detail); clearTimeout(timer); timer = setTimeout(() => setToast(null), 6000); };
    window.addEventListener('rb:undo', on);
    return () => { clearTimeout(timer); window.removeEventListener('rb:undo', on); };
  }, []);
  if (!toast) return null;
  return (
    <div className={`undo-toast ${toast.kind === 'error' ? 'error' : ''}`} role="status">
      <span>{VERB[toast.kind]}{toast.label}</span>
      {toast.kind === 'did' && <button className="btn subtle" onClick={() => { setToast(null); undo(); }}>Undo <kbd>Ctrl Z</kbd></button>}
    </div>
  );
}
