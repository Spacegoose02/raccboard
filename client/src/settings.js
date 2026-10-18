import { useSyncExternalStore } from 'react';

const KEY = 'rackboard.settings';
const listeners = new Set();
let state = load();

function load() {
  try { return { displayName: '', theme: 'dark', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { displayName: '', theme: 'dark' }; }
}

export function getSettings() { return state; }

export function updateSettings(patch) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
  applyTheme();
  listeners.forEach((l) => l());
}

export function applyTheme() {
  document.documentElement.dataset.theme = state.theme || 'dark';
}

export function useSettings() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
