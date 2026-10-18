import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { COLORS } from '../config.js';
import { navigate } from '../router.js';
import { ColorPicker, Menu, useDismiss } from './ui.jsx';

export default function Home() {
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => api.get('/boards').then(setBoards).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const update = async (id, patch) => { await api.patch(`/boards/${id}`, patch); load(); };
  const remove = async (b) => {
    if (!confirm(`Permanently delete "${b.name}" and everything in it?`)) return;
    await api.del(`/boards/${b.id}`);
    load();
  };

  if (error) return <div className="page"><p className="error">Could not load boards: {error}</p></div>;
  if (!boards) return <div className="page"><p className="muted">Loading…</p></div>;

  const active = boards.filter((b) => !b.archived && !b.completed_at);
  const completed = boards.filter((b) => !b.archived && b.completed_at);
  const archived = boards.filter((b) => b.archived);

  return (
    <div className="page home">
      <section>
        <h2>Your boards</h2>
        <div className="tiles">
          {active.map((b) => <BoardTile key={b.id} board={b} onUpdate={update} />)}
          <NewBoardTile onCreated={(b) => navigate(`/b/${b.id}`)} />
        </div>
      </section>

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

function BoardTile({ board, onUpdate, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(board.name);
  const pct = board.card_count ? Math.round((board.done_count / board.card_count) * 100) : 0;
  const items = [
    { label: 'Rename', onClick: () => setRenaming(true) },
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
      className={`tile ${board.completed_at ? 'completed' : ''}`}
      style={{ '--tile': board.color || 'var(--accent)' }}
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
        <span>{board.card_count} card{board.card_count === 1 ? '' : 's'}{board.card_count ? ` · ${pct}% done` : ''}</span>
        <Menu items={items} />
      </div>
    </div>
  );
}

function NewBoardTile({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[5]);
  const ref = useDismiss(open, () => setOpen(false));
  const create = async () => {
    if (!name.trim()) return;
    const b = await api.post('/boards', { name, color });
    onCreated(b);
  };
  if (!open) return <button className="tile new-tile" onClick={() => setOpen(true)}>+ Create new board</button>;
  return (
    <div className="tile new-form" ref={ref}>
      <input autoFocus placeholder="Board name" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setOpen(false); }} />
      <ColorPicker colors={COLORS} value={color} onChange={setColor} />
      <div className="row">
        <button className="btn primary" onClick={create}>Create</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
