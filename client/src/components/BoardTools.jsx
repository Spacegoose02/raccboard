import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { IS_NATIVE } from '../config.js';
import { getSettings } from '../settings.js';
import { formatDate } from '../dates.js';
import { Menu } from './ui.jsx';
import { PRIORITIES } from './Planning.jsx';

const origin = () => (IS_NATIVE ? (getSettings().serverUrl || '').replace(/\/+$/, '') : window.location.origin);
const copy = (text) => navigator.clipboard?.writeText(text).then(() => alert('Copied.'), () => window.prompt('Copy this:', text));

function Drawer({ title, onClose, children }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer wide-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
        {children}
      </aside>
    </div>
  );
}

/* ---------- Sprints ---------- */

export function SprintsDrawer({ boardId, sprints, cards, canEdit, onClose, onChanged }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const act = async (fn) => { try { const r = await fn(); if (r?.rolled) alert(`${r.rolled} unfinished card${r.rolled === 1 ? '' : 's'} moved on.`); } catch (e) { alert(e.message); } onChanged(); };
  const stats = (id) => {
    const cs = cards.filter((c) => c.sprint_id === id);
    return `${cs.filter((c) => c.completed).length}/${cs.length} done${cs.some((c) => c.estimate) ? ` · ${cs.reduce((s, c) => s + (c.estimate || 0), 0)} pts` : ''}`;
  };
  return (
    <Drawer title="🏃 Sprints" onClose={onClose}>
      <p className="muted small">Time-boxed rounds of work. Put cards in a sprint from the card, or select several cards and use “Sprint”. Closing a sprint moves its unfinished cards to the next planned one.</p>
      {sprints.length === 0 && <p className="muted">No sprints yet.</p>}
      {sprints.map((s) => (
        <div key={s.id} className={`drawer-row sprint-row ${s.status}`}>
          <div className="grow">
            <strong>{s.name}</strong> <span className={`badge ${s.status === 'active' ? 'done' : 'plain'}`}>{s.status}</span>
            <div className="muted small">{s.start_date ? formatDate(s.start_date) : 'No start'} – {s.end_date ? formatDate(s.end_date) : 'no end'} · {stats(s.id)}</div>
          </div>
          {canEdit && <Menu items={[
            s.status !== 'active' && { label: '▶ Start sprint', onClick: () => act(() => api.patch(`/sprints/${s.id}`, { status: 'active' })) },
            s.status === 'active' && { label: '■ Close sprint', onClick: () => act(() => api.patch(`/sprints/${s.id}`, { status: 'closed' })) },
            { label: 'Rename', onClick: () => { const n = window.prompt('Sprint name', s.name); if (n) act(() => api.patch(`/sprints/${s.id}`, { name: n })); } },
            { label: 'Set end date', onClick: () => { const d = window.prompt('End date (YYYY-MM-DD)', s.end_date || ''); if (d !== null) act(() => api.patch(`/sprints/${s.id}`, { end_date: d || null })); } },
            { label: 'Delete', danger: true, onClick: () => confirm(`Delete ${s.name}? Its cards go back to the backlog.`) && act(() => api.del(`/sprints/${s.id}`)) },
          ]} />}
        </div>
      ))}
      {canEdit && (
        <div className="stack new-sprint">
          <h4>New sprint</h4>
          <input placeholder={`Sprint ${sprints.length + 1}`} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <label className="field">Start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="field">End<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <button className="btn primary" onClick={() => { act(() => api.post(`/boards/${boardId}/sprints`, { name, start_date: start || null, end_date: end || null })); setName(''); setStart(''); setEnd(''); }}>Add sprint</button>
        </div>
      )}
    </Drawer>
  );
}

/* ---------- Public link, email to board, card aging ---------- */

export function BoardExtrasDrawer({ board, lists, onClose, onChanged }) {
  const [b, setB] = useState(board);
  useEffect(() => setB(board), [board]);
  const [listId, setListId] = useState(board.inbound_list_id || '');
  const run = async (fn) => { try { await fn(); } catch (e) { alert(e.message); } onChanged(); };
  const publicUrl = b.public_token && `${origin()}/#/p/${b.public_token}`;
  const inboundUrl = b.inbound_token && `${origin()}/api/inbound/${b.inbound_token}`;
  return (
    <Drawer title="🔗 Sharing and intake" onClose={onClose}>
      <section>
        <h4>Public read-only link</h4>
        <p className="muted small">Anyone with the link can see lists and cards (titles, descriptions, labels, dates). They can't see people, comments or attachments, and can't change anything.</p>
        {publicUrl ? (
          <div className="stack">
            <input readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
            <div className="row">
              <button className="btn" onClick={() => copy(publicUrl)}>Copy link</button>
              <button className="btn" onClick={() => run(() => api.post(`/boards/${b.id}/public-link`))}>New link</button>
              <button className="btn danger" onClick={() => run(() => api.del(`/boards/${b.id}/public-link`))}>Turn off</button>
            </div>
          </div>
        ) : <button className="btn primary" onClick={() => run(() => api.post(`/boards/${b.id}/public-link`))}>Create link</button>}
      </section>
      <section>
        <h4>Email to board</h4>
        <p className="muted small">Each email becomes a card: subject as the title, body as the description. Point an inbound-email service (Mailgun, SendGrid, Postmark, Cloudflare Email Workers…) at this URL. It accepts JSON or form posts with <code>subject</code> and <code>text</code>.</p>
        <label className="field">Add cards to
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">First list</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {inboundUrl ? (
          <div className="stack">
            <input readOnly value={inboundUrl} onFocus={(e) => e.target.select()} />
            <div className="row">
              <button className="btn" onClick={() => copy(inboundUrl)}>Copy URL</button>
              <button className="btn" onClick={() => run(() => api.post(`/boards/${b.id}/inbound`, { list_id: listId || null }))}>Save list</button>
              <button className="btn" onClick={() => run(() => api.post(`/boards/${b.id}/inbound`, { list_id: listId || null, rotate: true }))}>New URL</button>
              <button className="btn danger" onClick={() => run(() => api.del(`/boards/${b.id}/inbound`))}>Turn off</button>
            </div>
          </div>
        ) : <button className="btn primary" onClick={() => run(() => api.post(`/boards/${b.id}/inbound`, { list_id: listId || null }))}>Turn on</button>}
      </section>
      <section>
        <h4>Card aging</h4>
        <p className="muted small">Cards nobody has touched for a while fade out, so stale work stands out.</p>
        <select value={b.aging_days || 0} onChange={(e) => run(() => api.patch(`/boards/${b.id}`, { aging_days: Number(e.target.value) }))}>
          <option value={0}>Off</option>
          {[7, 14, 30, 60].map((d) => <option key={d} value={d}>Fade after {d} days</option>)}
        </select>
      </section>
    </Drawer>
  );
}

/* ---------- Saved views ---------- */

export function SavedViews({ boardId, filter, setFilter, isFiltering, canEdit, empty }) {
  const [views, setViews] = useState([]);
  const load = () => api.get(`/boards/${boardId}/views`).then(setViews).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [boardId]);
  const save = async () => {
    const name = window.prompt('Name this view');
    if (!name) return;
    const shared = canEdit && confirm('Share this view with everyone on the board? (Cancel keeps it just for you.)');
    try { await api.post(`/boards/${boardId}/views`, { name, filter, shared }); } catch (e) { alert(e.message); }
    load();
  };
  return (
    <Menu className="saved-views" label="★ Views" items={[
      ...views.map((v) => ({ label: `${v.shared ? '👪' : '★'} ${v.name}`, onClick: () => setFilter({ ...empty, ...v.filter }) })),
      views.length === 0 && { label: 'No saved views yet', onClick: () => {} },
      isFiltering && { label: '+ Save current filters…', onClick: save },
      ...views.map((v) => ({ label: `Delete "${v.name}"`, danger: true, onClick: () => confirm(`Delete view "${v.name}"?`) && api.del(`/views/${v.id}`).then(load, (e) => alert(e.message)) })),
    ]} />
  );
}

/* ---------- Bulk bar ---------- */

export function BulkBar({ boardId, selected, data, onDone, onClear }) {
  const [busy, setBusy] = useState(false);
  const n = selected.length;
  const go = async (action, value) => {
    if (action === 'archive' && !confirm(`Archive ${n} card${n === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    try { await api.post(`/boards/${boardId}/bulk`, { card_ids: selected, action, value }); onDone(action === 'archive'); } catch (e) { alert(e.message); }
    setBusy(false);
  };
  const sprints = (data.sprints || []).filter((s) => s.status !== 'closed');
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <strong>{n} selected</strong>
      <Menu label="Move ▾" items={data.lists.map((l) => ({ label: l.name, onClick: () => go('move', l.id) }))} />
      <Menu label="Label ▾" items={data.labels.flatMap((l) => [{ label: `+ ${l.name || l.color}`, onClick: () => go('add_label', l.id) }, { label: `− ${l.name || l.color}`, onClick: () => go('remove_label', l.id) }])} />
      <Menu label="Member ▾" items={data.people.flatMap((p) => [{ label: `+ ${p.display_name}`, onClick: () => go('add_member', p.id) }, { label: `− ${p.display_name}`, onClick: () => go('remove_member', p.id) }])} />
      <Menu label="Priority ▾" items={PRIORITIES.map((p) => ({ label: `${p.icon} ${p.name}`, onClick: () => go('priority', p.id) }))} />
      {sprints.length > 0 && <Menu label="Sprint ▾" items={[{ label: 'Backlog', onClick: () => go('sprint', null) }, ...sprints.map((s) => ({ label: s.name, onClick: () => go('sprint', s.id) }))]} />}
      <button className="btn" disabled={busy} onClick={() => { const d = window.prompt('Due date for all (YYYY-MM-DD, blank to clear)'); if (d !== null) go('due_date', d || null); }}>Due…</button>
      <button className="btn" disabled={busy} onClick={() => go('complete')}>✓ Complete</button>
      <button className="btn" disabled={busy} onClick={() => go('incomplete')}>↺ Reopen</button>
      <button className="btn danger" disabled={busy} onClick={() => go('archive')}>🗃 Archive</button>
      <button className="btn subtle" onClick={onClear}>Done</button>
    </div>
  );
}
