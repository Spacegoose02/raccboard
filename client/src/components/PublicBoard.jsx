import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { APP_NAME } from '../config.js';
import { dueStatus, formatDate } from '../dates.js';
import { CardCover } from './ui.jsx';
import { PriorityBadge } from './Planning.jsx';

// Read-only board for anyone with the secret link. No sign-in, no people, no comments.
export default function PublicBoard({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => {
    api.get(`/public/${token}`).then((d) => { setData(d); document.title = `${d.board.name} · ${APP_NAME}`; }).catch((e) => setError(e.message));
  }, [token]);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const labels = Object.fromEntries(data.labels.map((l) => [l.id, l]));
  const card = open && data.cards.find((c) => c.id === open);
  return (
    <div className="board public-board" style={{ '--board-accent': data.board.color || 'var(--accent)' }}>
      <div className="board-bar"><h2 className="board-title">{data.board.name}</h2><span className="badge plain">👁 Read-only link</span></div>
      <div className="lists">
        {data.lists.map((l) => {
          const cards = data.cards.filter((c) => c.list_id === l.id);
          return (
            <div key={l.id} className="list">
              <div className="list-head"><span className="list-name">{l.name}</span><span className="list-count">{cards.length}</span></div>
              <div className="cards">
                {cards.map((c) => (
                  <div key={c.id} className={`card ${c.completed ? 'completed' : ''}`} onClick={() => setOpen(c.id)}>
                    <CardCover cover={c.cover} />
                    {c.label_ids.length > 0 && <div className="card-labels">{c.label_ids.map((id) => labels[id] && <span key={id} className="label-chip" style={{ background: labels[id].color }}>{labels[id].name}</span>)}</div>}
                    <div className="card-title-row">{c.completed ? <span className="done-mark">✓</span> : null}<span className="card-title">{c.title}</span></div>
                    <div className="card-badges">
                      <PriorityBadge priority={c.priority} />
                      {c.due_date && <span className={`badge ${dueStatus(c.due_date, c.completed)}`}>🕑 {formatDate(c.due_date)}</span>}
                      {c.check_total > 0 && <span className="badge plain">☑ {c.check_done}/{c.check_total}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {card && (
        <div className="modal-backdrop" onMouseDown={() => setOpen(null)}>
          <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row"><h3>{card.title}</h3><div className="spacer" /><button className="icon-btn" onClick={() => setOpen(null)}>✕</button></div>
            {card.due_date && <p className="muted">Due {formatDate(card.due_date)}</p>}
            <p className="public-desc">{card.description || <span className="muted">No description.</span>}</p>
          </div>
        </div>
      )}
    </div>
  );
}
