import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { addDays, daysBetween, ymd } from '../dates.js';

const TYPE_ICON = { card: '', checklist: '☑ ', item: '• ', list: '▤ ' };
const PATCH_PATH = { card: 'cards', checklist: 'checklists', item: 'items', list: 'lists' };

// Month calendar of everything with a date. boardId limits it to one board; without it, every board
// you can see. keep(event) filters (e.g. by card member). Drag an entry to another day to reschedule.
export default function CalendarView({ boardId, keep = () => true, canEdit = true, onChanged }) {
  const today = ymd(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(null);

  // Grid: whole weeks (Sunday first) covering the month.
  const first = `${month}-01`;
  const gridStart = addDays(first, -new Date(`${first}T00:00`).getDay());
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const gridEnd = days[41];

  const load = useCallback(() => {
    const q = new URLSearchParams({ from: gridStart, to: gridEnd });
    if (boardId) q.set('board', boardId);
    api.get(`/dates?${q}`).then((e) => { setEvents(e); setError(''); }).catch((e) => setError(e.message));
  }, [boardId, gridStart, gridEnd]);
  useEffect(() => { load(); }, [load]);

  // Cards with a start date also appear (marked) on their start day.
  const byDay = useMemo(() => {
    const map = {};
    const add = (day, e) => { (map[day] ||= []).push(e); };
    for (const e of events.filter(keep)) {
      add(e.date.slice(0, 10), e);
      if (e.type === 'card' && e.start_date && e.start_date.slice(0, 10) !== e.date.slice(0, 10)) add(e.start_date.slice(0, 10), { ...e, isStart: true });
    }
    return map;
  }, [events, keep]);

  const shiftMonth = (n) => {
    const d = new Date(`${month}-01T00:00`);
    d.setMonth(d.getMonth() + n);
    setMonth(ymd(d).slice(0, 7));
  };
  const goToday = () => { setMonth(today.slice(0, 7)); setSelected(today); };

  const open = (e) => {
    if (e.card_id) navigate(`/b/${e.board_id}/c/${e.card_id}`);
    else navigate(`/b/${e.board_id}`);
  };

  // Keep the time of day; a card with a start date keeps its length.
  const reschedule = async (e, day) => {
    const oldDay = (e.isStart ? e.start_date : e.date).slice(0, 10);
    if (oldDay === day) return;
    const delta = daysBetween(oldDay, day);
    const body = { due_date: addDays(e.date, delta) + e.date.slice(10) };
    if (e.type === 'card' && e.start_date) body.start_date = addDays(e.start_date, delta) + e.start_date.slice(10);
    try {
      await api.patch(`/${PATCH_PATH[e.type]}/${e.id}`, body);
    } catch (err) {
      alert(`Could not move "${e.title}": ${err.message}`);
    }
    load();
    onChanged?.();
  };

  const monthLabel = new Date(`${month}-01T00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = days.slice(0, 7).map((d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: 'short' }));
  const agenda = byDay[selected] || [];

  const chip = (e, compact) => {
    const overdue = !e.done && e.date.slice(0, 10) < today && e.type !== 'list';
    return (
      <button
        key={`${e.type}:${e.id}:${e.isStart ? 's' : 'd'}`}
        className={`cal-event ${e.type} ${e.done ? 'done' : ''} ${overdue ? 'overdue' : ''} ${e.isStart ? 'start' : ''}`}
        style={{ '--ev': e.board_color || 'var(--accent)' }}
        draggable={canEdit}
        onDragStart={(ev) => { setDragging(e); ev.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => setDragging(null)}
        onClick={(ev) => { ev.stopPropagation(); open(e); }}
        title={`${e.title}${boardId ? '' : ` — ${e.board_name}`}`}
      >
        {e.isStart ? '▶ ' : TYPE_ICON[e.type]}{e.date.length > 10 && !e.isStart && !compact ? `${new Date(e.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ` : ''}{e.title}
      </button>
    );
  };

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
        <button className="btn" onClick={goToday}>Today</button>
        <button className="btn" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
        <h3>{monthLabel}</h3>
        {error && <span className="error small">{error}</span>}
      </div>
      <div className="cal-grid" role="grid">
        {weekdays.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
        {days.map((d) => {
          const list = byDay[d] || [];
          return (
            <div
              key={d}
              role="gridcell"
              className={`cal-day ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''} ${d === selected ? 'selected' : ''} ${dragging ? 'droppable' : ''}`}
              onClick={() => setSelected(d)}
              onDragOver={(ev) => { if (dragging) ev.preventDefault(); }}
              onDrop={(ev) => { ev.preventDefault(); if (dragging) reschedule(dragging, d); setDragging(null); }}
            >
              <span className="cal-num">{Number(d.slice(8))}</span>
              <div className="cal-events">{list.slice(0, 3).map((e) => chip(e, true))}</div>
              {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
              {list.length > 0 && <span className="cal-dots" aria-hidden="true">{list.slice(0, 4).map((e, i) => <i key={i} style={{ background: e.board_color || 'var(--accent)' }} />)}</span>}
            </div>
          );
        })}
      </div>
      <div className="cal-agenda">
        <h4>{new Date(`${selected}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h4>
        {agenda.length === 0 && <p className="muted small">Nothing due.</p>}
        {agenda.map((e) => (
          <div key={`${e.type}:${e.id}:${e.isStart ? 's' : 'd'}`} className="agenda-row">
            {chip(e, false)}
            <span className="muted small">{boardId ? e.list_name : `${e.board_name} · ${e.list_name}`}</span>
          </div>
        ))}
        {canEdit && <p className="muted small hint">Tip: drag an entry to another day to reschedule it.</p>}
      </div>
    </div>
  );
}
