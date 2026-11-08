import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { formatDate, timeAgo } from '../dates.js';
import { Composer } from './ui.jsx';

export const PRIORITIES = [
  { id: 0, name: 'No priority', icon: '' },
  { id: 1, name: 'Low', icon: '▂', cls: 'p-low' },
  { id: 2, name: 'Medium', icon: '▄', cls: 'p-med' },
  { id: 3, name: 'High', icon: '▆', cls: 'p-high' },
  { id: 4, name: 'Urgent', icon: '‼', cls: 'p-urgent' },
];

export function PriorityBadge({ priority }) {
  const p = PRIORITIES[priority || 0];
  if (!p?.icon) return null;
  return <span className={`badge priority ${p.cls}`} title={`Priority: ${p.name}`}>{p.icon} <span className="hide-sm">{p.name}</span></span>;
}

export function formatMinutes(m) {
  const n = Math.round(Number(m) || 0);
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  return n % 60 ? `${h}h ${n % 60}m` : `${h}h`;
}

// "1h 30m", "90", "1.5h", "45m" → minutes
export function parseDuration(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  let total = 0;
  let matched = false;
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)/g)) {
    matched = true;
    total += u.startsWith('h') ? Number(n) * 60 : Number(n);
  }
  return matched ? total : null;
}

// Card modal row: priority, estimate (points) and sprint.
export function CardPlanning({ card, sprints = [], patchCard, readOnly }) {
  const [est, setEst] = useState(card.estimate ?? '');
  useEffect(() => { setEst(card.estimate ?? ''); }, [card.estimate]);
  const saveEst = () => {
    const v = String(est).trim();
    const n = v === '' ? null : Number(v);
    if (v !== '' && !(n >= 0)) { setEst(card.estimate ?? ''); return; }
    if (n !== (card.estimate ?? null)) patchCard({ estimate: n });
  };
  const open = sprints.filter((s) => s.status !== 'closed' || s.id === card.sprint_id);
  return (
    <div className="meta-row planning-row">
      <div className="meta">
        <h5>Priority</h5>
        <select value={card.priority || 0} disabled={readOnly} onChange={(e) => patchCard({ priority: Number(e.target.value) })} aria-label="Priority">
          {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.icon ? `${p.icon} ` : ''}{p.name}</option>)}
        </select>
      </div>
      <div className="meta">
        <h5>Estimate</h5>
        <input className="estimate-input" type="number" min="0" step="0.5" placeholder="Points" value={est} disabled={readOnly}
          onChange={(e) => setEst(e.target.value)} onBlur={saveEst} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} aria-label="Estimate in points" />
      </div>
      {(open.length > 0 || card.sprint_id) && (
        <div className="meta">
          <h5>Sprint</h5>
          <select value={card.sprint_id || ''} disabled={readOnly} onChange={(e) => patchCard({ sprint_id: e.target.value || null })} aria-label="Sprint">
            <option value="">Backlog</option>
            {open.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (active)' : s.status === 'closed' ? ' (closed)' : ''}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// Sub-cards: child cards with a progress bar, plus a link back to the parent.
export function SubCards({ card, boardCards = [], run, patchCard, readOnly }) {
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');
  const kids = card.children || [];
  const done = kids.filter((k) => k.completed).length;
  const open = (id) => navigate(`/b/${card.board_id}/c/${id}`);
  const taken = new Set([card.id, ...kids.map((k) => k.id), card.parent_id]);
  const ql = q.trim().toLowerCase();
  const choices = boardCards.filter((c) => !taken.has(c.id) && !c.is_template && (!ql || c.title.toLowerCase().includes(ql))).slice(0, 8);
  if (readOnly && !kids.length && !card.parent) return null;
  return (
    <section className="section subcards">
      {card.parent && (
        <div className="parent-link">
          <span className="muted small">Sub-card of </span>
          <button className="link-btn" onClick={() => open(card.parent.id)}>{card.parent.completed ? '✓ ' : ''}{card.parent.title}</button>
          {!readOnly && <button className="icon-btn" title="Make this a top-level card" onClick={() => patchCard({ parent_id: null })}>✕</button>}
        </div>
      )}
      <div className="section-head">
        <h4>🗂 Sub-cards {kids.length > 0 && <span className="muted small">{done}/{kids.length}</span>}</h4>
        {!readOnly && !linking && <button className="btn" onClick={() => setLinking(true)}>Add existing…</button>}
      </div>
      {kids.length > 0 && <div className="progress"><div style={{ width: `${(done / kids.length) * 100}%` }} /></div>}
      {linking && (
        <div className="dep-picker">
          <input autoFocus placeholder="Find a card to put under this one…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLinking(false); } if (e.key === 'Enter' && choices[0]) { run(() => api.patch(`/cards/${choices[0].id}`, { parent_id: card.id })); setLinking(false); setQ(''); } }} />
          <ul>{choices.map((c) => <li key={c.id}><button className="link-btn" onClick={() => { setLinking(false); setQ(''); run(() => api.patch(`/cards/${c.id}`, { parent_id: card.id })); }}>{c.title}</button></li>)}</ul>
        </div>
      )}
      <ul className="subcard-list">
        {kids.map((k) => (
          <li key={k.id} className={k.completed ? 'done' : ''}>
            <input type="checkbox" checked={!!k.completed} disabled={readOnly} onChange={() => run(() => api.patch(`/cards/${k.id}`, { completed: !k.completed }))} aria-label={`Complete ${k.title}`} />
            <button className="link-btn" onClick={() => open(k.id)}>{k.title}</button>
            <PriorityBadge priority={k.priority} />
            <span className="muted small">{k.list_name}{k.due_date ? ` · due ${formatDate(k.due_date)}` : ''}</span>
            {!readOnly && <button className="icon-btn" title="Detach" onClick={() => run(() => api.patch(`/cards/${k.id}`, { parent_id: null }))}>✕</button>}
          </li>
        ))}
      </ul>
      {!readOnly && <Composer openLabel="+ Add a sub-card" placeholder="Sub-card title…" buttonLabel="Add" onAdd={(title) => run(() => api.post(`/cards/${card.id}/subcards`, { title }))} />}
    </section>
  );
}

// Start/stop timer and logged time.
export function TimeTracking({ card, entries = [], meId, run, readOnly }) {
  const running = entries.find((e) => !e.ended_at && e.user_id === meId);
  const [, tick] = useState(0);
  useEffect(() => { if (!running) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [running]);
  const [manual, setManual] = useState('');
  const total = entries.reduce((s, e) => s + (e.minutes || 0), 0);
  if (readOnly && !entries.length) return null;
  const elapsed = running ? Math.floor((Date.now() - Date.parse(running.started_at)) / 1000) : 0;
  const clock = `${Math.floor(elapsed / 3600)}:${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const log = () => {
    const m = parseDuration(manual);
    if (!m) { alert('Enter a time like 45m, 1h 30m or 1.5h'); return; }
    setManual('');
    run(() => api.post(`/cards/${card.id}/time`, { minutes: m }));
  };
  return (
    <section className="section time-tracking">
      <div className="section-head">
        <h4>⏱ Time {total > 0 && <span className="muted small">{formatMinutes(total)} logged{card.estimate ? ` · estimate ${card.estimate} pts` : ''}</span>}</h4>
        {!readOnly && (running
          ? <button className="btn danger" onClick={() => run(() => api.post(`/cards/${card.id}/timer/stop`))}>■ Stop {clock}</button>
          : <button className="btn" onClick={() => run(() => api.post(`/cards/${card.id}/timer/start`))}>▶ Start timer</button>)}
      </div>
      {!readOnly && (
        <div className="row time-log">
          <input placeholder="Log time, e.g. 1h 15m" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && log()} />
          <button className="btn" onClick={log} disabled={!manual.trim()}>Log</button>
        </div>
      )}
      {entries.length > 0 && (
        <ul className="time-entries">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id}>
              <span>{e.ended_at ? formatMinutes(e.minutes) : 'running…'}</span>
              <span className="muted small">{e.user_name || 'Someone'} · {timeAgo(e.started_at)}{e.note ? ` · ${e.note}` : ''}</span>
              {!readOnly && e.user_id === meId && e.ended_at && <button className="icon-btn" title="Delete" onClick={() => run(() => api.del(`/time/${e.id}`))}>✕</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
