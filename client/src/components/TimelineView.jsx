import { useMemo } from 'react';
import { navigate } from '../router.js';
import { addDays, daysBetween, fromYmd, ymd } from '../dates.js';

const DAY = 34; // px per day
const ROW = 34; // px per card row
const LABEL = 220; // px for the card-name column

// Gantt-style timeline: one bar per dated card (start → due), grouped by list, with arrows from
// each blocker to the cards it blocks. Cards without dates are counted below the chart.
export default function TimelineView({ data, cards, ctx }) {
  const model = useMemo(() => {
    const listOrder = Object.fromEntries(data.lists.map((l, i) => [l.id, i]));
    const dated = cards
      .filter((c) => c.start_date || c.due_date)
      .map((c) => {
        const start = (c.start_date || c.due_date).slice(0, 10);
        const end = (c.due_date || c.start_date).slice(0, 10);
        return { card: c, start: start <= end ? start : end, end: start <= end ? end : start };
      })
      .sort((a, b) => listOrder[a.card.list_id] - listOrder[b.card.list_id] || a.start.localeCompare(b.start));
    const today = ymd(new Date());
    if (!dated.length) return { dated, undated: cards.length, today };
    let first = dated.reduce((m, d) => (d.start < m ? d.start : m), dated[0].start);
    let last = dated.reduce((m, d) => (d.end > m ? d.end : m), dated[0].end);
    first = addDays(first < today ? first : today, -2);
    last = addDays(last > today ? last : today, 3);
    if (daysBetween(first, last) < 21) last = addDays(first, 21);
    const days = daysBetween(first, last) + 1;
    const rowOf = new Map(dated.map((d, i) => [d.card.id, i]));
    const arrows = [];
    for (const d of dated) {
      for (const bid of d.card.blocked_by || []) {
        if (!rowOf.has(bid)) continue;
        const from = dated[rowOf.get(bid)];
        arrows.push({ key: `${bid}>${d.card.id}`, from, to: d, fromRow: rowOf.get(bid), toRow: rowOf.get(d.card.id), late: from.end > d.start });
      }
    }
    return { dated, undated: cards.length - dated.length, first, days, arrows, today };
  }, [data.lists, cards]);

  if (!model.dated.length) {
    return <div className="timeline-empty muted">No cards with dates yet. Give cards a start or due date (🕑 Dates in a card) to see them on the timeline.</div>;
  }
  const { dated, first, days, arrows, today, undated } = model;
  const x = (day) => daysBetween(first, day) * DAY;
  const width = days * DAY;
  const height = dated.length * ROW;
  const listName = Object.fromEntries(data.lists.map((l) => [l.id, l.name]));
  const months = [];
  for (let i = 0; i < days; i++) {
    const d = fromYmd(addDays(first, i));
    if (i === 0 || d.getDate() === 1) months.push({ i, label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) });
  }

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <div className="timeline-grid" style={{ width: LABEL + width }}>
          <div className="timeline-head" style={{ paddingLeft: LABEL }}>
            <div className="timeline-months" style={{ width }}>
              {months.map((m) => <span key={m.i} style={{ left: m.i * DAY }}>{m.label}</span>)}
            </div>
            <div className="timeline-days" style={{ width }}>
              {Array.from({ length: days }, (_, i) => {
                const d = fromYmd(addDays(first, i));
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                return <span key={i} className={weekend ? 'weekend' : ''} style={{ left: i * DAY, width: DAY }}>{d.getDate()}</span>;
              })}
            </div>
          </div>
          <div className="timeline-body" style={{ height }}>
            <div className="timeline-labels" style={{ width: LABEL }}>
              {dated.map((d, i) => (
                <button key={d.card.id} className="timeline-label" style={{ top: i * ROW, height: ROW }} onClick={() => navigate(`/b/${ctx.boardId}/c/${d.card.id}`)} title={`${d.card.title} · ${listName[d.card.list_id]}`}>
                  <small>{listName[d.card.list_id]}</small>{d.card.title}
                </button>
              ))}
            </div>
            <svg className="timeline-chart" width={width} height={height} style={{ left: LABEL }} role="img" aria-label="Timeline">
              {Array.from({ length: days }, (_, i) => {
                const d = fromYmd(addDays(first, i)).getDay();
                return (d === 0 || d === 6) && <rect key={i} x={i * DAY} y={0} width={DAY} height={height} className="tl-weekend" />;
              })}
              <line x1={x(today) + DAY / 2} x2={x(today) + DAY / 2} y1={0} y2={height} className="tl-today" />
              <defs>
                <marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="tl-arrowhead" />
                </marker>
              </defs>
              {arrows.map((a) => {
                const x1 = x(a.from.end) + DAY - 2;
                const y1 = a.fromRow * ROW + ROW / 2;
                const x2 = x(a.to.start) + 2;
                const y2 = a.toRow * ROW + ROW / 2;
                const mid = Math.max(x1 + 10, x2 - 10);
                return <path key={a.key} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} className={`tl-dep ${a.late ? 'late' : ''}`} markerEnd="url(#tl-arrow)" />;
              })}
              {dated.map((d, i) => {
                const label = ctx.labelsById[d.card.label_ids?.[0]];
                return (
                  <g key={d.card.id} className={`tl-bar ${d.card.completed ? 'done' : ''}`} onClick={() => navigate(`/b/${ctx.boardId}/c/${d.card.id}`)}>
                    <title>{`${d.card.title}: ${d.start}${d.end !== d.start ? ` → ${d.end}` : ''}`}</title>
                    <rect x={x(d.start) + 2} y={i * ROW + 6} width={(daysBetween(d.start, d.end) + 1) * DAY - 4} height={ROW - 12} rx={5}
                      style={label ? { fill: label.color } : undefined} />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
      {undated > 0 && <p className="muted small">{undated} card{undated === 1 ? '' : 's'} without dates {undated === 1 ? 'is' : 'are'} not shown.</p>}
    </div>
  );
}
