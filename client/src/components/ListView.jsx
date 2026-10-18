import { useMemo, useState } from 'react';
import { navigate } from '../router.js';
import { dueStatus, formatDate } from '../dates.js';
import { Avatar } from './Avatar.jsx';
import { CompleteCircle } from './ui.jsx';

const COLUMNS = [
  { id: 'title', label: 'Card' },
  { id: 'list', label: 'List' },
  { id: 'labels', label: 'Labels', sortable: false },
  { id: 'members', label: 'Members', sortable: false },
  { id: 'start', label: 'Start' },
  { id: 'due', label: 'Due' },
  { id: 'progress', label: 'Checklist' },
];

// Table of every card on the board: sort, search, hide completed, open a card.
export default function ListView({ data, cards, ctx }) {
  const [sort, setSort] = useState({ by: 'due', dir: 1 });
  const [query, setQuery] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const listOrder = useMemo(() => Object.fromEntries(data.lists.map((l, i) => [l.id, i])), [data.lists]);
  const listName = useMemo(() => Object.fromEntries(data.lists.map((l) => [l.id, l.name])), [data.lists]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const key = {
      title: (c) => c.title.toLowerCase(),
      list: (c) => listOrder[c.list_id] * 1e6 + c.position,
      start: (c) => c.start_date || '~',
      due: (c) => c.due_date || '~',
      progress: (c) => (c.check_total ? c.check_done / c.check_total : -1),
    }[sort.by];
    return cards
      .filter((c) => !hideDone || !c.completed)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q))
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }, [cards, query, hideDone, sort, listOrder]);

  const header = (col) => {
    if (col.sortable === false) return <th key={col.id}>{col.label}</th>;
    const active = sort.by === col.id;
    return (
      <th key={col.id} aria-sort={active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
        <button className="th-sort" onClick={() => setSort({ by: col.id, dir: active ? -sort.dir : 1 })}>
          {col.label}{active ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
        </button>
      </th>
    );
  };

  return (
    <div className="list-view">
      <div className="list-view-tools">
        <input type="search" placeholder="Search cards…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check-field"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide completed</label>
        <span className="muted small">{rows.length} card{rows.length === 1 ? '' : 's'}</span>
      </div>
      <table className="card-table">
        <thead><tr><th className="col-done" aria-label="Done" />{COLUMNS.map(header)}</tr></thead>
        <tbody>
          {rows.map((c) => {
            const due = dueStatus(c.due_date, c.completed);
            return (
              <tr key={c.id} className={c.completed ? 'completed' : ''} onClick={() => navigate(`/b/${ctx.boardId}/c/${c.id}`)}>
                <td className="col-done" onClick={(e) => e.stopPropagation()}>
                  {ctx.canEdit ? <CompleteCircle done={!!c.completed} onToggle={() => ctx.toggleCard(c)} size={18} /> : c.completed ? '✓' : ''}
                </td>
                <td className="col-title" data-label="Card">{c.title}</td>
                <td data-label="List"><span className="list-pill">{listName[c.list_id]}</span></td>
                <td data-label="Labels">
                  <span className="chips">{c.label_ids.map((id) => ctx.labelsById[id] && <span key={id} className="label-chip" style={{ background: ctx.labelsById[id].color }}>{ctx.labelsById[id].name}</span>)}</span>
                </td>
                <td data-label="Members">
                  <span className="card-members">{c.member_ids.map((id) => ctx.peopleById[id] && <Avatar key={id} user={ctx.peopleById[id]} size={22} />)}</span>
                </td>
                <td data-label="Start">{c.start_date ? formatDate(c.start_date, { withTime: false }) : ''}</td>
                <td data-label="Due">{c.due_date && <span className={`badge ${due}`}>{formatDate(c.due_date)}</span>}</td>
                <td data-label="Checklist">
                  {c.check_total > 0 && (
                    <span className="mini-progress" title={`${c.check_done}/${c.check_total}`}>
                      <span className="bar"><span className={`fill ${c.check_done === c.check_total ? 'complete' : ''}`} style={{ width: `${(c.check_done / c.check_total) * 100}%` }} /></span>
                      {c.check_done}/{c.check_total}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted empty">No cards match.</p>}
    </div>
  );
}
