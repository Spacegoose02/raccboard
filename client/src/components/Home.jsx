import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { COLORS, IS_NATIVE } from '../config.js';
import { navigate } from '../router.js';
import { ColorPicker, Menu, backgroundStyle, useDismiss } from './ui.jsx';

export default function Home() {
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => api.get('/boards').then(setBoards).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const update = async (id, patch) => { await api.patch(`/boards/${id}`, patch); load(); };
  const copyBoard = async (b) => {
    const name = prompt('Name for the copy', `${b.name} (copy)`);
    if (!name) return;
    try { const c = await api.post(`/boards/${b.id}/copy`, { name }); navigate(`/b/${c.id}`); } catch (e) { alert(e.message); }
  };
  const remove = async (b) => {
    if (!confirm(`Permanently delete "${b.name}" and everything in it?`)) return;
    await api.del(`/boards/${b.id}`);
    load();
  };

  if (error) return <div className="page"><p className="error">Could not load boards: {error}</p>{IS_NATIVE && <p>Check the server address in <a href="#/settings">Settings</a>.</p>}</div>;
  if (!boards) return <div className="page"><p className="muted">Loading…</p></div>;

  const active = boards.filter((b) => !b.archived && !b.completed_at);
  const mine = active.filter((b) => b.my_role === 'owner');
  const shared = active.filter((b) => b.my_role !== 'owner');
  const completed = boards.filter((b) => !b.archived && b.completed_at);
  const archived = boards.filter((b) => b.archived);

  return (
    <div className="page home">
      <section>
        <h2>Your boards</h2>
        <div className="tiles">
          {mine.map((b) => <BoardTile key={b.id} board={b} onUpdate={update} onCopy={copyBoard} />)}
          <NewBoardTile onCreated={(b) => navigate(`/b/${b.id}`)} />
          <ImportTile onImported={(id) => navigate(`/b/${id}`)} />
        </div>
      </section>

      {shared.length > 0 && (
        <section>
          <h2>Shared with you</h2>
          <div className="tiles">
            {shared.map((b) => <BoardTile key={b.id} board={b} onUpdate={update} onCopy={copyBoard} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2>Completed</h2>
          <div className="tiles">
            {completed.map((b) => <BoardTile key={b.id} board={b} onUpdate={update} />)}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <button className="link-btn" onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? '▾' : '▸'} Archived boards ({archived.length})
          </button>
          {showArchived && (
            <div className="tiles">
              {archived.map((b) => <BoardTile key={b.id} board={b} onUpdate={update} onDelete={remove} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function BoardTile({ board, onUpdate, onDelete, onCopy }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(board.name);
  const pct = board.card_count ? Math.round((board.done_count / board.card_count) * 100) : 0;
  // Only owners manage a board; everyone else just opens it.
  const copy = onCopy && { label: 'Copy board', onClick: () => onCopy(board) };
  const items = board.my_role !== 'owner' ? [copy] : [
    { label: 'Rename', onClick: () => setRenaming(true) },
    copy,
    board.completed_at
      ? { label: 'Reopen board', onClick: () => onUpdate(board.id, { completed: false }) }
      : { label: 'Complete board', onClick: () => onUpdate(board.id, { completed: true }) },
    board.archived
      ? { label: 'Restore', onClick: () => onUpdate(board.id, { archived: false }) }
      : { label: 'Archive', onClick: () => onUpdate(board.id, { archived: true }) },
    onDelete && { label: 'Delete forever', danger: true, onClick: () => onDelete(board) },
  ];
  return (
    <div
      className={`tile ${board.completed_at ? 'completed' : ''} ${board.background ? 'has-bg' : ''}`}
      style={{ '--tile': board.color || 'var(--accent)', ...backgroundStyle(board) }}
      onClick={() => !renaming && navigate(`/b/${board.id}`)}
    >
      {renaming ? (
        <input
          className="inline-input"
          autoFocus
          value={name}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { setRenaming(false); if (name.trim() && name !== board.name) onUpdate(board.id, { name }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setName(board.name); setRenaming(false); } }}
        />
      ) : (
        <span className="tile-name">{board.completed_at && '✓ '}{board.name}</span>
      )}
      <div className="tile-foot">
        <span>
          {board.card_count} card{board.card_count === 1 ? '' : 's'}{board.card_count ? ` · ${pct}% done` : ''}
          {board.my_role !== 'owner' && board.owner_name && <><br />by {board.owner_name}{board.my_role === 'viewer' ? ' · view only' : ''}</>}
        </span>
        {items.filter(Boolean).length > 0 && <Menu items={items} />}
      </div>
    </div>
  );
}

function NewBoardTile({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[5]);
  const [template, setTemplate] = useState('');
  const [templates, setTemplates] = useState([]);
  const ref = useDismiss(open, () => setOpen(false));
  useEffect(() => { if (open && !templates.length) api.get('/board-templates').then(setTemplates).catch(() => {}); }, [open, templates.length]);
  const create = async () => {
    if (!name.trim() && !template) return;
    try {
      const b = await api.post('/boards', { name, color, ...(template ? { template } : {}) });
      onCreated(b);
    } catch (e) { alert(e.message); }
  };
  const chosen = templates.find((t) => t.id === template);
  if (!open) return <button className="tile new-tile" onClick={() => setOpen(true)}>+ Create new board</button>;
  return (
    <div className="tile new-form" ref={ref}>
      <input autoFocus placeholder="Board name" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setOpen(false); }} />
      <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Template">
        <option value="">Blank board</option>
        {templates.map((t) => <option key={t.id} value={t.id}>Template: {t.name}</option>)}
      </select>
      {chosen && <p className="muted small">{chosen.description} Lists: {chosen.lists.join(', ')}.</p>}
      <ColorPicker colors={COLORS} value={color} onChange={setColor} />
      <div className="row">
        <button className="btn primary" onClick={create}>Create</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

// Import a board exported from Trello (Board menu → Print, export and share → Export as JSON).
function ImportTile({ onImported }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const json = JSON.parse(await file.text());
      const r = await api.post('/import/trello', json);
      alert(`Imported ${r.lists} lists, ${r.cards} cards, ${r.checklists} checklists and ${r.comments} comments.`);
      onImported(r.board_id);
    } catch (e) {
      alert(e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message);
    } finally { setBusy(false); }
  };
  return (
    <>
      <button className="tile new-tile" disabled={busy} onClick={() => fileRef.current?.click()} title="Trello: Board menu → Print, export and share → Export as JSON">
        {busy ? 'Importing…' : '⇪ Import from Trello'}
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
    </>
  );
}
