import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { APP_MASCOT, APP_NAME, COLORS, IS_NATIVE, THEMES } from '../config.js';
import { navigate } from '../router.js';
import { updateSettings, useSettings } from '../settings.js';
import { ServerForm } from './ServerSetup.jsx';
import { Avatar } from './CardModal.jsx';
import { ColorPicker } from './ui.jsx';

// Every setting lives on this one page, grouped into sections.
const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'boards', label: 'Boards & labels' },
  IS_NATIVE && { id: 'server', label: 'Server' },
  { id: 'about', label: 'About' },
].filter(Boolean);

export default function Settings({ boardId }) {
  const refs = useRef({});
  const scrollTo = (id) => refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  useEffect(() => { if (boardId) setTimeout(() => scrollTo('boards'), 50); }, [boardId]);
  const section = (id) => (el) => { refs.current[id] = el; };

  return (
    <div className="page settings">
      <h2>Settings</h2>
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((s) => <button key={s.id} onClick={() => scrollTo(s.id)}>{s.label}</button>)}
        </nav>
        <div className="settings-body">
          <section className="panel" ref={section('profile')}><ProfileSettings /></section>
          <section className="panel" ref={section('appearance')}><ThemeSettings /></section>
          <section className="panel" ref={section('boards')}><BoardSettings initialBoardId={boardId} /></section>
          {IS_NATIVE && (
            <section className="panel" ref={section('server')}>
              <h3>Server</h3>
              <p className="muted">The {APP_NAME} server this app talks to.</p>
              <ServerForm buttonLabel="Save server" />
            </section>
          )}
          <section className="panel" ref={section('about')}>
            <h3>About</h3>
            <p className="muted">{APP_MASCOT} {APP_NAME}: a self-hosted Kanban board. Data lives on your server in a single SQLite file.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProfileSettings() {
  const settings = useSettings();
  const [name, setName] = useState(settings.displayName);
  const [saved, setSaved] = useState(false);
  const saveName = () => { updateSettings({ displayName: name.trim() }); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  return (
    <>
      <h3>Your name</h3>
      <p className="muted">Shown on your comments and in card activity. Saved in this browser only until accounts arrive.</p>
      <div className="row">
        <Avatar name={name || 'Someone'} />
        <input value={name} placeholder="e.g. Rocky Raccoon" maxLength={60} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveName()} />
        <button className="btn primary" onClick={saveName}>Save</button>
        {saved && <span className="muted">Saved ✓</span>}
      </div>
    </>
  );
}

function ThemeSettings() {
  const settings = useSettings();
  return (
    <>
      <h3>Theme</h3>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-option ${settings.theme === t.id ? 'selected' : ''}`} onClick={() => updateSettings({ theme: t.id })}>
            <div className="theme-preview" style={{ background: t.swatch[0] }}>
              <div className="tp-list" style={{ background: t.swatch[1] }}>
                <div className="tp-card" style={{ background: t.swatch[2] }} />
                <div className="tp-card" style={{ background: t.swatch[2] }} />
                <div className="tp-accent" style={{ background: t.swatch[3] }} />
              </div>
              <div className="tp-list" style={{ background: t.swatch[1] }}>
                <div className="tp-card" style={{ background: t.swatch[2] }} />
              </div>
            </div>
            <span>{settings.theme === t.id ? '● ' : ''}{t.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function BoardSettings({ initialBoardId }) {
  const [boards, setBoards] = useState(null);
  const [selected, setSelected] = useState(initialBoardId || '');
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  const loadBoards = useCallback(() => api.get('/boards').then((b) => {
    setBoards(b);
    setSelected((cur) => (cur && b.some((x) => x.id === cur) ? cur : b[0]?.id || ''));
  }).catch((e) => setError(e.message)), []);
  const loadDetail = useCallback(() => {
    if (!selected) { setDetail(null); return; }
    api.get(`/boards/${selected}`).then(setDetail).catch((e) => setError(e.message));
  }, [selected]);
  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const act = async (fn) => {
    try { await fn(); } catch (e) { alert(e.message); }
    loadBoards();
    loadDetail();
  };

  if (error) return <><h3>Boards & labels</h3><p className="error">{error}</p></>;
  if (!boards) return <><h3>Boards & labels</h3><p className="muted">Loading…</p></>;
  if (!boards.length) return <><h3>Boards & labels</h3><p className="muted">No boards yet. <a href="#/">Create one</a>.</p></>;

  const board = detail?.board;
  const status = (b) => (b.archived ? ' (archived)' : b.completed_at ? ' (completed)' : '');
  return (
    <>
      <h3>Boards & labels</h3>
      <label className="field">Board
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}{status(b)}</option>)}
        </select>
      </label>
      {board && board.id === selected && (
        <div className="stack board-settings">
          <BoardNameColor key={board.id} board={board} onSave={(patch) => act(() => api.patch(`/boards/${board.id}`, patch))} />

          <h4>Labels (statuses)</h4>
          <div className="label-editor">
            {detail.labels.map((l) => (
              <LabelRow key={l.id} label={l}
                onSave={(patch) => act(() => api.patch(`/labels/${l.id}`, patch))}
                onDelete={() => confirm(`Delete label "${l.name}" from every card on this board?`) && act(() => api.del(`/labels/${l.id}`))} />
            ))}
            <NewLabel onAdd={(name, color) => act(() => api.post(`/boards/${board.id}/labels`, { name, color }))} />
          </div>

          <h4>Status</h4>
          <div className="row wrap">
            <button className="btn" onClick={() => navigate(`/b/${board.id}`)}>Open board</button>
            <button className="btn" onClick={() => act(() => api.patch(`/boards/${board.id}`, { completed: !board.completed_at }))}>
              {board.completed_at ? '↺ Reopen board' : '✓ Complete board'}
            </button>
            <button className="btn" onClick={() => act(() => api.patch(`/boards/${board.id}`, { archived: !board.archived }))}>
              {board.archived ? 'Restore board' : 'Archive board'}
            </button>
            <button className="btn danger" onClick={() => {
              if (prompt(`Type the board name to delete it forever:\n${board.name}`) === board.name) {
                act(async () => { await api.del(`/boards/${board.id}`); setSelected(''); });
              }
            }}>Delete forever</button>
          </div>
        </div>
      )}
    </>
  );
}

function BoardNameColor({ board, onSave }) {
  const [name, setName] = useState(board.name);
  return (
    <>
      <label className="field">Name
        <div className="row">
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave({ name })} />
          <button className="btn primary" disabled={!name.trim() || name === board.name} onClick={() => onSave({ name })}>Rename</button>
        </div>
      </label>
      <label className="field">Color</label>
      <ColorPicker colors={COLORS} value={board.color} onChange={(color) => onSave({ color })} />
    </>
  );
}

function LabelRow({ label, onSave, onDelete }) {
  const [name, setName] = useState(label.name);
  const [open, setOpen] = useState(false);
  return (
    <div className="label-row">
      <button className="swatch label-swatch" style={{ background: label.color }} onClick={() => setOpen((o) => !o)} aria-label="Change color" />
      <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== label.name && onSave({ name })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
      <button className="icon-btn" onClick={onDelete} title="Delete label" aria-label="Delete label">🗑</button>
      {open && <div className="label-colors"><ColorPicker colors={COLORS} value={label.color} onChange={(color) => { setOpen(false); onSave({ color }); }} /></div>}
    </div>
  );
}

function NewLabel({ onAdd }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[9]);
  const add = () => { if (!name.trim()) return; onAdd(name.trim(), color); setName(''); };
  return (
    <div className="stack new-label">
      <div className="row">
        <span className="swatch label-swatch" style={{ background: color }} />
        <input placeholder="New label name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add}>Add</button>
      </div>
      <ColorPicker colors={COLORS} value={color} onChange={setColor} />
    </div>
  );
}
