import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Butler-style rules: "when <trigger> [in list], <action>".
const TRIGGERS = {
  card_added: 'a card is added to',
  card_moved: 'a card is moved to',
  card_completed: 'a card is marked complete in',
  checklist_completed: 'all checklist items are done on a card in',
};
const ACTIONS = {
  complete: 'mark it complete',
  uncomplete: 'mark it incomplete',
  join_actor: 'add the person who did it',
  add_label: 'add label…',
  remove_label: 'remove label…',
  move_to_list: 'move it to…',
  set_due_days: 'set due in N days',
  remove_due: 'remove the due date',
  archive: 'archive it',
};

export default function Automations({ boardId, lists, labels, canEdit }) {
  const [rules, setRules] = useState(null);
  const [draft, setDraft] = useState({ trigger: 'card_moved', trigger_list_id: '', action: 'complete', action_value: '' });
  const load = useCallback(() => api.get(`/boards/${boardId}/automations`).then(setRules).catch((e) => alert(e.message)), [boardId]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { try { await fn(); } catch (e) { alert(e.message); } load(); };

  const listName = (id) => lists.find((l) => l.id === id)?.name || 'a deleted list';
  const describe = (r) => {
    const where = r.trigger_list_id ? `"${listName(r.trigger_list_id)}"` : 'any list';
    let what = ACTIONS[r.action];
    if (r.action === 'move_to_list') what = `move it to "${listName(r.action_value)}"`;
    if (['add_label', 'remove_label'].includes(r.action)) what = `${r.action === 'add_label' ? 'add' : 'remove'} label "${labels.find((l) => l.id === r.action_value)?.name || '?'}"`;
    if (r.action === 'set_due_days') what = `set the due date ${r.action_value} day${r.action_value === '1' ? '' : 's'} from now`;
    return <>When {TRIGGERS[r.trigger]} <b>{where}</b>, <b>{what}</b></>;
  };
  const needsValue = ['add_label', 'remove_label', 'move_to_list', 'set_due_days'].includes(draft.action);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value, ...(k === 'action' ? { action_value: '' } : {}) }));

  if (!rules) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <p className="muted small">Rules run automatically when anyone changes a card. Changes made by a rule don't set off other rules.</p>
      <div className="rules">
        {rules.length === 0 && <p className="muted">No rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} className={`rule-row ${r.enabled ? '' : 'off'}`}>
            <span className="grow">⚡ {describe(r)}</span>
            {canEdit && <>
              <label className="check-row"><input type="checkbox" checked={!!r.enabled} onChange={() => act(() => api.patch(`/automations/${r.id}`, { enabled: !r.enabled }))} /> On</label>
              <button className="icon-btn" title="Delete rule" aria-label="Delete rule" onClick={() => act(() => api.del(`/automations/${r.id}`))}>🗑</button>
            </>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="new-rule">
          <span>When</span>
          <select value={draft.trigger} onChange={set('trigger')}>{Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={draft.trigger_list_id} onChange={set('trigger_list_id')}>
            <option value="">any list</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <span>then</span>
          <select value={draft.action} onChange={set('action')}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {draft.action === 'move_to_list' && (
            <select value={draft.action_value} onChange={set('action_value')}><option value="">Choose a list</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          )}
          {['add_label', 'remove_label'].includes(draft.action) && (
            <select value={draft.action_value} onChange={set('action_value')}><option value="">Choose a label</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.name || l.color}</option>)}</select>
          )}
          {draft.action === 'set_due_days' && <input type="number" min="0" max="365" style={{ width: 80 }} value={draft.action_value} onChange={set('action_value')} placeholder="days" />}
          <button className="btn primary" disabled={needsValue && draft.action_value === ''}
            onClick={() => act(async () => { await api.post(`/boards/${boardId}/automations`, { ...draft, trigger_list_id: draft.trigger_list_id || null }); setDraft((d) => ({ ...d, action_value: '' })); })}>
            Add rule
          </button>
        </div>
      )}
    </div>
  );
}
