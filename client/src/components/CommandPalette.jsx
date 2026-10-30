import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { redo, undo } from '../undo.js';

// Ctrl+K / Cmd+K: jump to any board or card, or run a command. Board pages add their own
// commands by listening for 'rb:command' events.
const NAV = [
  { id: 'go-home', label: 'Go to boards', hint: 'Navigate', run: () => { window.location.hash = '/'; } },
  { id: 'go-cal', label: 'Go to calendar', hint: 'Navigate', run: () => { window.location.hash = '/calendar'; } },
  { id: 'go-settings', label: 'Open settings', hint: 'Navigate', run: () => { window.location.hash = '/settings'; } },
  { id: 'undo', label: 'Undo', hint: 'Ctrl Z', run: undo },
  { id: 'redo', label: 'Redo', hint: 'Ctrl Shift Z', run: redo },
];
const BOARD_CMDS = [
  ['new-card', 'New card in the first list', 'n'], ['view-board', 'Board view', 'b'], ['view-list', 'List view', 'l'],
  ['view-calendar', 'Calendar view', 'c'], ['filter-mine', 'Toggle "My cards"', 'q'], ['filter-clear', 'Clear filters', 'x'],
].map(([id, label, hint]) => ({ id, label, hint, board: true, run: () => window.dispatchEvent(new CustomEvent('rb:command', { detail: id })) }));

const match = (q, s) => s.toLowerCase().includes(q);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ boards: [], cards: [] });
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('rb:palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('rb:palette', onOpen); };
  }, []);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => api.get(`/search?q=${encodeURIComponent(q.trim())}`).then(setFound).catch(() => {}), q ? 120 : 0);
    return () => clearTimeout(t);
  }, [q, open]);

  const onBoard = window.location.hash.startsWith('#/b/');
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cmds = [...(onBoard ? BOARD_CMDS : []), ...NAV].filter((c) => !ql || match(ql, c.label));
    const boards = found.boards.map((b) => ({ id: `b${b.id}`, label: b.name, hint: 'Board', run: () => { window.location.hash = `/b/${b.id}`; } }));
    const cards = found.cards.map((c) => ({ id: `c${c.id}`, label: c.title, sub: c.snippet && !match(ql, c.title) ? c.snippet : '', hint: `${c.board_name} · ${c.list_name}`, run: () => { window.location.hash = `/b/${c.board_id}/c/${c.id}`; } }));
    return ql ? [...cards, ...boards, ...cmds] : [...cmds, ...boards];
  }, [q, found, onBoard]);
  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);

  if (!open) return null;
  const run = (item) => { setOpen(false); item?.run(); };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, items.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + items.length) % Math.max(1, items.length)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
  };
  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKeyDown}
          placeholder="Search cards and boards, or type a command…" aria-label="Search" />
        <ul className="palette-list" role="listbox">
          {items.length === 0 && <li className="muted palette-empty">No matches</li>}
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''}
              onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
              <span>{it.label}{it.sub && <em className="palette-snippet">{it.sub}</em>}</span><small>{it.hint}</small>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
