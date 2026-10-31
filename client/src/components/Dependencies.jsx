import { useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';

// Card modal section: cards this one is blocked by (and, read-only, the cards it blocks).
export function CardDependencies({ card, boardCards, run, readOnly }) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const { blocked_by: blockers = [], blocking = [] } = card;
  if (readOnly && !blockers.length && !blocking.length) return null;
  const taken = new Set([card.id, ...blockers.map((b) => b.id)]);
  const ql = q.trim().toLowerCase();
  const choices = boardCards.filter((c) => !taken.has(c.id) && (!ql || c.title.toLowerCase().includes(ql))).slice(0, 8);
  const add = (id) => { setPicking(false); setQ(''); run(() => api.put(`/cards/${card.id}/blockers/${id}`)); };
  const open = (id) => navigate(`/b/${card.board_id}/c/${id}`);
  const item = (c, remove) => (
    <li key={c.id} className={c.completed ? 'done' : ''}>
      <button className="link-btn" onClick={() => open(c.id)}>{c.completed ? '✓ ' : ''}{c.title}</button>
      {remove && !readOnly && <button className="icon-btn" title="Remove" onClick={() => run(() => api.del(`/cards/${card.id}/blockers/${c.id}`))}>✕</button>}
    </li>
  );
  const open_ = blockers.filter((b) => !b.completed).length;
  return (
    <section className="section dependencies">
      <div className="section-head">
        <h4>⛓ Dependencies {open_ > 0 && <span className="badge overdue">Blocked by {open_}</span>}</h4>
        {!readOnly && !picking && <button className="btn" onClick={() => setPicking(true)}>+ Blocked by…</button>}
      </div>
      {picking && (
        <div className="dep-picker">
          <input autoFocus placeholder="Find a card on this board…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); } if (e.key === 'Enter' && choices[0]) add(choices[0].id); }} />
          <ul>{choices.map((c) => <li key={c.id}><button className="link-btn" onClick={() => add(c.id)}>{c.title}</button></li>)}</ul>
        </div>
      )}
      {blockers.length > 0 && <><div className="muted small">Blocked by</div><ul className="dep-list">{blockers.map((c) => item(c, true))}</ul></>}
      {blocking.length > 0 && <><div className="muted small">Blocking</div><ul className="dep-list">{blocking.map((c) => item(c, false))}</ul></>}
    </section>
  );
}
