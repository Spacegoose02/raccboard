import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, apiUrl } from '../api.js';
import { COLORS } from '../config.js';
import { dueStatus, formatDate, timeAgo } from '../dates.js';
import { ColorPicker, CompleteCircle, Composer, InlineEdit, Menu, Popover } from './ui.jsx';
import { useAuth, userById } from '../auth.js';
import { Avatar } from './Avatar.jsx';

const mdComponents = { a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" /> };
const Markdown = ({ children }) => <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{children}</ReactMarkdown></div>;

export default function CardModal({ cardId, labels, people = [], onChanged, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [pop, setPop] = useState(null); // 'labels' | 'dates' | 'checklist' | 'members'
  const { user: me } = useAuth();
  const fileRef = useRef(null);

  const load = useCallback(() => api.get(`/cards/${cardId}`).then(setDetail).catch((e) => setError(e.message)), [cardId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Run a mutation, then refresh the modal and the board behind it.
  const run = async (fn) => {
    try { await fn(); } catch (e) { alert(e.message); }
    await load();
    onChanged();
  };

  if (error) {
    return (
      <div className="modal-backdrop" onMouseDown={onClose}>
        <div className="modal small" onMouseDown={(e) => e.stopPropagation()}><p className="error">{error}</p><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    );
  }
  if (!detail) return <div className="modal-backdrop"><div className="modal small"><p className="muted">Loading…</p></div></div>;

  const { card, checklists, attachments, comments, activity } = detail;
  const patchCard = (body) => run(() => api.patch(`/cards/${card.id}`, body));
  const cardLabels = labels.filter((l) => card.label_ids.includes(l.id));
  const due = dueStatus(card.due_date, card.completed);
  const canEdit = card.my_role === 'editor' || card.my_role === 'owner';
  const members = card.member_ids.map((id) => people.find((p) => p.id === id) || userById(id)).filter(Boolean);
  const isMember = card.member_ids.includes(me.id);
  const toggleMember = (id) => run(() => (card.member_ids.includes(id) ? api.del(`/cards/${card.id}/members/${id}`) : api.put(`/cards/${card.id}/members/${id}`)));

  const upload = (files) => run(async () => { for (const f of files) await api.upload(`/cards/${card.id}/attachments`, f); });

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (canEdit && e.dataTransfer.files.length) upload([...e.dataTransfer.files]); }}>
        <div className="modal-top">
          <span className="list-pill">{card.list_name}</span>
          <div className="spacer" />
          {canEdit && <Menu items={[
            { label: 'Archive card', onClick: async () => { await patchCard({ archived: true }); onClose(); } },
            { label: 'Delete card', danger: true, onClick: async () => { if (confirm('Delete this card permanently?')) { await api.del(`/cards/${card.id}`); onChanged(); onClose(); } } },
          ]} />}
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {card.archived ? <div className="archived-banner">This card is archived. {canEdit && <button className="btn" onClick={() => patchCard({ archived: false })}>Restore</button>}</div> : null}

        <div className="modal-body">
          <div className="modal-main">
            <div className="modal-title-row">
              {canEdit ? <CompleteCircle done={!!card.completed} onToggle={() => patchCard({ completed: !card.completed })} size={22} />
                : card.completed ? <span className="done-mark big">✓</span> : null}
              <InlineEdit value={card.title} onSave={(title) => patchCard({ title })} className="modal-title" multiline readOnly={!canEdit} />
            </div>

            {canEdit && <div className="action-row">
              {!isMember && <button className="btn" onClick={() => toggleMember(me.id)}>🙋 Join</button>}
              <button className="btn" onClick={() => setPop('members')}>👤 Members</button>
              <button className="btn" onClick={() => setPop('labels')}>🏷 Labels</button>
              <button className="btn" onClick={() => setPop('dates')}>🕑 Dates</button>
              <button className="btn" onClick={() => setPop('checklist')}>☑ Checklist</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>📎 Attachment</button>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
              {pop === 'members' && (
                <Popover title="Members" onClose={() => setPop(null)}>
                  <div className="member-options">
                    {people.map((p) => (
                      <label key={p.id} className="member-option">
                        <input type="checkbox" checked={card.member_ids.includes(p.id)} onChange={() => toggleMember(p.id)} />
                        <Avatar user={p} size={28} />
                        <span className="grow">{p.display_name}{p.id === me.id ? ' (you)' : ''}</span>
                      </label>
                    ))}
                  </div>
                  <p className="muted small">Only people the board is shared with can be added.</p>
                </Popover>
              )}
              {pop === 'labels' && <LabelsPopover card={card} labels={labels} run={run} onClose={() => setPop(null)} />}
              {pop === 'dates' && <DatesPopover card={card} onSave={(b) => { setPop(null); patchCard(b); }} onClose={() => setPop(null)} />}
              {pop === 'checklist' && (
                <Popover title="Add checklist" onClose={() => setPop(null)}>
                  <ChecklistForm onAdd={(title, due_date) => { setPop(null); run(() => api.post(`/cards/${card.id}/checklists`, { title, due_date })); }} />
                </Popover>
              )}
            </div>}

            {(members.length > 0 || cardLabels.length > 0 || card.start_date || card.due_date) && (
              <div className="meta-row">
                {members.length > 0 && (
                  <div className="meta">
                    <h5>Members</h5>
                    <div className="chips">
                      {members.map((m) => <Avatar key={m.id} user={m} size={32} />)}
                      {canEdit && <button className="btn square round" onClick={() => setPop('members')} aria-label="Edit members">+</button>}
                    </div>
                  </div>
                )}
                {cardLabels.length > 0 && (
                  <div className="meta">
                    <h5>Labels</h5>
                    <div className="chips">
                      {cardLabels.map((l) => <span key={l.id} className="label-chip big" style={{ background: l.color }}>{l.name}</span>)}
                      {canEdit && <button className="btn square" onClick={() => setPop('labels')}>+</button>}
                    </div>
                  </div>
                )}
                {(card.start_date || card.due_date) && (
                  <div className="meta">
                    <h5>{card.start_date && card.due_date ? 'Dates' : card.due_date ? 'Due date' : 'Start date'}</h5>
                    <button className={`btn date-btn ${due}`} onClick={() => canEdit && setPop('dates')}>
                      {card.start_date && formatDate(card.start_date, { withTime: false })}
                      {card.start_date && card.due_date && ' – '}
                      {card.due_date && formatDate(card.due_date)}
                      {due === 'overdue' && <span className="tag danger">Overdue</span>}
                      {due === 'soon' && <span className="tag warn">Due soon</span>}
                      {due === 'done' && <span className="tag success">Complete</span>}
                    </button>
                  </div>
                )}
              </div>
            )}

            <Description value={card.description} onSave={(description) => patchCard({ description })} readOnly={!canEdit} />

            {attachments.length > 0 && (
              <section className="section">
                <div className="section-head">
                  <h4>📎 Attachments</h4>
                  {canEdit && <button className="btn" onClick={() => fileRef.current?.click()}>Add</button>}
                </div>
                {attachments.map((a) => (
                  <div key={a.id} className="attachment">
                    <a className="thumb" href={apiUrl(`/attachments/${a.id}?inline=1`)} target="_blank" rel="noreferrer">
                      {a.mime?.startsWith('image/') ? <img src={apiUrl(`/attachments/${a.id}?inline=1`)} alt="" /> : <span>{(a.filename.split('.').pop() || 'file').slice(0, 4).toUpperCase()}</span>}
                    </a>
                    <div className="att-info">
                      <a href={apiUrl(`/attachments/${a.id}`)} className="att-name">{a.filename}</a>
                      <span className="muted">{formatSize(a.size)} · added {timeAgo(a.created_at)}</span>
                    </div>
                    {canEdit && <button className="btn danger subtle" onClick={() => confirm(`Delete ${a.filename}?`) && run(() => api.del(`/attachments/${a.id}`))}>Delete</button>}
                  </div>
                ))}
              </section>
            )}

            {checklists.map((cl) => <Checklist key={cl.id} checklist={cl} run={run} readOnly={!canEdit} />)}
          </div>

          <aside className="modal-side">
            <CommentsAndActivity card={card} comments={comments} activity={activity} run={run} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Description({ value, onSave, readOnly }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [tab, setTab] = useState('write');
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const cancel = () => { setDraft(value); setEditing(false); setTab('write'); };
  if (readOnly) {
    return (
      <section className="section">
        <div className="section-head"><h4>≡ Description</h4></div>
        {value ? <Markdown>{value}</Markdown> : <p className="muted">No description.</p>}
      </section>
    );
  }
  return (
    <section className="section">
      <div className="section-head">
        <h4>≡ Description</h4>
        {!editing && value && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      {!editing ? (
        value ? <div onClick={(e) => { if (e.target.tagName !== 'A' && e.target.tagName !== 'INPUT') setEditing(true); }}><Markdown>{value}</Markdown></div>
          : <button className="placeholder-box" onClick={() => setEditing(true)}>Add a more detailed description… (Markdown supported)</button>
      ) : (
        <div className="md-editor">
          <div className="tabs">
            <button className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>Write</button>
            <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
          </div>
          {tab === 'write' ? (
            <textarea autoFocus rows={8} value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder="Markdown: **bold**, _italic_, - lists, [links](https://…), - [ ] tasks, tables…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { onSave(draft); setEditing(false); }
              }} />
          ) : (
            <div className="md-preview">{draft ? <Markdown>{draft}</Markdown> : <p className="muted">Nothing to preview.</p>}</div>
          )}
          <div className="row">
            <button className="btn primary" onClick={() => { onSave(draft); setEditing(false); setTab('write'); }}>Save</button>
            <button className="btn" onClick={cancel}>Cancel</button>
            <span className="muted hint">Ctrl+Enter to save</span>
          </div>
        </div>
      )}
    </section>
  );
}

function LabelsPopover({ card, labels, run, onClose }) {
  const [editing, setEditing] = useState(null); // label object or {} for new
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [filter, setFilter] = useState('');
  const startEdit = (l) => { setEditing(l); setName(l.name || ''); setColor(l.color || COLORS[0]); };

  if (editing) {
    const save = () => {
      run(() => (editing.id
        ? api.patch(`/labels/${editing.id}`, { name, color })
        : api.post(`/boards/${card.board_id}/labels`, { name, color })));
      setEditing(null);
    };
    return (
      <Popover title={editing.id ? 'Edit label' : 'Create label'} onClose={onClose}>
        <div className="label-preview"><span className="label-chip big" style={{ background: color }}>{name || ' '}</span></div>
        <label className="field">Title<input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></label>
        <label className="field">Color</label>
        <ColorPicker colors={COLORS} value={color} onChange={setColor} />
        <div className="row spread">
          <div className="row">
            <button className="btn primary" onClick={save}>{editing.id ? 'Save' : 'Create'}</button>
            <button className="btn" onClick={() => setEditing(null)}>Back</button>
          </div>
          {editing.id && <button className="btn danger" onClick={() => { if (confirm(`Delete label "${editing.name}" from the whole board?`)) { run(() => api.del(`/labels/${editing.id}`)); setEditing(null); } }}>Delete</button>}
        </div>
      </Popover>
    );
  }

  const shown = labels.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Popover title="Labels" onClose={onClose}>
      <input placeholder="Search labels…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="label-options">
        {shown.map((l) => {
          const on = card.label_ids.includes(l.id);
          return (
            <div key={l.id} className="label-option">
              <input type="checkbox" checked={on} onChange={() => run(() => (on ? api.del(`/cards/${card.id}/labels/${l.id}`) : api.put(`/cards/${card.id}/labels/${l.id}`)))} />
              <span className="label-chip big grow" style={{ background: l.color }}
                onClick={() => run(() => (on ? api.del(`/cards/${card.id}/labels/${l.id}`) : api.put(`/cards/${card.id}/labels/${l.id}`)))}>{l.name}</span>
              <button className="icon-btn" onClick={() => startEdit(l)} aria-label="Edit label">✎</button>
            </div>
          );
        })}
      </div>
      <button className="btn wide" onClick={() => startEdit({})}>Create a new label</button>
    </Popover>
  );
}

function DatesPopover({ card, onSave, onClose }) {
  const [hasStart, setHasStart] = useState(!!card.start_date);
  const [start, setStart] = useState(card.start_date?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [hasDue, setHasDue] = useState(!!card.due_date || !card.start_date);
  const [dueDay, setDueDay] = useState(card.due_date?.slice(0, 10) || '');
  const [dueTime, setDueTime] = useState(card.due_date?.includes('T') ? card.due_date.slice(11, 16) : '');
  const save = () => onSave({
    start_date: hasStart && start ? start : null,
    due_date: hasDue && dueDay ? (dueTime ? `${dueDay}T${dueTime}` : dueDay) : null,
  });
  return (
    <Popover title="Dates" onClose={onClose}>
      <label className="check-field"><input type="checkbox" checked={hasStart} onChange={(e) => setHasStart(e.target.checked)} /> Start date</label>
      <input type="date" value={start} disabled={!hasStart} onChange={(e) => setStart(e.target.value)} />
      <label className="check-field"><input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} /> Due date</label>
      <div className="row">
        <input type="date" value={dueDay} disabled={!hasDue} onChange={(e) => setDueDay(e.target.value)} />
        <input type="time" value={dueTime} disabled={!hasDue} onChange={(e) => setDueTime(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn primary" onClick={save}>Save</button>
        <button className="btn" onClick={() => onSave({ start_date: null, due_date: null })}>Remove</button>
      </div>
    </Popover>
  );
}

function ChecklistForm({ onAdd }) {
  const [title, setTitle] = useState('Checklist');
  const [due, setDue] = useState('');
  const add = () => onAdd(title, due || null);
  return (
    <div className="stack">
      <label className="field">Title
        <input autoFocus value={title} onFocus={(e) => e.target.select()} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      </label>
      <label className="field">Due date (optional)
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <button className="btn primary" onClick={add}>Add</button>
    </div>
  );
}

function Checklist({ checklist, run, readOnly }) {
  // Viewers see due dates as plain badges; only editors open the date pickers.
  const editDate = (id) => !readOnly && setDateFor(id);
  const [hideDone, setHideDone] = useState(false);
  const [dateFor, setDateFor] = useState(null);
  const total = checklist.items.length;
  const done = checklist.items.filter((i) => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const items = hideDone ? checklist.items.filter((i) => !i.done) : checklist.items;
  const listDue = dueStatus(checklist.due_date, total > 0 && done === total);
  return (
    <section className="section checklist">
      <div className="section-head">
        <h4>☑ <InlineEdit value={checklist.title} onSave={(title) => run(() => api.patch(`/checklists/${checklist.id}`, { title }))} readOnly={readOnly} /></h4>
        <div className="row">
          {checklist.due_date
            ? <button className={`badge ${listDue}`} onClick={() => editDate('list')} title="Checklist due date">🕑 Due {formatDate(checklist.due_date)}</button>
            : !readOnly && <button className="icon-btn" onClick={() => editDate('list')} title="Set checklist due date" aria-label="Set checklist due date">🕑</button>}
          {done > 0 && <button className="btn" onClick={() => setHideDone((h) => !h)}>{hideDone ? `Show checked items (${done})` : 'Hide checked items'}</button>}
          {!readOnly && <button className="btn" onClick={() => confirm(`Delete checklist "${checklist.title}"?`) && run(() => api.del(`/checklists/${checklist.id}`))}>Delete</button>}
        </div>
      </div>
      {dateFor === 'list' && (
        <Popover title="Checklist due date" onClose={() => setDateFor(null)} className="checklist-pop">
          <ItemDate value={checklist.due_date} onSave={(v) => { setDateFor(null); run(() => api.patch(`/checklists/${checklist.id}`, { due_date: v })); }} />
        </Popover>
      )}
      <div className="progress">
        <span className="pct">{pct}%</span>
        <div className="bar"><div className={`fill ${pct === 100 ? 'complete' : ''}`} style={{ width: `${pct}%` }} /></div>
      </div>
      <ul className="items">
        {items.map((it) => {
          const st = dueStatus(it.due_date, it.done);
          return (
            <li key={it.id} className={it.done ? 'done' : ''}>
              <input type="checkbox" checked={!!it.done} disabled={readOnly} onChange={() => run(() => api.patch(`/items/${it.id}`, { done: !it.done }))} />
              <InlineEdit value={it.text} onSave={(text) => run(() => api.patch(`/items/${it.id}`, { text }))} className="item-text" readOnly={readOnly} />
              {it.due_date && <button className={`badge ${st}`} onClick={() => editDate(it.id)}>🕑 {formatDate(it.due_date)}</button>}
              {!readOnly && <div className="item-actions">
                {!it.due_date && <button className="icon-btn" title="Set due date" onClick={() => setDateFor(it.id)}>🕑</button>}
                <button className="icon-btn" title="Delete item" onClick={() => run(() => api.del(`/items/${it.id}`))}>🗑</button>
              </div>}
              {dateFor === it.id && (
                <Popover title="Item due date" onClose={() => setDateFor(null)} className="item-pop">
                  <ItemDate value={it.due_date} onSave={(v) => { setDateFor(null); run(() => api.patch(`/items/${it.id}`, { due_date: v })); }} />
                </Popover>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && <Composer openLabel="Add an item" className="btn" placeholder="Add an item" buttonLabel="Add"
        onAdd={(text) => run(() => api.post(`/checklists/${checklist.id}/items`, { text }))} />}
    </section>
  );
}

function ItemDate({ value, onSave }) {
  const [v, setV] = useState(value ? value.slice(0, 10) : '');
  return (
    <div className="stack">
      <input type="date" value={v} autoFocus onChange={(e) => setV(e.target.value)} />
      <div className="row">
        <button className="btn primary" onClick={() => onSave(v || null)}>Save</button>
        {value && <button className="btn" onClick={() => onSave(null)}>Remove</button>}
      </div>
    </div>
  );
}

function CommentsAndActivity({ card, comments, activity, run }) {
  const { user: me } = useAuth();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const submit = () => {
    if (!text.trim()) return;
    const body = text;
    setText('');
    setFocused(false);
    run(() => api.post(`/cards/${card.id}/comments`, { body }));
  };
  const feed = [
    ...comments.map((c) => ({ ...c, kind: 'comment' })),
    ...(showDetails ? activity.map((a) => ({ ...a, kind: 'activity' })) : []),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <div className="section-head">
        <h4>💬 Comments and activity</h4>
        <button className="btn" onClick={() => setShowDetails((s) => !s)}>{showDetails ? 'Hide details' : 'Show details'}</button>
      </div>
      <div className="comment-box">
        <Avatar user={me} />
        <div className="grow">
          <textarea placeholder="Write a comment…" rows={focused || text ? 3 : 1} value={text}
            onFocus={() => setFocused(true)} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
              if (e.key === 'Escape') { e.stopPropagation(); setFocused(false); e.target.blur(); }
            }} />
          {(focused || text) && (
            <div className="row">
              <button className="btn primary" disabled={!text.trim()} onClick={submit}>Save</button>
            </div>
          )}
        </div>
      </div>
      <ul className="feed">
        {feed.map((f) => {
          const who = userById(f.user_id);
          const name = who?.display_name || (f.kind === 'comment' ? f.author : f.actor);
          const canDelete = f.kind === 'comment' && (f.user_id === me?.id || me?.role === 'admin');
          return (
          <li key={f.id} className={f.kind}>
            <Avatar user={who} name={name} />
            <div className="grow">
              {f.kind === 'comment' ? (
                <>
                  <div><b>{name}</b> <span className="muted">{timeAgo(f.created_at)}</span></div>
                  <div className="comment-body"><Markdown>{f.body}</Markdown></div>
                  {canDelete && <button className="link-btn small" onClick={() => confirm('Delete this comment?') && run(() => api.del(`/comments/${f.id}`))}>Delete</button>}
                </>
              ) : (
                <>
                  <div><b>{name}</b> {f.text}</div>
                  <div className="muted small">{timeAgo(f.created_at)}</div>
                </>
              )}
            </div>
          </li>
          );
        })}
      </ul>
    </>
  );
}
