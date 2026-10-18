import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Avatar } from './Avatar.jsx';

const ROLES = [
  { id: 'viewer', label: 'Viewer', hint: 'can read and comment' },
  { id: 'editor', label: 'Editor', hint: 'can change lists and cards' },
  { id: 'owner', label: 'Co-owner', hint: 'can also share, rename and delete' },
];

// Who can open a board, and controls to share it with people or teams.
export function SharePanel({ boardId, onChanged }) {
  const { user: me, users } = useAuth();
  const [data, setData] = useState(null);
  const [teams, setTeams] = useState([]);
  const [target, setTarget] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/boards/${boardId}/shares`).then(setData).catch((e) => setError(e.message));
    api.get('/teams').then(setTeams).catch(() => {});
  }, [boardId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    load();
    onChanged?.();
  };

  if (!data) return <p className="muted">{error || 'Loading…'}</p>;
  const isOwner = data.my_role === 'owner';
  const sharedUserIds = new Set(data.shares.filter((s) => s.user_id).map((s) => s.user_id));
  const sharedTeamIds = new Set(data.shares.filter((s) => s.team_id).map((s) => s.team_id));
  const people = users.filter((u) => u.id !== data.owner?.id && !sharedUserIds.has(u.id));
  const freeTeams = teams.filter((t) => !sharedTeamIds.has(t.id));
  const share = () => {
    if (!target) return;
    const [kind, id] = target.split(':');
    act(() => api.put(`/boards/${boardId}/shares`, { [kind === 'team' ? 'team_id' : 'user_id']: id, role }));
    setTarget('');
  };

  return (
    <div className="share-panel stack">
      {isOwner && (
        <div className="share-add">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Person or team">
            <option value="">Share with…</option>
            {freeTeams.length > 0 && (
              <optgroup label="Teams and families">
                {freeTeams.map((t) => <option key={t.id} value={`team:${t.id}`}>👪 {t.name} ({t.members.length})</option>)}
              </optgroup>
            )}
            <optgroup label="People">
              {people.map((u) => <option key={u.id} value={`user:${u.id}`}>{u.display_name} (@{u.username})</option>)}
            </optgroup>
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button className="btn primary" disabled={!target} onClick={share}>Share</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="share-list">
        {data.owner && (
          <div className="share-row">
            <Avatar user={data.owner} size={32} />
            <div className="grow"><b>{data.owner.display_name}</b>{data.owner.id === me.id ? ' (you)' : ''}<div className="muted small">Owner</div></div>
          </div>
        )}
        {data.shares.map((s) => (
          <div key={s.id} className="share-row">
            {s.team_id
              ? <span className="avatar team-avatar">👪</span>
              : <Avatar user={{ id: s.user_id, display_name: s.display_name, avatar: s.avatar }} size={32} />}
            <div className="grow">
              <b>{s.team_id ? s.team_name : s.display_name}</b>{s.user_id === me.id ? ' (you)' : ''}
              <div className="muted small">{s.team_id ? 'Team · ' : ''}{ROLES.find((r) => r.id === s.role)?.hint}</div>
            </div>
            {isOwner ? (
              <select value={s.role} aria-label="Role"
                onChange={(e) => act(() => api.put(`/boards/${boardId}/shares`, { [s.team_id ? 'team_id' : 'user_id']: s.team_id || s.user_id, role: e.target.value }))}>
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            ) : <span className="muted small">{ROLES.find((r) => r.id === s.role)?.label}</span>}
            {(isOwner || s.user_id === me.id) && (
              <button className="icon-btn" title={s.user_id === me.id ? 'Leave board' : 'Remove access'} aria-label="Remove access"
                onClick={() => confirm(s.user_id === me.id ? 'Leave this board?' : `Remove ${s.team_name || s.display_name}'s access?`)
                  && act(() => api.del(`/boards/${boardId}/shares/${s.id}`))}>✕</button>
            )}
          </div>
        ))}
        {data.shares.length === 0 && <p className="muted small">Only the owner can see this board.</p>}
      </div>
    </div>
  );
}

export function ShareDialog({ boardId, onClose, onChanged }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal share-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top"><h3>Share board</h3><div className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="share-body"><SharePanel boardId={boardId} onChanged={onChanged} /></div>
      </div>
    </div>
  );
}
