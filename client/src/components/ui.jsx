import { useEffect, useRef, useState } from 'react';

// Closes when clicking outside or pressing Escape.
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open, onClose]);
  return ref;
}

export function Popover({ title, onClose, children, className = '' }) {
  const ref = useDismiss(true, onClose);
  return (
    <div className={`popover ${className}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="popover-head">
        <span>{title}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="popover-body">{children}</div>
    </div>
  );
}

// "⋯" button with a dropdown of actions: [{ label, onClick, danger }]
export function Menu({ items, label = '⋯', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className={`menu ${className}`} ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-label="Menu" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{label}</button>
      {open && (
        <div className="menu-list" onClick={(e) => e.stopPropagation()}>
          {items.filter(Boolean).map((it) => (
            <button key={it.label} className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Text that becomes an input on click. Saves on Enter/blur, cancels on Escape.
export function InlineEdit({ value, onSave, className = '', multiline = false, placeholder = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
  };
  if (!editing) {
    return (
      <span className={`inline-edit ${className}`} onClick={(e) => { e.stopPropagation(); setEditing(true); }} title="Click to edit">
        {value || <span className="muted">{placeholder}</span>}
      </span>
    );
  }
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      className={`inline-input ${className}`}
      autoFocus
      value={draft}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false); }
      }}
    />
  );
}

// "+ Add a card" style composer.
export function Composer({ placeholder, buttonLabel, onAdd, openLabel, className = '', keepOpen = true, multiline = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useDismiss(open, () => { setOpen(false); setText(''); });
  if (!open) return <button className={`composer-open ${className}`} onClick={() => setOpen(true)}>{openLabel}</button>;
  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    await onAdd(v);
    if (!keepOpen) setOpen(false);
  };
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className={`composer ${className}`} ref={ref}>
      <Tag
        autoFocus
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { setOpen(false); setText(''); }
        }}
      />
      <div className="row">
        <button className="btn primary" onClick={submit}>{buttonLabel}</button>
        <button className="icon-btn" onClick={() => { setOpen(false); setText(''); }} aria-label="Cancel">✕</button>
      </div>
    </div>
  );
}

export function CompleteCircle({ done, onToggle, size = 16 }) {
  return (
    <button
      className={`circle ${done ? 'done' : ''}`}
      style={{ width: size, height: size }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-label={done ? 'Mark incomplete' : 'Mark complete'}
      title={done ? 'Mark incomplete' : 'Mark complete'}
    >
      {done && <svg viewBox="0 0 16 16"><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </button>
  );
}

export function ColorPicker({ colors, value, onChange }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} className={`swatch ${value === c ? 'selected' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}
