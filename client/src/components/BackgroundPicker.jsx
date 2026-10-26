import { useRef, useState } from 'react';
import { api } from '../api.js';
import { BACKGROUNDS, COLORS } from '../config.js';
import { Popover, backgroundStyle } from './ui.jsx';

// Board owners pick a gradient, a solid color, an https image link or upload their own image.
export function BackgroundPicker({ board, onClose, onChange }) {
  const [url, setUrl] = useState(board.background?.startsWith('url:') ? board.background.slice(4) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const run = async (fn) => {
    setBusy(true); setError('');
    try { onChange(await fn()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const set = (background) => run(() => api.patch(`/boards/${board.id}`, { background }));
  const upload = (file) => file && run(() => api.upload(`/boards/${board.id}/background`, file));
  const current = board.background;

  return (
    <Popover title="Board background" onClose={onClose} className="bg-pop">
      <div className="bg-preview" style={backgroundStyle(board) || undefined} aria-hidden="true" />
      <p className="field-label">Gradients</p>
      <div className="swatches">
        {Object.entries(BACKGROUNDS).map(([key, css]) => (
          <button key={key} className={`swatch ${current === `preset:${key}` ? 'selected' : ''}`} style={{ backgroundImage: css }}
            title={key} aria-label={`${key} gradient`} disabled={busy} onClick={() => set(`preset:${key}`)} />
        ))}
      </div>
      <p className="field-label">Colors</p>
      <div className="swatches">
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${current === `color:${c}` ? 'selected' : ''}`} style={{ background: c }}
            aria-label={`Color ${c}`} disabled={busy} onClick={() => set(`color:${c}`)} />
        ))}
      </div>
      <p className="field-label">Your own image</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>⬆ Upload image…</button>
      <span className="muted small"> PNG, JPEG, WebP or GIF, up to 5 MB</span>
      <form className="bg-url" onSubmit={(e) => { e.preventDefault(); if (url.trim()) set(`url:${url.trim()}`); }}>
        <input type="url" placeholder="https://… image link" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Image link" />
        <button className="btn" disabled={busy || !url.trim()}>Use link</button>
      </form>
      {error && <p className="error">{error}</p>}
      {current && <button className="link-btn small" disabled={busy} onClick={() => set(null)}>Remove background</button>}
    </Popover>
  );
}
