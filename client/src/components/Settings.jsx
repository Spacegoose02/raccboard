import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { APP_MASCOT, APP_NAME, COLORS, IS_NATIVE, THEMES } from '../config.js';
import { navigate } from '../router.js';
import { updateSettings, useSettings } from '../settings.js';
import { ServerForm } from './ServerSetup.jsx';
import { Avatar, RACCOONS, RaccoonFace } from './Avatar.jsx';
import { ColorPicker, Menu } from './ui.jsx';
import { loadUsers, setCurrentUser, signOut, useAuth } from '../auth.js';

// Every setting lives on this one page, grouped into sections.
const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'users', label: 'Users', admin: true },
  { id: 'appearance', label: 'Appearance' },
  { id: 'boards', label: 'Boards & labels' },
  IS_NATIVE && { id: 'server', label: 'Server' },
  { id: 'about', label: 'About' },
].filter(Boolean);

export default function Settings({ boardId }) {
  const { user } = useAuth();
  const sections = SECTIONS.filter((s) => !s.admin || user?.role === 'admin');
  const refs = useRef({});
  const scrollTo = (id) => refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  useEffect(() => { if (boardId) setTimeout(() => scrollTo('boards'), 50); }, [boardId]);
  const section = (id) => (el) => { refs.current[id] = el; };

  return (
    <div className="page settings">
      <h2>Settings</h2>
      <div className="settings-layout">
        <nav className="settings-nav">
          {sections.map((s) => <button key={s.id} onClick={() => scrollTo(s.id)}>{s.label}</button>)}
        </nav>
        <div className="settings-body">
          <section className="panel" ref={section('profile')}><ProfileSettings /></section>
          {user?.role === 'admin' && <section className="panel" ref={section('users')}><UsersSettings /></section>}
          <section className="panel" ref={section('appearance')}><ThemeSettings /></section>
          <section className="panel" ref={section('boards')}><BoardSettings initialBoardId={boardId} /></section>
          {IS_NATIVE && (
            <section className="panel" ref={section('server')}>
              <h3>Server</h3>
              <p className="muted">The {APP_NAME} server this app talks to.</p>
              <ServerForm buttonLabel="Save server" />
            </section>
          )}
          <section className="panel" ref={section('about')}>
            <h3>About</h3>
            <p className="muted">{APP_MASCOT} {APP_NAME}: a self-hosted Kanban board. Data lives on your server in a single SQLite file.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProfileSettings() {
  const { user } = useAuth();
  const [form, setForm] = useState({ display_name: user.display_name, email: user.email });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [msg, setMsg] = useState({ profile: '', password: '', avatar: '' });
  const fileRef = useRef(null);
  const note = (k, v) => setMsg((m) => ({ ...m, [k]: v }));
  const save = async (body, key, done = 'Saved ✓') => {
    try { setCurrentUser(await api.patch('/auth/me', body)); note(key, done); return true; } catch (e) { note(key, e.message); return false; }
  };
  const savePassword = async () => {
    if (pw.new_password !== pw.confirm) { note('password', 'New passwords do not match'); return; }
    const ok = await save({ current_password: pw.current_password, new_password: pw.new_password }, 'password', 'Password changed ✓ Other devices were signed out.');
    if (ok) setPw({ current_password: '', new_password: '', confirm: '' });
  };
  const uploadPhoto = async (file) => {
    if (!file) return;
    try { setCurrentUser(await api.upload('/auth/me/photo', file, 'photo')); note('avatar', 'Photo saved ✓'); } catch (e) { note('avatar', e.message); }
  };
  const pick = (avatar) => save({ avatar }, 'avatar', 'Avatar saved ✓');

  return (
    <>
      <h3>Profile</h3>
      <div className="profile-head">
        <Avatar user={user} size={64} />
        <div>
          <div className="profile-name">{user.display_name}</div>
          <div className="muted">@{user.username}{user.role === 'admin' ? ' · admin' : ''}{user.oidc ? ' · single sign-on' : ''}</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>

      <h4>Avatar</h4>
      <div className="avatar-grid">
        {RACCOONS.map((_, i) => (
          <button key={i} className={`avatar-choice ${user.avatar === `raccoon:${i}` ? 'selected' : ''}`} onClick={() => pick(`raccoon:${i}`)} aria-label={`Raccoon ${i + 1}`}>
            <RaccoonFace index={i} size={48} />
          </button>
        ))}
        <button className={`avatar-choice text ${!user.avatar ? 'selected' : ''}`} onClick={() => pick('')}>Initials</button>
        <button className={`avatar-choice text ${user.avatar.startsWith('photo:') ? 'selected' : ''}`} onClick={() => fileRef.current?.click()}>Upload photo</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { uploadPhoto(e.target.files[0]); e.target.value = ''; }} />
      </div>
      {msg.avatar && <p className="muted small">{msg.avatar}</p>}

      <h4>Details</h4>
      <div className="form-grid">
        <label className="field">Display name<input value={form.display_name} maxLength={60} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
        <label className="field">Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => save(form, 'profile')}>Save details</button>
        {msg.profile && <span className="muted small">{msg.profile}</span>}
      </div>

      <h4>{user.has_password ? 'Change password' : 'Set a password'}</h4>
      {!user.has_password && <p className="muted small">You sign in with single sign-on. A password also lets you sign in from the Android app.</p>}
      <div className="form-grid">
        {user.has_password && (
          <label className="field">Current password
            <input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          </label>
        )}
        <label className="field">New password
          <input type="password" autoComplete="new-password" minLength={8} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
        </label>
        <label className="field">Confirm new password
          <input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <button className="btn" disabled={!pw.new_password} onClick={savePassword}>{user.has_password ? 'Change password' : 'Set password'}</button>
        {msg.password && <span className="muted small">{msg.password}</span>}
      </div>
    </>
  );
}

function UsersSettings() {
  const { user: me, users } = useAuth();
  const empty = { username: '', display_name: '', password: '', role: 'user' };
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState('');
  const act = async (fn, ok = '') => {
    try { await fn(); setMsg(ok); } catch (e) { setMsg(e.message); }
    loadUsers();
  };
  const add = () => act(async () => { await api.post('/users', form); setForm(empty); }, `Added ${form.username} ✓`);
  const resetPassword = (u) => {
    const p = prompt(`New password for ${u.username} (8+ characters):`);
    if (p) act(() => api.patch(`/users/${u.id}`, { password: p }), 'Password reset ✓ They were signed out everywhere.');
  };

  return (
    <>
      <h3>Users</h3>
      <p className="muted">Everyone who can sign in. Admins add people, reset passwords and manage roles.</p>
      <div className="user-list">
        {users.map((u) => (
          <div key={u.id} className="user-row">
            <Avatar user={u} size={36} />
            <div className="grow">
              <div><b>{u.display_name}</b> <span className="muted">@{u.username}</span></div>
              <div className="muted small">{u.role}{u.oidc ? ' · single sign-on' : ''}{u.email ? ` · ${u.email}` : ''}</div>
            </div>
            {u.id !== me.id && (
              <Menu items={[
                { label: u.role === 'admin' ? 'Make regular user' : 'Make admin', onClick: () => act(() => api.patch(`/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' })) },
                { label: 'Reset password', onClick: () => resetPassword(u) },
                { label: 'Delete user', danger: true, onClick: () => confirm(`Delete ${u.display_name}? Their comments stay, unlinked from the account.`) && act(() => api.del(`/users/${u.id}`)) },
              ]} />
            )}
          </div>
        ))}
      </div>
      <h4>Add a user</h4>
      <div className="form-grid">
        <label className="field">Username<input autoCapitalize="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
        <label className="field">Display name<input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
        <label className="field">Temporary password<input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label className="field">Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!form.username || !form.password} onClick={add}>Add user</button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </>
  );
}

function ThemeSettings() {
  const settings = useSettings();
  return (
    <>
      <h3>Theme</h3>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-option ${settings.theme === t.id ? 'selected' : ''}`} onClick={() => updateSettings({ theme: t.id })}>
            <div className="theme-preview" style={{ background: t.swatch[0] }}>
              <div className="tp-list" style={{ background: t.swatch[1] }}>
                <div className="tp-card" style={{ background: t.swatch[2] }} />
                <div className="tp-card" style={{ background: t.swatch[2] }} />
                <div className="tp-accent" style={{ background: t.swatch[3] }} />
              </div>
              <div className="tp-list" style={{ background: t.swatch[1] }}>
                <div className="tp-card" style={{ background: t.swatch[2] }} />
              </div>
            </div>
            <span>{settings.theme === t.id ? '● ' : ''}{t.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function BoardSettings({ initialBoardId }) {
  const [boards, setBoards] = useState(null);
  const [selected, setSelected] = useState(initialBoardId || '');
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  const loadBoards = useCallback(() => api.get('/boards').then((b) => {
    setBoards(b);
    setSelected((cur) => (cur && b.some((x) => x.id === cur) ? cur : b[0]?.id || ''));
  }).catch((e) => setError(e.message)), []);
  const loadDetail = useCallback(() => {
    if (!selected) { setDetail(null); return; }
    api.get(`/boards/${selected}`).then(setDetail).catch((e) => setError(e.message));
  }, [selected]);
  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const act = async (fn) => {
    try { await fn(); } catch (e) { alert(e.message); }
    loadBoards();
    loadDetail();
  };

  if (error) return <><h3>Boards & labels</h3><p className="error">{error}</p></>;
  if (!boards) return <><h3>Boards & labels</h3><p className="muted">Loading…</p></>;
  if (!boards.length) return <><h3>Boards & labels</h3><p className="muted">No boards yet. <a href="#/">Create one</a>.</p></>;

  const board = detail?.board;
  const status = (b) => (b.archived ? ' (archived)' : b.completed_at ? ' (completed)' : '');
  return (
    <>
      <h3>Boards & labels</h3>
      <label className="field">Board
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}{status(b)}</option>)}
        </select>
      </label>
      {board && board.id === selected && (
        <div className="stack board-settings">
          <BoardNameColor key={board.id} board={board} onSave={(patch) => act(() => api.patch(`/boards/${board.id}`, patch))} />

          <h4>Labels (statuses)</h4>
          <div className="label-editor">
            {detail.labels.map((l) => (
              <LabelRow key={l.id} label={l}
                onSave={(patch) => act(() => api.patch(`/labels/${l.id}`, patch))}
                onDelete={() => confirm(`Delete label "${l.name}" from every card on this board?`) && act(() => api.del(`/labels/${l.id}`))} />
            ))}
            <NewLabel onAdd={(name, color) => act(() => api.post(`/boards/${board.id}/labels`, { name, color }))} />
          </div>

          <h4>Status</h4>
          <div className="row wrap">
            <button className="btn" onClick={() => navigate(`/b/${board.id}`)}>Open board</button>
            <button className="btn" onClick={() => act(() => api.patch(`/boards/${board.id}`, { completed: !board.completed_at }))}>
              {board.completed_at ? '↺ Reopen board' : '✓ Complete board'}
            </button>
            <button className="btn" onClick={() => act(() => api.patch(`/boards/${board.id}`, { archived: !board.archived }))}>
              {board.archived ? 'Restore board' : 'Archive board'}
            </button>
            <button className="btn danger" onClick={() => {
              if (prompt(`Type the board name to delete it forever:\n${board.name}`) === board.name) {
                act(async () => { await api.del(`/boards/${board.id}`); setSelected(''); });
              }
            }}>Delete forever</button>
          </div>
        </div>
      )}
    </>
  );
}

function BoardNameColor({ board, onSave }) {
  const [name, setName] = useState(board.name);
  return (
    <>
      <label className="field">Name
        <div className="row">
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave({ name })} />
          <button className="btn primary" disabled={!name.trim() || name === board.name} onClick={() => onSave({ name })}>Rename</button>
        </div>
      </label>
      <label className="field">Color</label>
      <ColorPicker colors={COLORS} value={board.color} onChange={(color) => onSave({ color })} />
    </>
  );
}

function LabelRow({ label, onSave, onDelete }) {
  const [name, setName] = useState(label.name);
  const [open, setOpen] = useState(false);
  return (
    <div className="label-row">
      <button className="swatch label-swatch" style={{ background: label.color }} onClick={() => setOpen((o) => !o)} aria-label="Change color" />
      <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== label.name && onSave({ name })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
      <button className="icon-btn" onClick={onDelete} title="Delete label" aria-label="Delete label">🗑</button>
      {open && <div className="label-colors"><ColorPicker colors={COLORS} value={label.color} onChange={(color) => { setOpen(false); onSave({ color }); }} /></div>}
    </div>
  );
}

function NewLabel({ onAdd }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[9]);
  const add = () => { if (!name.trim()) return; onAdd(name.trim(), color); setName(''); };
  return (
    <div className="stack new-label">
      <div className="row">
        <span className="swatch label-swatch" style={{ background: color }} />
        <input placeholder="New label name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add}>Add</button>
      </div>
      <ColorPicker colors={COLORS} value={color} onChange={setColor} />
    </div>
  );
}
