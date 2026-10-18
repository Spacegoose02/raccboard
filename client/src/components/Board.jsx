import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, rectIntersection, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import { APP_NAME } from '../config.js';
import { navigate } from '../router.js';
import { dueStatus, formatDate } from '../dates.js';
import { CompleteCircle, Composer, InlineEdit, Menu, Popover } from './ui.jsx';
import CardModal from './CardModal.jsx';

const LIST = 'list:';
const CARD = 'card:';
const isList = (id) => String(id).startsWith(LIST);
const isCard = (id) => String(id).startsWith(CARD);
const raw = (id) => String(id).slice(5);

export default function Board({ boardId, cardId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [listOrder, setListOrder] = useState([]);
  const [cols, setCols] = useState({});
  const [active, setActive] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const dragRef = useRef(null); // { type, id, fromList, fromIndex, snapshot }

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/boards/${boardId}`);
      if (dragRef.current) return; // don't clobber an in-progress drag
      setData(d);
      setListOrder(d.lists.map((l) => l.id));
      const c = Object.fromEntries(d.lists.map((l) => [l.id, []]));
      for (const card of d.cards) c[card.list_id]?.push(card.id);
      setCols(c);
      document.title = `${d.board.name} · ${APP_NAME}`;
    } catch (e) { setError(e.message); }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  const cardsById = useMemo(() => Object.fromEntries((data?.cards || []).map((c) => [c.id, c])), [data]);
  const listsById = useMemo(() => Object.fromEntries((data?.lists || []).map((l) => [l.id, l])), [data]);
  const labelsById = useMemo(() => Object.fromEntries((data?.labels || []).map((l) => [l.id, l])), [data]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to drag on touch screens so a normal swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findList = (id, c = colsRef.current) => Object.keys(c).find((l) => c[l].includes(id));

  const collision = useCallback((args) => {
    if (dragRef.current?.type === 'list') {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => isList(c.id)) });
    }
    const hits = pointerWithin(args);
    const pool = hits.length ? hits : rectIntersection(args);
    const cardHit = pool.find((h) => isCard(h.id));
    if (cardHit) return [cardHit];
    const listHit = pool.find((h) => isList(h.id));
    if (listHit) {
      const ids = colsRef.current[raw(listHit.id)] || [];
      const inList = args.droppableContainers.filter((c) => isCard(c.id) && ids.includes(raw(c.id)));
      if (inList.length) {
        const r = closestCenter({ ...args, droppableContainers: inList });
        if (r.length) return r;
      }
      return [listHit];
    }
    return [];
  }, []);

  const onDragStart = ({ active: a }) => {
    const type = isList(a.id) ? 'list' : 'card';
    const id = raw(a.id);
    const fromList = type === 'card' ? findList(id) : null;
    dragRef.current = { type, id, fromList, fromIndex: fromList ? colsRef.current[fromList].indexOf(id) : -1, snapshot: colsRef.current };
    setActive({ type, id });
  };

  const onDragOver = ({ active: a, over }) => {
    if (!over || !isCard(a.id)) return;
    const id = raw(a.id);
    const from = findList(id);
    const to = isList(over.id) ? raw(over.id) : findList(raw(over.id));
    if (!from || !to || from === to) return;
    setCols((prev) => {
      const dst = prev[to].filter((x) => x !== id);
      let idx = dst.length;
      if (isCard(over.id)) {
        idx = dst.indexOf(raw(over.id));
        const t = a.rect.current.translated;
        if (t && t.top > over.rect.top + over.rect.height / 2) idx += 1;
        if (idx < 0) idx = dst.length;
      }
      dst.splice(idx, 0, id);
      return { ...prev, [from]: prev[from].filter((x) => x !== id), [to]: dst };
    });
  };

  const onDragEnd = async ({ active: a, over }) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setActive(null);
    if (!drag) return;
    if (drag.type === 'list') {
      if (!over || over.id === a.id || !isList(over.id)) return;
      const next = arrayMove(listOrder, listOrder.indexOf(drag.id), listOrder.indexOf(raw(over.id)));
      setListOrder(next);
      await api.put(`/boards/${boardId}/lists/order`, { ids: next });
      return;
    }
    const c = { ...colsRef.current };
    const list = findList(drag.id, c);
    if (!list) return;
    if (over && isCard(over.id) && over.id !== a.id && c[list].includes(raw(over.id))) {
      c[list] = arrayMove(c[list], c[list].indexOf(drag.id), c[list].indexOf(raw(over.id)));
      setCols(c);
    }
    const index = c[list].indexOf(drag.id);
    if (list === drag.fromList && index === drag.fromIndex) return;
    try {
      await api.post(`/cards/${drag.id}/move`, { list_id: list, index });
      setData((d) => ({ ...d, cards: d.cards.map((x) => (x.id === drag.id ? { ...x, list_id: list } : x)) }));
    } catch (e) {
      alert(`Could not move card: ${e.message}`);
      load();
    }
  };

  const onDragCancel = () => {
    if (dragRef.current?.snapshot) setCols(dragRef.current.snapshot);
    dragRef.current = null;
    setActive(null);
  };

  if (error) return <div className="page"><p className="error">{error}</p><a href="#/">← Back to boards</a></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  const { board } = data;
  const patchCardLocal = (id, patch) => setData((d) => ({ ...d, cards: d.cards.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const toggleCard = async (card) => {
    patchCardLocal(card.id, { completed: card.completed ? 0 : 1 });
    await api.patch(`/cards/${card.id}`, { completed: !card.completed });
  };
  const updateList = async (id, patch) => { await api.patch(`/lists/${id}`, patch); load(); };
  const archiveCards = async (list) => {
    if (!confirm(`Archive all cards in "${list.name}"? You can restore them from Archived items.`)) return;
    await api.post(`/lists/${list.id}/archive-cards`);
    load();
  };
  const addCard = async (listId, title) => { await api.post(`/lists/${listId}/cards`, { title }); load(); };
  const addList = async (name) => { await api.post(`/boards/${boardId}/lists`, { name }); load(); };
  const renameBoard = async (name) => { await api.patch(`/boards/${boardId}`, { name }); load(); };
  const toggleBoardComplete = async () => { await api.patch(`/boards/${boardId}`, { completed: !board.completed_at }); load(); };

  const ctx = { cardsById, labelsById, toggleCard, boardId };

  return (
    <div className="board" style={{ '--board-accent': board.color || 'var(--accent)' }}>
      <div className="board-bar">
        <InlineEdit value={board.name} onSave={renameBoard} className="board-title" />
        {board.completed_at && <span className="badge done">Completed {formatDate(board.completed_at.slice(0, 10))}</span>}
        {board.archived ? <span className="badge">Archived</span> : null}
        <div className="spacer" />
        <a className="btn subtle" href={`#/settings/board/${boardId}`}>⚙ Board settings</a>
        <button className="btn subtle" onClick={() => setShowArchived(true)}>🗃 Archived items</button>
        <button className="btn subtle" onClick={toggleBoardComplete}>{board.completed_at ? '↺ Reopen board' : '✓ Complete board'}</button>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
        <div className={`lists ${active ? 'is-dragging' : ''}`}>
          <SortableContext items={listOrder.map((id) => LIST + id)} strategy={horizontalListSortingStrategy}>
            {listOrder.map((id) => listsById[id] && (
              <ListColumn key={id} list={listsById[id]} cardIds={cols[id] || []} ctx={ctx} onUpdate={updateList} onAddCard={addCard} onArchiveCards={archiveCards} />
            ))}
          </SortableContext>
          <div className="add-list">
            <Composer openLabel="+ Add another list" placeholder="Enter list name…" buttonLabel="Add list" onAdd={addList} />
          </div>
        </div>
        <DragOverlay>
          {active?.type === 'card' && cardsById[active.id] && <CardFace card={cardsById[active.id]} ctx={ctx} overlay />}
          {active?.type === 'list' && listsById[active.id] && (
            <div className="list overlay">
              <div className="list-head"><span className="list-name">{listsById[active.id].name}</span></div>
              <div className="cards">{(cols[active.id] || []).map((cid) => cardsById[cid] && <CardFace key={cid} card={cardsById[cid]} ctx={ctx} overlay />)}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {cardId && (
        <CardModal
          cardId={cardId}
          labels={data.labels}
          onChanged={load}
          onClose={() => navigate(`/b/${boardId}`)}
        />
      )}
      {showArchived && <ArchivedDrawer boardId={boardId} onClose={() => setShowArchived(false)} onChanged={load} />}
    </div>
  );
}

function ListColumn({ list, cardIds, ctx, onUpdate, onAddCard, onArchiveCards }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: LIST + list.id, data: { type: 'list' } });
  const [datePicker, setDatePicker] = useState(false);
  const style = { transform: CSS.Translate.toString(transform), transition };
  const due = dueStatus(list.due_date, false);

  if (list.collapsed) {
    return (
      <div ref={setNodeRef} style={style} className={`list collapsed ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners}
        onClick={() => onUpdate(list.id, { collapsed: false })} title="Expand list">
        <span className="collapsed-count">{cardIds.length}</span>
        <span className="collapsed-name">{list.name}</span>
        {list.due_date && <span className={`collapsed-due ${due}`} title={`Due ${formatDate(list.due_date)}`}>🕑</span>}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`list ${isDragging ? 'dragging' : ''}`}>
      <div className="list-head" {...attributes} {...listeners}>
        <InlineEdit value={list.name} onSave={(name) => onUpdate(list.id, { name })} className="list-name" />
        <span className="list-count">{cardIds.length}</span>
        <button className="icon-btn" title="Collapse list" onPointerDown={(e) => e.stopPropagation()} onClick={() => onUpdate(list.id, { collapsed: true })}>⇤</button>
        <button className="icon-btn" title="Archive list" aria-label="Archive list" onPointerDown={(e) => e.stopPropagation()} onClick={() => onUpdate(list.id, { archived: true })}>🗃</button>
        <Menu items={[
          { label: list.due_date ? 'Change due date' : 'Set due date', onClick: () => setDatePicker(true) },
          { label: 'Collapse list', onClick: () => onUpdate(list.id, { collapsed: true }) },
          { label: 'Archive list', onClick: () => onUpdate(list.id, { archived: true }) },
          cardIds.length > 0 && { label: 'Archive all cards in this list', onClick: () => onArchiveCards(list) },
        ]} />
      </div>
      {list.due_date && (
        <div className="list-due">
          <span className={`badge ${due}`} onClick={() => setDatePicker(true)}>🕑 Due {formatDate(list.due_date)}</span>
        </div>
      )}
      {datePicker && (
        <Popover title="List due date" onClose={() => setDatePicker(false)} className="list-pop">
          <DateForm value={list.due_date} onSave={(v) => { setDatePicker(false); onUpdate(list.id, { due_date: v }); }} />
        </Popover>
      )}
      <div className="cards">
        <SortableContext items={cardIds.map((id) => CARD + id)} strategy={verticalListSortingStrategy}>
          {cardIds.map((id) => ctx.cardsById[id] && <SortableCard key={id} card={ctx.cardsById[id]} ctx={ctx} />)}
        </SortableContext>
      </div>
      <Composer openLabel="+ Add a card" placeholder="Enter a title for this card…" buttonLabel="Add card" multiline onAdd={(t) => onAddCard(list.id, t)} />
    </div>
  );
}

export function DateForm({ value, onSave }) {
  const [v, setV] = useState(value ? value.slice(0, 10) : '');
  return (
    <div className="stack">
      <input type="date" value={v} onChange={(e) => setV(e.target.value)} />
      <div className="row">
        <button className="btn primary" onClick={() => onSave(v || null)}>Save</button>
        {value && <button className="btn" onClick={() => onSave(null)}>Remove</button>}
      </div>
    </div>
  );
}

function SortableCard({ card, ctx }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: CARD + card.id, data: { type: 'card' } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}
      className={isDragging ? 'card-slot dragging' : 'card-slot'}>
      <CardFace card={card} ctx={ctx} />
    </div>
  );
}

function CardFace({ card, ctx, overlay }) {
  const labels = card.label_ids.map((id) => ctx.labelsById[id]).filter(Boolean);
  const due = dueStatus(card.due_date, card.completed);
  const checkDone = card.check_total > 0 && card.check_done === card.check_total;
  return (
    <div className={`card ${card.completed ? 'completed' : ''} ${overlay ? 'overlay' : ''}`}
      onClick={() => !overlay && navigate(`/b/${ctx.boardId}/c/${card.id}`)}>
      {labels.length > 0 && (
        <div className="card-labels">
          {labels.map((l) => <span key={l.id} className="label-chip" style={{ background: l.color }}>{l.name}</span>)}
        </div>
      )}
      <div className="card-title-row">
        <CompleteCircle done={!!card.completed} onToggle={() => ctx.toggleCard(card)} />
        <span className="card-title">{card.title}</span>
      </div>
      <div className="card-badges">
        {(card.start_date || card.due_date) && (
          <span className={`badge ${due}`} title={due === 'overdue' ? 'Overdue' : 'Dates'}>
            🕑 {card.start_date && formatDate(card.start_date, { withTime: false })}
            {card.start_date && card.due_date && ' – '}
            {card.due_date && formatDate(card.due_date)}
          </span>
        )}
        {card.description && <span className="badge plain" title="Has description">≡</span>}
        {card.comment_count > 0 && <span className="badge plain" title="Comments">💬 {card.comment_count}</span>}
        {card.attachment_count > 0 && <span className="badge plain" title="Attachments">📎 {card.attachment_count}</span>}
        {card.check_total > 0 && (
          <span className={`badge ${checkDone ? 'done' : 'plain'}`} title="Checklist items">☑ {card.check_done}/{card.check_total}</span>
        )}
        {card.next_sub_due && !card.completed && (
          <span className={`badge ${dueStatus(card.next_sub_due, false) || 'plain'}`} title="Next checklist due date">☑🕑 {formatDate(card.next_sub_due)}</span>
        )}
      </div>
    </div>
  );
}

function ArchivedDrawer({ boardId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get(`/boards/${boardId}/archived`).then(setData), [boardId]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { await fn(); load(); onChanged(); };
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><h3>Archived items</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
        {!data ? <p className="muted">Loading…</p> : (
          <>
            <h4>Lists</h4>
            {data.lists.length === 0 && <p className="muted">No archived lists.</p>}
            {data.lists.map((l) => (
              <div key={l.id} className="drawer-row">
                <span>{l.name}</span>
                <button className="btn" onClick={() => act(() => api.patch(`/lists/${l.id}`, { archived: false }))}>Restore</button>
                <button className="btn danger" onClick={() => confirm(`Delete list "${l.name}" and its cards?`) && act(() => api.del(`/lists/${l.id}`))}>Delete</button>
              </div>
            ))}
            <h4>Cards</h4>
            {data.cards.length === 0 && <p className="muted">No archived cards.</p>}
            {data.cards.map((c) => (
              <div key={c.id} className="drawer-row">
                <span>{c.title} <span className="muted">in {c.list_name}</span></span>
                <button className="btn" onClick={() => act(() => api.patch(`/cards/${c.id}`, { archived: false }))}>Restore</button>
                <button className="btn danger" onClick={() => confirm(`Delete card "${c.title}"?`) && act(() => api.del(`/cards/${c.id}`))}>Delete</button>
              </div>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
