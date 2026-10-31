import { clearOffline, pendingCount, writeCache } from './offline.js';
import { clearUndo } from './undo.js';
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { getSettings, updateSettings } from './settings.js';

// Shared sign-in state: { loading, setupRequired, user, signup, oidc, users }
let state = { loading: true, setupRequired: false, user: null, signup: false, forgot: false, oidc: { enabled: false }, users: [], error: '' };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export function useAuth() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

export async function refreshAuth() {
  try {
    const s = await api.get('/auth/status');
    set({ loading: false, error: '', setupRequired: s.setupRequired, user: s.user, signup: s.signup, forgot: !!s.forgot, oidc: s.oidc });
    if (s.user) loadUsers();
    else if (getSettings().authToken) updateSettings({ authToken: '' });
  } catch (e) {
    set({ loading: false, error: e.message });
  }
}

export async function loadUsers() {
  try { set({ users: await api.get('/users') }); } catch { /* signed out */ }
}

function accept({ user, token }) {
  // The browser keeps the HttpOnly cookie; the Android app keeps the token.
  updateSettings({ authToken: token });
  set({ user, setupRequired: false });
  writeCache('/auth/status', { setupRequired: false, user, signup: state.signup, forgot: state.forgot, oidc: state.oidc }); // offline start-up
  loadUsers();
}

export const signIn = async (username, password) => accept(await api.post('/auth/login', { username, password }));
export const signUp = async (body) => accept(await api.post('/auth/signup', body));
export const setupAdmin = async (body) => accept(await api.post('/auth/setup', body));
export const requestReset = (username) => api.post('/auth/forgot', { username });
export const resetPassword = async (token, password) => accept(await api.post('/auth/reset', { token, password }));

export async function signOut() {
  const n = pendingCount();
  if (n && !confirm(`${n} change${n === 1 ? '' : 's'} made offline ${n === 1 ? 'has' : 'have'} not synced yet and will be lost. Sign out anyway?`)) return;
  try { await api.post('/auth/logout'); } catch { /* already gone */ }
  updateSettings({ authToken: '' });
  clearOffline(); // cached boards and unsent edits belong to the signed-out account
  clearUndo();
  set({ user: null, users: [] });
}

export function setCurrentUser(user) {
  set({ user, users: state.users.map((u) => (u.id === user.id ? user : u)) });
}

export const userById = (id) => state.users.find((u) => u.id === id) || (state.user?.id === id ? state.user : null);

window.addEventListener('rb:signed-out', () => { if (state.user) { updateSettings({ authToken: '' }); set({ user: null }); } });
