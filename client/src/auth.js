import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { getSettings, updateSettings } from './settings.js';

// Shared sign-in state: { loading, setupRequired, user, signup, oidc, users }
let state = { loading: true, setupRequired: false, user: null, signup: false, oidc: { enabled: false }, users: [], error: '' };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export function useAuth() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

export async function refreshAuth() {
  try {
    const s = await api.get('/auth/status');
    set({ loading: false, error: '', setupRequired: s.setupRequired, user: s.user, signup: s.signup, oidc: s.oidc });
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
  loadUsers();
}

export const signIn = async (username, password) => accept(await api.post('/auth/login', { username, password }));
export const signUp = async (body) => accept(await api.post('/auth/signup', body));
export const setupAdmin = async (body) => accept(await api.post('/auth/setup', body));

export async function signOut() {
  try { await api.post('/auth/logout'); } catch { /* already gone */ }
  updateSettings({ authToken: '' });
  set({ user: null, users: [] });
}

export function setCurrentUser(user) {
  set({ user, users: state.users.map((u) => (u.id === user.id ? user : u)) });
}

export const userById = (id) => state.users.find((u) => u.id === id) || (state.user?.id === id ? state.user : null);

window.addEventListener('rb:signed-out', () => { if (state.user) { updateSettings({ authToken: '' }); set({ user: null }); } });
