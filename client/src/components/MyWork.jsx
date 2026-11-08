import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { dueStatus, formatDate, ymd, addDays } from '../dates.js';
import { CompleteCircle } from './ui.jsx';
import { PriorityBadge } from './Planning.jsx';

// Everything assigned to me on every board, grouped by when it's due.
export default function MyWork() {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('due');
  const [showDone, setShowDone] = useState(false);
  const load = () => api.get(`/my-work${showDone ? '?done=1' : ''}`).then((d) => setCards(d.cards)).catch((e) => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [showDone]);
  const toggle = async (c) => {
    setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, completed: c.completed ? 0 : 1 } : x)));
    try { await api.patch(`/cards/${c.id}`, { completed: !c.completed }); } catch (e) { alert(e.message); }
    load();
  };
  const groups = useMemo(() => {
    if (!cards) return [];
    const today = ymd(new Date());
    const week = addDays(today, 7);
    const day = (c) => (c.due_date || '').slice(0, 10);
    const buckets = [
      ['Overdue', (c) => !c.completed && day(c) && day(c) < today],
      ['Today', (c) => !c.completed && day(c) === today],
      ['Next 7 days', (c) => !c.completed && day(c) > today && day(c) <= week],
      ['Later', (c) => !c.completed && day(c) > week],
      ['No due date', (c) => !c.completed && !day(c)],
      ['Done this week', (c) => !!c.completed],
    ];
    if (sort === 'board') {
      const by = {};
      for (const c of cards) (by[c.board_name] ||= []).push(c);
      return Object.entries(by).sort(([a], [b]) => a.localeCompare(b));
    }
    if (sort === 'priority') {
      return [4, 3, 2, 1, 0].map((p) => [['Urgent', 'High', 'Medium', 'Low', 'No priority'][4 - p], cards.filter((c) => !c.completed && (c.priority || 0) === p)])
        .concat([['Done this week', cards.filter((c) => c.completed)]]).filter(([, l]) => l.length);
    }
    return buckets.map(([name, fn]) => [name, cards.filter(fn)]).filter(([, l]) => l.length);
  }, [cards, sort]);

  return (
    <div className="page my-work">
      <div className="row page-head">
        <h2>My work</h2>
        <div className="spacer" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Group by">
          <option value="due">By due date</option>
          <option value="priority">By priority</option>
          <option value="board">By board</option>
        </select>
        <label className="check-field"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      <p className="muted small">Cards you're a member of, on every board you can open.</p>
      {error && <p className="error">{error}</p>}
      {!cards ? <p className="muted">Loading…</p> : cards.length === 0 ? (
        <p className="muted">Nothing assigned to you. Join a card (or press <kbd>q</kbd> on a board to see yours) and it shows up here.</p>
      ) : groups.map(([name, list]) => (
        <section key={name} className="work-group">
          <h4>{name} <span className="muted small">{list.length}</span></h4>
          <ul className="work-list">
            {list.map((c) => (
              <li key={c.id} className={c.completed ? 'done' : ''}>
                <CompleteCircle done={!!c.completed} onToggle={() => toggle(c)} />
                <button className="work-title" onClick={() => navigate(`/b/${c.board_id}/c/${c.id}`)}>{c.title}</button>
                <PriorityBadge priority={c.priority} />
                {c.check_total > 0 && <span className="badge plain">☑ {c.check_done}/{c.check_total}</span>}
                {c.due_date && <span className={`badge ${dueStatus(c.due_date, c.completed)}`}>🕑 {formatDate(c.due_date)}</span>}
                <span className="work-where muted small"><span className="board-dot" style={{ background: c.board_color || 'var(--accent)' }} />{c.board_name} · {c.list_name}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
