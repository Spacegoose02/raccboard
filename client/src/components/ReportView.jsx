import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from '../dates.js';
import { PRIORITIES, formatMinutes } from './Planning.jsx';

const Bar = ({ value, max, tone = '' }) => <div className={`rbar ${tone}`}><div style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>;

// Board reports: totals, cards per list and person, throughput, cycle time and sprint burndown.
export default function ReportView({ boardId, refreshKey }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/boards/${boardId}/report`).then(setR).catch((e) => setError(e.message)); }, [boardId, refreshKey]);
  if (error) return <p className="error">{error}</p>;
  if (!r) return <p className="muted loading-view">Loading…</p>;
  const t = r.totals;
  const maxList = Math.max(1, ...r.byList.map((l) => l.open + l.done));
  const maxMember = Math.max(1, r.unassigned, ...r.members.map((m) => m.open));
  const maxWeek = Math.max(1, ...r.weeks.flatMap((w) => [w.created, w.completed]));
  const maxPri = Math.max(1, ...r.priorities);
  return (
    <div className="report">
      <div className="stat-row">
        {[['Open', t.open], ['Done', t.done], ['Overdue', t.overdue, t.overdue ? 'bad' : ''], ['Open points', t.points_open], ['Time logged', formatMinutes(t.time_minutes)],
          ['Cycle time', r.cycle ? `${r.cycle.median.toFixed(1)} d` : '–']].map(([k, v, tone]) => (
          <div key={k} className={`stat ${tone || ''}`}><div className="stat-v">{v}</div><div className="stat-k">{k}</div></div>
        ))}
      </div>
      <div className="report-grid">
        <section className="report-card">
          <h4>Cards per list</h4>
          {r.byList.map((l) => (
            <div key={l.id} className="rrow">
              <span className="rname">{l.name}</span>
              <Bar value={l.open} max={maxList} tone={l.wip_limit && l.open > l.wip_limit ? 'bad' : ''} />
              <span className="rnum">{l.open}{l.wip_limit ? `/${l.wip_limit}` : ''}{l.done ? <span className="muted"> +{l.done} done</span> : null}</span>
            </div>
          ))}
        </section>
        <section className="report-card">
          <h4>Workload (open cards)</h4>
          {r.members.map((m) => (
            <div key={m.id} className="rrow">
              <span className="rname">{m.display_name}</span><Bar value={m.open} max={maxMember} />
              <span className="rnum">{m.open}{m.points ? ` · ${m.points} pts` : ''}{m.overdue ? <span className="bad-text"> · {m.overdue} late</span> : null}</span>
            </div>
          ))}
          <div className="rrow"><span className="rname muted">Unassigned</span><Bar value={r.unassigned} max={maxMember} tone="muted" /><span className="rnum">{r.unassigned}</span></div>
        </section>
        <section className="report-card">
          <h4>Open cards by priority</h4>
          {[4, 3, 2, 1, 0].map((p) => (
            <div key={p} className="rrow"><span className="rname">{PRIORITIES[p].icon} {PRIORITIES[p].name}</span><Bar value={r.priorities[p]} max={maxPri} tone={PRIORITIES[p].cls} /><span className="rnum">{r.priorities[p]}</span></div>
          ))}
        </section>
        <section className="report-card">
          <h4>Created vs completed (8 weeks)</h4>
          <div className="weeks">
            {r.weeks.map((w) => (
              <div key={w.week} className="week" title={`Week of ${formatDate(w.week)}: ${w.created} created, ${w.completed} completed`}>
                <div className="wbars">
                  <div className="wbar created" style={{ height: `${(w.created / maxWeek) * 100}%` }} />
                  <div className="wbar completed" style={{ height: `${(w.completed / maxWeek) * 100}%` }} />
                </div>
                <span className="wlabel">{w.week.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="legend small"><span className="key created" /> Created <span className="key completed" /> Completed</div>
          {r.cycle && <p className="muted small">Last 30 days: {r.cycle.count} finished, median {r.cycle.median.toFixed(1)} days and average {r.cycle.avg.toFixed(1)} days from created to done.</p>}
        </section>
        {r.burndown && <Burndown b={r.burndown} />}
      </div>
    </div>
  );
}

function Burndown({ b }) {
  const usePoints = b.points > 0;
  const total = usePoints ? b.points : b.total;
  const n = b.days.length;
  const W = 320;
  const H = 140;
  const x = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v) => H - (total ? (v / total) * H : 0);
  const pts = b.days.map((d, i) => (d.cards === undefined ? null : `${x(i)},${y(usePoints ? d.points : d.cards)}`)).filter(Boolean).join(' ');
  return (
    <section className="report-card">
      <h4>Burndown: {b.sprint.name}</h4>
      <p className="muted small">{b.total} cards{usePoints ? `, ${b.points} points` : ''}{b.sprint.end_date ? ` · ends ${formatDate(b.sprint.end_date)}` : ''}</p>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="burndown" role="img" aria-label="Sprint burndown">
        <line x1="0" y1={y(total)} x2={W} y2={H} className="ideal" />
        <polyline points={pts} className="actual" />
      </svg>
      <div className="legend small"><span className="key ideal" /> Ideal <span className="key actual" /> Remaining {usePoints ? 'points' : 'cards'}</div>
    </section>
  );
}
