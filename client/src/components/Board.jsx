import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAiEnabled } from '../ai.js';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, rectIntersection, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, apiUrl, CLIENT_ID } from '../api.js';
import { clearUndo, pushUndo } from '../undo.js';
import { fieldText } from './CustomFields.jsx';
import { APP_NAME } from '../config.js';
import { navigate } from '../router.js';
import { dueStatus, formatDate, parseDate } from '../dates.js';
import { CardCover, CompleteCircle, Composer, InlineEdit, Menu, Popover, backgroundStyle } from './ui.jsx';
import { BackgroundPicker } from './BackgroundPicker.jsx';
import { Avatar } from './Avatar.jsx';
import { ShareDialog } from './Share.jsx';
import { PRIORITIES, PriorityBadge, formatMinutes } from './Planning.jsx';
import { BoardExtrasDrawer, BulkBar, SavedViews, SprintsDrawer } from './BoardTools.jsx';
const ReportView = lazy(() => import('./ReportView.jsx'));
const CardModal = lazy(() => import('./CardModal.jsx'));
const ListView = lazy(() => import('./ListView.jsx'));
const CalendarView = lazy(() => import('./CalendarView.jsx'));
const TimelineView = lazy(() => import('./TimelineView.jsx'));
const BoardSummary = lazy(() => import('./BoardSummary.jsx'));
const Automations = lazy(() => import('./Automations.jsx'));

const VIEWS = [
  { id: 'board', label: '▥ Board' },
  { id: 'list', label: '☰ List' },
  { id: 'calendar', label: '📅 Calendar' },
  { id: 'timeline', label: '▤ Timeline' },
  { id: 'report', label: '📊 Reports' },
];
const viewKey = (boardId) => `rackboard.view.${boardId}`;
const savedView = (boardId) => { try { return localStorage.getItem(viewKey(boardId)) || 'board'; } catch { return 'board'; } };
import { useAuth } from '../auth.js';

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
  const [showShare, setShowShare] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const aiOn = useAiEnabled();
  const [showRules, setShowRules] = useState(false);
  const [showSprints, setShowSprints] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  // Bulk selection and swimlanes.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [lanes, setLanesState] = useState(() => { try { return localStorage.getItem(`rackboard.lanes.${boardId}`) || ''; } catch { return ''; } });
  const setLanes = (v) => { setLanesState(v); try { localStorage.setItem(`rackboard.lanes.${boardId}`, v); } catch { /* storage blocked */ } };
  const [reportKey, setReportKey] = useState(0);
  // Phone list pager: which list is in view, and jumping to one.
  const listsRef = useRef(null);
  const [pagerIndex, setPagerIndex] = useState(0);
  const onListsScroll = () => {
    const el = listsRef.current;
    if (!el) return;
    const cols = [...el.querySelectorAll(':scope > .list')];
    const left = el.getBoundingClientRect().left;
    let best = 0;
    cols.forEach((c, i) => { if (Math.abs(c.getBoundingClientRect().left - left) < Math.abs(cols[best].getBoundingClientRect().left - left)) best = i; });
    setPagerIndex(best);
  };
  const jumpToList = (id, i) => {
    setPagerIndex(i);
    listsRef.current?.querySelector(`[data-list-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };
  const [view, setViewState] = useState(() => savedView(boardId));
  const setView = (v) => { setViewState(v); try { localStorage.setItem(viewKey(boardId), v); } catch { /* storage blocked */ } };
  // Card filter: search text, labels, due window, selected member ids and "only my cards".
  const [filter, setFilter] = useState(NO_FILTER);
  const searchRef = useRef(null);
  const [showKeys, setShowKeys] = useState(false);
  const [showBg, setShowBg] = useState(false);
  const { user: me } = useAuth();
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const dragRef = useRef(null); // { type, id, fromList, fromIndex, snapshot }

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/boards/${boardId}`);
      if (dragRef.current) return; // don't clobber an in-progress drag
      sprintStatusMap = Object.fromEntries((d.sprints || []).map((sp) => [sp.id, sp.status]));
      setData(d);
      setListOrder(d.lists.map((l) => l.id));
      const c = Object.fromEntries(d.lists.map((l) => [l.id, []]));
      for (const card of d.cards) c[card.list_id]?.push(card.id);
      setCols(c);
      setReportKey((k) => k + 1);
      document.title = `${d.board.name} · ${APP_NAME}`;
    } catch (e) {
      // A failed background refresh (flaky Wi-Fi, server restart) keeps the board on screen.
      setData((d) => { if (!d) setError(e.message); return d; });
    }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);
  // Ctrl+Z only undoes things done on this board.
  useEffect(() => { clearUndo(); }, [boardId]);
  // Warm the lazy chunks once the board is up, so the service worker has them for offline use.
  useEffect(() => {
    const warm = () => { import('./CardModal.jsx'); };
    const id = 'requestIdleCallback' in window ? window.requestIdleCallback(warm) : setTimeout(warm, 1500);
    return () => ('cancelIdleCallback' in window ? window.cancelIdleCallback(id) : clearTimeout(id));
  }, []);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    // Live updates arrive over the event stream; the slow poll is a fallback for proxies that block it.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 120000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('rb:synced', load);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('rb:synced', load); };
  }, [load]);
  const [viewers, setViewers] = useState([]);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const es = new EventSource(apiUrl(`/boards/${boardId}/events?client=${CLIENT_ID}`));
    let pending;
    es.addEventListener('change', () => { clearTimeout(pending); pending = setTimeout(load, 250); });
    es.addEventListener('presence', (e) => setViewers(JSON.parse(e.data)));
    return () => { clearTimeout(pending); es.close(); };
  }, [boardId, load]);

  const cardsById = useMemo(() => Object.fromEntries((data?.cards || []).map((c) => [c.id, c])), [data]);
  const listsById = useMemo(() => Object.fromEntries((data?.lists || []).map((l) => [l.id, l])), [data]);
  const labelsById = useMemo(() => Object.fromEntries((data?.labels || []).map((l) => [l.id, l])), [data]);
  const peopleById = useMemo(() => Object.fromEntries((data?.people || []).map((p) => [p.id, p])), [data]);
  const keepEvent = useCallback((e) => {
    if (!isFiltering(filter)) return true;
    const card = e.card_id && cardsById[e.card_id];
    return !!card && cardMatches(card, filter, me?.id);
  }, [filter, cardsById, me?.id]);

  // Keyboard shortcuts (ignored while typing or when a card is open).
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable) {
        if (e.key === 'Escape' && e.target === searchRef.current) { setFilter((f) => ({ ...f, text: '' })); e.target.blur(); }
        return;
      }
      if (cardId) return;
      const actions = {
        '/': () => searchRef.current?.focus(),
        f: () => searchRef.current?.focus(),
        q: () => setFilter((f) => ({ ...f, mine: !f.mine })),
        x: () => setFilter(NO_FILTER),
        b: () => setView('board'),
        l: () => setView('list'),
        c: () => setView('calendar'),
        t: () => setView('timeline'),
        r: () => setView('report'),
        s: () => { setSelecting((v) => !v); setSelected([]); },
        n: () => document.querySelector('.list .composer-open')?.click(),
        '?': () => setShowKeys((s) => !s),
        Escape: () => { setShowKeys(false); setFilter(NO_FILTER); setSelecting(false); setSelected([]); },
      };
      const act = actions[e.key];
      if (act) { e.preventDefault(); act(); }
    };
    const COMMANDS = {
      'new-card': 'n', 'view-board': 'b', 'view-list': 'l', 'view-calendar': 'c', 'view-timeline': 't', 'filter-mine': 'q', 'filter-clear': 'x',
    };
    const onCommand = (e) => { const key = COMMANDS[e.detail]; if (key) onKey({ key, target: document.body, preventDefault() {} }); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('rb:command', onCommand);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('rb:command', onCommand); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

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
    navigator.vibrate?.(12); // a small buzz on phones when a long-press picks something up
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
      try { await api.put(`/boards/${boardId}/lists/order`, { ids: next }); } catch (e) { alert(`Could not move list: ${e.message}`); load(); }
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
      const { fromList, fromIndex } = drag;
      const title = cardsById[drag.id]?.title || 'card';
      pushUndo({
        label: `Moved "${title}"`,
        undo: () => api.post(`/cards/${drag.id}/move`, { list_id: fromList, index: fromIndex }).then(load),
        redo: () => api.post(`/cards/${drag.id}/move`, { list_id: list, index }).then(load),
      });
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
    try {
      const res = await api.patch(`/cards/${card.id}`, { completed: !card.completed });
      let next = res?.next_card_id;
      if (next) load(); // a repeating card made its next copy
      pushUndo({
        label: `${card.completed ? 'Reopened' : 'Completed'} "${card.title}"${next ? ' (next repeat added)' : ''}`,
        // Undoing a repeat completion also removes the copy it made and restores the repeat.
        undo: async () => {
          if (next) { await api.del(`/cards/${next}`); next = null; }
          await api.patch(`/cards/${card.id}`, { completed: !!card.completed, ...(card.recurrence ? { recurrence: card.recurrence } : {}) });
          load();
        },
        redo: async () => { next = (await api.patch(`/cards/${card.id}`, { completed: !card.completed }))?.next_card_id; load(); },
      });
    } catch (e) { patchCardLocal(card.id, { completed: card.completed }); alert(e.message); }
  };
  // Run an edit; on failure say so and reload, instead of failing silently.
  const attempt = async (fn) => {
    try { await fn(); } catch (e) { alert(e.message); }
    load();
  };
  const updateList = (id, patch) => attempt(() => api.patch(`/lists/${id}`, patch));
  const archiveCards = async (list) => {
    if (!confirm(`Archive all cards in "${list.name}"? You can restore them from Archived items.`)) return;
    await attempt(() => api.post(`/lists/${list.id}/archive-cards`));
  };
  // Adds throw on failure so the composer keeps what was typed.
  const addCard = async (listId, title, description) => { await api.post(`/lists/${listId}/cards`, { title, description }); load(); };
  // Simple layout: a box is just its text and pictures, edited in place.
  const addBox = async (listId, title) => { await api.post(`/lists/${listId}/cards`, { title }); load(); };
  const setBoxText = (card, title) => attempt(() => api.patch(`/cards/${card.id}`, { title }));
  const addPictures = (card, files) => attempt(async () => {
    for (const f of files) if (f.type.startsWith('image/')) await api.upload(`/cards/${card.id}/attachments`, f);
  });
  const removePictures = (card) => attempt(async () => { for (const id of card.image_ids) await api.del(`/attachments/${id}`); });
  const addList = async (name) => { await api.post(`/boards/${boardId}/lists`, { name }); load(); };
  const renameBoard = (name) => attempt(() => api.patch(`/boards/${boardId}`, { name }));
  const toggleLayout = () => attempt(() => api.patch(`/boards/${boardId}`, { layout: board.layout === 'simple' ? null : 'simple' }));
  const archiveCard = async (card) => {
    try { await api.patch(`/cards/${card.id}`, { archived: true }); } catch (e) { alert(e.message); load(); return; }
    load();
    pushUndo({
      label: `Archived "${card.title}"`,
      undo: () => api.patch(`/cards/${card.id}`, { archived: false }).then(load),
      redo: () => api.patch(`/cards/${card.id}`, { archived: true }).then(load),
    });
  };
  const toggleBoardComplete = () => attempt(() => api.patch(`/boards/${boardId}`, { completed: !board.completed_at }));

  const role = board.my_role;
  const canEdit = role === 'editor' || role === 'owner';
  const isOwner = role === 'owner';
  const filtering = isFiltering(filter);
  const shows = (card) => cardMatches(card, filter, me.id);
  const toggleIn = (key, id) => setFilter((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));
  const toggleMemberFilter = (id) => toggleIn('members', id);
  const templates = data.cards.filter((c) => c.is_template);
  const addFromTemplate = async (listId, tpl) => {
    try { await api.post(`/cards/${tpl.id}/copy`, { list_id: listId }); } catch (e) { alert(e.message); }
    load();
  };
  // Dragging is off for viewers, and while filtering (hidden cards would make positions ambiguous).
  const toggleSelect = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const sprintsById = Object.fromEntries((data.sprints || []).map((sp) => [sp.id, sp]));
  const ctx = { addBox, setBoxText, addPictures, removePictures, fields: data.fields || [], cardsById, labelsById, peopleById, toggleCard, boardId, canEdit, canDrag: canEdit && !filtering && !selecting, templates, addFromTemplate,
    simple: board.layout === 'simple', archiveCard, selecting, selected, toggleSelect, agingDays: board.aging_days || 0, sprintsById };

  return (
    <div className={`board ${ctx.simple ? 'simple-layout' : ''} ${board.background ? 'has-bg' : ''}`} style={{ '--board-accent': board.color || 'var(--accent)', ...backgroundStyle(board) }}>
      <div className="board-bar">
        <InlineEdit value={board.name} onSave={renameBoard} className="board-title" readOnly={!isOwner} />
        <div className="view-switch" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>{v.label}</button>
          ))}
        </div>
        {role !== 'owner' && <span className="badge plain role-badge" title="Your access to this board">{role === 'viewer' ? '👁 View only' : '✎ Editor'}</span>}
        {board.completed_at && <span className="badge done">Completed {formatDate(board.completed_at.slice(0, 10))}</span>}
        {board.archived ? <span className="badge">Archived</span> : null}
        <div className="spacer" />
        <div className="board-people" title="People on this board">
          {data.people.slice(0, 6).map((p) => {
            const here = p.id !== me?.id && viewers.some((v) => v.id === p.id);
            return <span key={p.id} className={here ? 'viewing' : undefined} title={here ? `${p.display_name} is viewing` : p.display_name}><Avatar user={p} size={26} /></span>;
          })}
          {data.people.length > 6 && <span className="more-people">+{data.people.length - 6}</span>}
        </div>
        {aiOn && <button className="btn subtle wide-only" onClick={() => setShowSummary(true)} title="AI summary of this board">✨ Summary</button>}
        <button className="btn subtle" onClick={() => setShowShare(true)}>👪 {isOwner ? 'Share' : 'Members'}</button>
        {isOwner && <button className="btn subtle wide-only" onClick={() => setShowBg(true)}>🖼 Background</button>}
        {isOwner && <a className="btn subtle wide-only" href={`#/settings/board/${boardId}`}>⚙ Board settings</a>}
        {canEdit && <button className="btn subtle wide-only" onClick={() => setShowRules(true)} title="Automation rules">⚡ Automation</button>}
        <button className="btn subtle wide-only" onClick={() => setShowSprints(true)} title="Sprints">🏃 Sprints</button>
        {isOwner && <button className="btn subtle wide-only" onClick={() => setShowExtras(true)} title="Public link, email to board and card aging">🔗 Link &amp; email</button>}
        {canEdit && <button className="btn subtle wide-only" onClick={() => setShowArchived(true)}>🗃 Archived items</button>}
        {isOwner && <button className="btn subtle wide-only" onClick={toggleLayout} title="Switch how cards look on this board">{board.layout === 'simple' ? '▤ Card view' : '☐ Box view'}</button>}
        {isOwner && <button className="btn subtle wide-only" onClick={toggleBoardComplete}>{board.completed_at ? '↺ Reopen board' : '✓ Complete board'}</button>}
        {canEdit && (
          <Menu className="narrow-only" items={[
            isOwner && { label: '🖼 Background', onClick: () => setShowBg(true) },
            isOwner && { label: '⚙ Board settings', onClick: () => navigate(`/settings/board/${boardId}`) },
            { label: '⚡ Automation', onClick: () => setShowRules(true) },
            { label: '🏃 Sprints', onClick: () => setShowSprints(true) },
            isOwner && { label: '🔗 Link & email', onClick: () => setShowExtras(true) },
            { label: selecting ? '☑ Stop selecting' : '☑ Select cards', onClick: () => { setSelecting(!selecting); setSelected([]); } },
            { label: '🗃 Archived items', onClick: () => setShowArchived(true) },
            isOwner && { label: board.layout === 'simple' ? '▤ Card view' : '☐ Box view', onClick: toggleLayout },
            isOwner && { label: board.completed_at ? '↺ Reopen board' : '✓ Complete board', onClick: toggleBoardComplete },
          ]} />
        )}
      </div>
      <div className="filter-bar">
        <input ref={searchRef} className="board-search" type="search" placeholder="Search…" title="Search cards ( / )" value={filter.text}
          onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))} aria-label="Search cards" />
        <select className="due-filter" value={filter.due} onChange={(e) => setFilter((f) => ({ ...f, due: e.target.value }))} aria-label="Filter by due date">
          <option value="">Any date</option>
          <option value="overdue">Overdue</option>
          <option value="day">Due in 24h</option>
          <option value="week">Due this week</option>
          <option value="none">No due date</option>
          <option value="incomplete">Not complete</option>
        </select>
        {data.labels.filter((l) => l.name || l.color).map((l) => (
          <button key={l.id} className={`chip label-filter ${filter.labels.includes(l.id) ? 'on' : ''}`} style={{ '--label': l.color }} onClick={() => toggleIn('labels', l.id)} title={`Label: ${l.name}`}>
            <span className="label-dot" />{l.name || ' '}
          </button>
        ))}
        {data.people.length > 1 && <>
          <button className={`chip ${filter.mine ? 'on' : ''}`} onClick={() => setFilter((f) => ({ ...f, mine: !f.mine }))}>My cards</button>
          {data.people.map((p) => (
            <button key={p.id} className={`chip person ${filter.members.includes(p.id) ? 'on' : ''}`} onClick={() => toggleMemberFilter(p.id)} title={p.display_name}>
              <Avatar user={p} size={20} /><span className="hide-sm">{p.display_name.split(' ')[0]}</span>
            </button>
          ))}
        </>}
        <select className="due-filter" value={filter.priority[0] ?? ''} onChange={(e) => setFilter((f) => ({ ...f, priority: e.target.value === '' ? [] : [Number(e.target.value)] }))} aria-label="Filter by priority">
          <option value="">Any priority</option>
          {[...PRIORITIES].reverse().map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
        {(data.sprints || []).length > 0 && (
          <select className="due-filter" value={filter.sprint} onChange={(e) => setFilter((f) => ({ ...f, sprint: e.target.value }))} aria-label="Filter by sprint">
            <option value="">Any sprint</option>
            <option value="active">Active sprint</option>
            <option value="none">Backlog (no sprint)</option>
            {data.sprints.filter((sp) => sp.status !== 'closed').map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
        )}
        <SavedViews boardId={boardId} filter={filter} setFilter={setFilter} isFiltering={filtering} canEdit={canEdit} empty={NO_FILTER} />
        {view === 'board' && !ctx.simple && (
          <select className="due-filter" value={lanes} onChange={(e) => setLanes(e.target.value)} aria-label="Swimlanes" title="Group the board into rows">
            <option value="">No swimlanes</option>
            <option value="member">Lanes: member</option>
            <option value="label">Lanes: label</option>
            <option value="priority">Lanes: priority</option>
            <option value="sprint">Lanes: sprint</option>
            <option value="parent">Lanes: parent card</option>
          </select>
        )}
        {canEdit && <button className={`chip wide-only ${selecting ? 'on' : ''}`} title="Select several cards (s)" onClick={() => { setSelecting(!selecting); setSelected([]); }}>☑ Select</button>}
        {filtering && <button className="link-btn small" onClick={() => setFilter(NO_FILTER)}>Clear ({data.cards.filter(shows).length} shown)</button>}
        <button className="icon-btn wide-only" title="Keyboard shortcuts (?)" onClick={() => setShowKeys(true)}>⌨</button>
      </div>
      {showBg && <BackgroundPicker board={board} onClose={() => setShowBg(false)} onChange={() => load()} />}
      {showKeys && (
        <Popover title="Keyboard shortcuts" onClose={() => setShowKeys(false)} className="keys-pop">
          <dl className="shortcuts">
            {SHORTCUTS.map(([k, what]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>)}
          </dl>
        </Popover>
      )}

      <Suspense fallback={<p className="muted loading-view">Loading…</p>}>
        {view === 'list' && <ListView data={data} cards={data.cards.filter(shows)} ctx={ctx} />}
        {view === 'timeline' && <TimelineView data={data} cards={data.cards.filter(shows)} ctx={ctx} />}
        {view === 'report' && <ReportView boardId={boardId} refreshKey={reportKey} />}
        {view === 'board' && lanes && !ctx.simple && <Swimlanes by={lanes} data={data} listOrder={listOrder} cols={cols} shows={shows} ctx={ctx} />}
        {view === 'calendar' && <CalendarView boardId={boardId} keep={keepEvent} canEdit={canEdit} onChanged={load} />}
      </Suspense>
      {view === 'board' && !(lanes && !ctx.simple) && <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
        <div className={`lists ${active ? 'is-dragging' : ''}`} ref={listsRef} onScroll={onListsScroll}>
          <SortableContext items={listOrder.map((id) => LIST + id)} strategy={horizontalListSortingStrategy}>
            {listOrder.map((id) => listsById[id] && (
              <ListColumn key={id} list={listsById[id]} cardIds={(cols[id] || []).filter((cid) => cardsById[cid] && shows(cardsById[cid]))} ctx={ctx} onUpdate={updateList} onAddCard={addCard} onArchiveCards={archiveCards} />
            ))}
          </SortableContext>
          {canEdit && (
            <div className="add-list">
              {ctx.simple
                ? <Composer className="simple-add-list" openLabel={data.lists.length ? '+' : '+ Add a section'} placeholder="Section name…" buttonLabel="Add section" onAdd={addList} />
                : <Composer openLabel="+ Add another list" placeholder="Enter list name…" buttonLabel="Add list" onAdd={addList} />}
            </div>
          )}
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
      </DndContext>}

      {selecting && selected.length > 0 && (
        <BulkBar boardId={boardId} selected={selected} data={data} onClear={() => { setSelecting(false); setSelected([]); }}
          onDone={(archived) => { if (archived) setSelected([]); load(); }} />
      )}
      {showSprints && <SprintsDrawer boardId={boardId} sprints={data.sprints || []} cards={data.cards} canEdit={canEdit} onClose={() => setShowSprints(false)} onChanged={load} />}
      {showExtras && <BoardExtrasDrawer board={board} lists={data.lists} onClose={() => setShowExtras(false)} onChanged={load} />}
      {view === 'board' && !lanes && listOrder.length > 1 && (
        <nav className="list-pager" aria-label="Jump to list">
          {listOrder.map((id, i) => listsById[id] && (
            <button key={id} className={i === pagerIndex ? 'on' : ''} onClick={() => jumpToList(id, i)}>
              {listsById[id].name}<span className="pager-count">{(cols[id] || []).length}</span>
            </button>
          ))}
        </nav>
      )}
      {cardId && (
        <Suspense fallback={null}>
        <CardModal
          cardId={cardId}
          labels={data.labels}
          people={data.people}
          lists={data.lists}
          boardCards={data.cards}
          sprints={data.sprints || []}
          onChanged={load}
          onClose={() => navigate(`/b/${boardId}`)}
        />
        </Suspense>
      )}
      {showSummary && <Suspense fallback={null}><BoardSummary boardId={boardId} onClose={() => setShowSummary(false)} /></Suspense>}
      {showShare && <ShareDialog boardId={boardId} onClose={() => setShowShare(false)} onChanged={load} />}
      {showRules && (
        <div className="drawer-backdrop" onClick={() => { setShowRules(false); load(); }}>
          <aside className="drawer wide-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head"><h3>⚡ Automation</h3><button className="icon-btn" onClick={() => { setShowRules(false); load(); }}>✕</button></div>
            <Suspense fallback={<p className="muted">Loading…</p>}><Automations boardId={boardId} lists={data.lists} labels={data.labels} canEdit={canEdit} /></Suspense>
          </aside>
        </div>
      )}
      {showArchived && <ArchivedDrawer boardId={boardId} onClose={() => setShowArchived(false)} onChanged={load} />}
    </div>
  );
}

const NO_FILTER = { members: [], mine: false, text: '', labels: [], due: '', priority: [], sprint: '' };
const isFiltering = (f) => f.mine || f.members.length > 0 || f.labels.length > 0 || !!f.due || !!f.text.trim() || (f.priority || []).length > 0 || !!f.sprint;
// Sprint status lookup for the 'active sprint' filter, set when the board loads.
let sprintStatusMap = {};
const sprintStatus = (id) => sprintStatusMap[id];
function cardMatches(card, f, meId) {
  if (f.mine && !card.member_ids.includes(meId)) return false;
  if (f.members.length && !f.members.some((id) => card.member_ids.includes(id))) return false;
  if (f.labels.length && !f.labels.some((id) => card.label_ids.includes(id))) return false;
  if (f.priority?.length && !f.priority.includes(card.priority || 0)) return false;
  if (f.sprint) {
    if (f.sprint === 'none' ? card.sprint_id : f.sprint === 'active' ? !(card.sprint_id && sprintStatus(card.sprint_id) === 'active') : card.sprint_id !== f.sprint) return false;
  }
  const q = f.text.trim().toLowerCase();
  if (q && !`${card.title}\n${card.description}`.toLowerCase().includes(q)) return false;
  if (f.due) {
    const d = parseDate(card.due_date);
    const left = d ? d.getTime() - Date.now() : null;
    if (f.due === 'none' && d) return false;
    if (f.due === 'incomplete' && card.completed) return false;
    if (f.due === 'overdue' && !(d && left < 0 && !card.completed)) return false;
    if (f.due === 'day' && !(d && left >= 0 && left < 864e5)) return false;
    if (f.due === 'week' && !(d && left >= 0 && left < 7 * 864e5)) return false;
  }
  return true;
}
const SHORTCUTS = [
  ['/', 'Search cards'], ['n', 'Add a card to the first list'], ['q', 'Toggle "My cards"'], ['x', 'Clear filters'],
  ['b', 'Board view'], ['l', 'List view'], ['c', 'Calendar view'], ['t', 'Timeline view'], ['r', 'Reports'], ['s', 'Select cards for bulk edit'], ['Esc', 'Close card / clear filters'], ['Ctrl K', 'Search and commands'], ['Ctrl Z', 'Undo'], ['Ctrl Shift Z', 'Redo'], ['?', 'Show these shortcuts'],
];

function ListColumn({ list, cardIds, ctx, onUpdate, onAddCard, onArchiveCards }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: LIST + list.id, data: { type: 'list' }, disabled: !ctx.canDrag });
  const [datePicker, setDatePicker] = useState(false);
  const [localCollapsed, setLocalCollapsed] = useState(false);
  // Viewers can still fold lists; it is just not saved for everyone.
  const collapse = (v) => (ctx.canEdit ? onUpdate(list.id, { collapsed: v }) : setLocalCollapsed(v));
  const collapsed = ctx.canEdit ? list.collapsed : localCollapsed;
  const style = { transform: CSS.Translate.toString(transform), transition };
  const due = dueStatus(list.due_date, false);

  if (collapsed) {
    return (
      <div ref={setNodeRef} style={style} data-list-id={list.id} className={`list collapsed ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners}
        onClick={() => collapse(false)} title="Expand list">
        <span className="collapsed-count">{cardIds.length}</span>
        <span className="collapsed-name">{list.name}</span>
        {list.due_date && <span className={`collapsed-due ${due}`} title={`Due ${formatDate(list.due_date)}`}>🕑</span>}
      </div>
    );
  }

  if (ctx.simple) return <SimpleListColumn {...{ list, cardIds, ctx, onUpdate, onAddCard, onArchiveCards, collapse, setNodeRef, style, attributes, listeners, isDragging }} />;

  return (
    <div ref={setNodeRef} style={style} className={`list ${isDragging ? 'dragging' : ''}`} data-list-id={list.id}>
      <div className="list-head" {...attributes} {...listeners}>
        <InlineEdit value={list.name} onSave={(name) => onUpdate(list.id, { name })} className="list-name" readOnly={!ctx.canEdit} />
        <span
          className={`list-count${list.wip_limit && cardIds.length > list.wip_limit ? ' over-wip' : ''}`}
          title={ctx.canEdit ? 'Click to set a WIP limit' : list.wip_limit ? `WIP limit ${list.wip_limit}` : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (!ctx.canEdit) return;
            const v = window.prompt('WIP limit for this list (blank for none)', list.wip_limit || '');
            if (v === null) return;
            const n = Number(v.trim());
            if (v.trim() && !(Number.isInteger(n) && n > 0 && n <= 999)) { alert('Enter a whole number from 1 to 999, or leave it blank for no limit.'); return; }
            onUpdate(list.id, { wip_limit: v.trim() ? n : null });
          }}
        >{list.wip_limit ? `${cardIds.length}/${list.wip_limit}` : cardIds.length}</span>
        <button className="icon-btn" title="Collapse list" onPointerDown={(e) => e.stopPropagation()} onClick={() => collapse(true)}>⇤</button>
        {ctx.canEdit && <>
        <button className="icon-btn" title="Archive list" aria-label="Archive list" onPointerDown={(e) => e.stopPropagation()} onClick={() => onUpdate(list.id, { archived: true })}>🗃</button>
        <Menu items={[
          { label: list.due_date ? 'Change due date' : 'Set due date', onClick: () => setDatePicker(true) },
          { label: 'Collapse list', onClick: () => onUpdate(list.id, { collapsed: true }) },
          { label: 'Archive list', onClick: () => onUpdate(list.id, { archived: true }) },
          cardIds.length > 0 && { label: 'Archive all cards in this list', onClick: () => onArchiveCards(list) },
          ...ctx.templates.map((t) => ({ label: `+ New card from "${t.title}"`, onClick: () => ctx.addFromTemplate(list.id, t) })),
        ]} />
        </>}
      </div>
      {list.due_date && (
        <div className="list-due">
          <span className={`badge ${due}`} onClick={() => ctx.canEdit && setDatePicker(true)}>🕑 Due {formatDate(list.due_date)}</span>
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
      {ctx.canEdit && <Composer openLabel="+ Add a card" placeholder="Enter a title for this card…" buttonLabel="Add card" multiline onAdd={(t) => onAddCard(list.id, t)} />}
    </div>
  );
}

// Simple layout: chevron, drag handle, title, count and menu; "+Add a card" opens a new box ready to type in.
function SimpleListColumn({ list, cardIds, ctx, onUpdate, onAddCard, onArchiveCards, collapse, setNodeRef, style, attributes, listeners, isDragging }) {
  const [adding, setAdding] = useState(false);
  return (
    <div ref={setNodeRef} style={style} className={`list simple ${isDragging ? 'dragging' : ''}`} data-list-id={list.id}>
      <div className="list-head">
        <span className="drag-handle" title="Drag list" {...attributes} {...listeners}>⠿</span>
        <button className="icon-btn chevron" title="Collapse list" aria-label="Collapse list" onClick={() => collapse(true)}>⌄</button>
        <InlineEdit value={list.name} onSave={(name) => onUpdate(list.id, { name })} className="list-name" readOnly={!ctx.canEdit} />
        <span className="list-count">{cardIds.length}</span>
        {ctx.canEdit && <Menu label="⋮" items={[
          { label: 'Archive list', onClick: () => onUpdate(list.id, { archived: true }) },
          cardIds.length > 0 && { label: 'Archive all cards in this list', onClick: () => onArchiveCards(list) },
        ]} />}
      </div>
      <div className="cards">
        <SortableContext items={cardIds.map((id) => CARD + id)} strategy={verticalListSortingStrategy}>
          {cardIds.map((id) => ctx.cardsById[id] && <SortableCard key={id} card={ctx.cardsById[id]} ctx={ctx} />)}
        </SortableContext>
      </div>
      {ctx.canEdit && (
        <div className="simple-add">
          {adding
            ? <BoxEditor initial="" onSave={async (t) => { if (t) { try { await ctx.addBox(list.id, t); } catch (e) { alert(e.message); return false; } } setAdding(false); }}
                onCancel={() => setAdding(false)} />
            : <button className="btn simple-add-btn" onClick={() => setAdding(true)}>+Add a card</button>}
        </div>
      )}
    </div>
  );
}

// Multi-line text box: Enter saves, Shift+Enter adds a line, Escape cancels, clicking away saves.
function BoxEditor({ initial, onSave, onCancel, onPastePictures }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const ta = useRef(null);
  // Grow with the text so nothing hides behind a scrollbar.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);
  const save = async () => {
    if (done.current) return;
    done.current = true;
    if ((await onSave(text.trim())) === false) done.current = false;
  };
  return (
    <textarea ref={ta} className="box-editor" autoFocus value={text} placeholder="Type here…" rows={2}
      // Drag sensors listen for mouse/touch/key events, so stop those too or selecting text drags the card.
      onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
      onChange={(e) => setText(e.target.value)} onBlur={save}
      onPaste={(e) => {
        const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
        if (files.length && onPastePictures) { e.preventDefault(); onPastePictures(files); }
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
        if (e.key === 'Escape') { done.current = true; onCancel(); }
      }} />
  );
}

// A plain box: checkbox, text you edit in place, and pictures you drop or paste onto it.
function SimpleBox({ card, ctx, overlay }) {
  const [editing, setEditing] = useState(false);
  const [dropping, setDropping] = useState(false);
  const canDrop = ctx.canEdit && !overlay;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  return (
    <div className={`simple-box ${card.completed ? 'completed' : ''} ${overlay ? 'overlay' : ''} ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => { if (canDrop && hasFiles(e)) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!canDrop || !hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        ctx.addPictures(card, [...e.dataTransfer.files]);
      }}>
      <input type="checkbox" checked={!!card.completed} disabled={!ctx.canEdit} aria-label={card.completed ? 'Mark incomplete' : 'Mark complete'}
        onPointerDown={(e) => e.stopPropagation()} onChange={() => ctx.toggleCard(card)} />
      <div className="box-body">
        {editing
          ? <BoxEditor initial={card.title} onCancel={() => setEditing(false)} onPastePictures={(files) => ctx.addPictures(card, files)}
              onSave={async (t) => { setEditing(false); if (t && t !== card.title) await ctx.setBoxText(card, t); }} />
          : <div className="box-text" onClick={() => ctx.canEdit && !overlay && setEditing(true)}>{card.title}</div>}
        {card.image_ids?.length > 0 && (
          <div className="box-pictures">
            {card.image_ids.map((id) => (
              <a key={id} href={apiUrl(`/attachments/${id}?inline=1`)} target="_blank" rel="noreferrer noopener" onPointerDown={(e) => e.stopPropagation()}>
                <img src={apiUrl(`/attachments/${id}?inline=1`)} alt="" loading="lazy" draggable={false} />
              </a>
            ))}
          </div>
        )}
      </div>
      {ctx.canEdit && !overlay && <Menu label="⋮" items={[
        { label: 'Edit text', onClick: () => setEditing(true) },
        card.image_ids?.length > 0 && { label: 'Remove pictures', onClick: () => confirm('Remove all pictures from this box?') && ctx.removePictures(card) },
        { label: 'Delete', danger: true, onClick: () => ctx.archiveCard(card) },
      ]} />}
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
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: CARD + card.id, data: { type: 'card' }, disabled: !ctx.canDrag });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}
      className={isDragging ? 'card-slot dragging' : 'card-slot'}>
      <CardFace card={card} ctx={ctx} />
    </div>
  );
}

function CardFace({ card, ctx, overlay }) {
  if (ctx.simple) return <SimpleBox card={card} ctx={ctx} overlay={overlay} />;
  const labels = card.label_ids.map((id) => ctx.labelsById[id]).filter(Boolean);
  const due = dueStatus(card.due_date, card.completed);
  const checkDone = card.check_total > 0 && card.check_done === card.check_total;
  const picked = ctx.selecting && ctx.selected.includes(card.id);
  const stale = ctx.agingDays > 0 && !card.completed && Date.now() - Date.parse(card.updated_at) > ctx.agingDays * 864e5;
  const ageWeeks = stale ? Math.floor((Date.now() - Date.parse(card.updated_at)) / (7 * 864e5)) : 0;
  return (
    <div className={`card ${card.completed ? 'completed' : ''} ${overlay ? 'overlay' : ''} ${card.cover ? 'has-cover' : ''} ${picked ? 'selected' : ''} ${stale ? `aged aged-${Math.min(3, Math.ceil((Date.now() - Date.parse(card.updated_at)) / (ctx.agingDays * 864e5)) - 1)}` : ''}`}
      title={stale ? `No changes for ${ageWeeks ? `${ageWeeks} week${ageWeeks === 1 ? '' : 's'}` : `${ctx.agingDays}+ days`}` : undefined}
      onClick={() => { if (overlay) return; if (ctx.selecting) ctx.toggleSelect(card.id); else navigate(`/b/${ctx.boardId}/c/${card.id}`); }}>
      {ctx.selecting && !overlay && <span className={`select-box ${picked ? 'on' : ''}`} aria-hidden>{picked ? '✓' : ''}</span>}
      <CardCover cover={card.cover} />
      {card.is_template ? <span className="badge template-badge">▣ Template</span> : null}
      {labels.length > 0 && (
        <div className="card-labels">
          {labels.map((l) => <span key={l.id} className="label-chip" style={{ background: l.color }}>{l.name}</span>)}
        </div>
      )}
      <div className="card-title-row">
        {ctx.canEdit ? <CompleteCircle done={!!card.completed} onToggle={() => ctx.toggleCard(card)} /> : card.completed ? <span className="done-mark">✓</span> : null}
        <span className="card-title">{card.title}</span>
      </div>
      <div className="card-badges">
        <PriorityBadge priority={card.priority} />
        {card.estimate != null && <span className="badge plain estimate" title="Estimate (points)">◆ {card.estimate}</span>}
        {card.sub_total > 0 && <span className={`badge ${card.sub_done === card.sub_total ? 'done' : 'plain'}`} title="Sub-cards done">🗂 {card.sub_done}/{card.sub_total}</span>}
        {card.parent_id && ctx.cardsById[card.parent_id] && <span className="badge plain parent-badge" title={`Sub-card of ${ctx.cardsById[card.parent_id].title}`}>↳ {ctx.cardsById[card.parent_id].title.slice(0, 24)}</span>}
        {card.time_minutes > 0 && <span className="badge plain" title="Time logged">⏱ {formatMinutes(card.time_minutes)}</span>}
        {card.timer_user_id && <span className="badge soon" title="A timer is running">⏱ live</span>}
        {card.sprint_id && ctx.sprintsById[card.sprint_id] && ctx.sprintsById[card.sprint_id].status !== 'closed' && <span className="badge plain" title="Sprint">🏃 {ctx.sprintsById[card.sprint_id].name}</span>}
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
        {card.member_ids?.length > 0 && (
          <span className="card-members">
            {card.member_ids.map((id) => ctx.peopleById[id] && <Avatar key={id} user={ctx.peopleById[id]} size={22} />)}
          </span>
        )}
        {card.recurrence && <span className="badge plain" title={`Repeats ${card.recurrence}`}>🔁</span>}
        {!card.completed && card.blocked_by?.some((id) => ctx.cardsById[id] && !ctx.cardsById[id].completed) && (
          <span className="badge overdue" title="Waiting on another card">⛔ Blocked</span>
        )}
        {ctx.fields.filter((f) => f.show_on_card).map((f) => {
          const text = fieldText(f, card.field_values?.[f.id]);
          return text && <span key={f.id} className="badge plain field-badge" title={f.name}>{f.type === 'checkbox' ? text : `${f.name}: ${text}`}</span>;
        })}
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

// Rows of lists grouped by member, label, priority, sprint or parent card. Click to open; drag is
// off here because a drop would also have to change the lane's value.
function Swimlanes({ by, data, listOrder, cols, shows, ctx }) {
  const [folded, setFolded] = useState({});
  const lanes = useMemo(() => {
    const cards = data.cards.filter((c) => !c.is_template && shows(c));
    const make = (key, name, test, color) => ({ key, name, color, has: test });
    let defs = [];
    if (by === 'member') defs = [...data.people.map((p) => make(p.id, p.display_name, (c) => c.member_ids.includes(p.id))), make('none', 'Unassigned', (c) => !c.member_ids.length)];
    if (by === 'label') defs = [...data.labels.map((l) => make(l.id, l.name || 'Label', (c) => c.label_ids.includes(l.id), l.color)), make('none', 'No label', (c) => !c.label_ids.length)];
    if (by === 'priority') defs = [4, 3, 2, 1, 0].map((p) => make(String(p), `${PRIORITIES[p].icon} ${PRIORITIES[p].name}`, (c) => (c.priority || 0) === p));
    if (by === 'sprint') defs = [...(data.sprints || []).filter((sp) => sp.status !== 'closed').map((sp) => make(sp.id, `${sp.name}${sp.status === 'active' ? ' (active)' : ''}`, (c) => c.sprint_id === sp.id)), make('none', 'Backlog', (c) => !c.sprint_id || ctx.sprintsById[c.sprint_id]?.status === 'closed')];
    if (by === 'parent') {
      const parents = data.cards.filter((c) => c.sub_total > 0);
      defs = [...parents.map((p) => make(p.id, p.title, (c) => c.parent_id === p.id || c.id === p.id)), make('none', 'Everything else', (c) => !c.parent_id && !c.sub_total)];
    }
    return defs.map((d) => ({ ...d, cards: cards.filter(d.has) })).filter((d) => d.cards.length || d.key !== 'none');
  }, [by, data, shows, ctx.sprintsById]);
  return (
    <div className="swimlanes">
      {lanes.map((lane) => (
        <section key={lane.key} className="swimlane">
          <button className="lane-head" onClick={() => setFolded((f) => ({ ...f, [lane.key]: !f[lane.key] }))}>
            <span className="chev">{folded[lane.key] ? '▸' : '▾'}</span>
            {lane.color && <span className="label-dot" style={{ background: lane.color }} />}
            <strong>{lane.name}</strong> <span className="muted small">{lane.cards.length}</span>
          </button>
          {!folded[lane.key] && (
            <div className="lists lane-lists">
              {listOrder.map((id) => {
                const list = data.lists.find((l) => l.id === id);
                if (!list) return null;
                const ids = (cols[id] || []).filter((cid) => lane.cards.some((c) => c.id === cid));
                return (
                  <div key={id} className="list lane-list">
                    <div className="list-head"><span className="list-name">{list.name}</span><span className="list-count">{ids.length}</span></div>
                    <div className="cards">{ids.map((cid) => ctx.cardsById[cid] && <CardFace key={cid} card={ctx.cardsById[cid]} ctx={ctx} />)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
