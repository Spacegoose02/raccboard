import { useSyncExternalStore } from 'react';

const KEY = 'rackboard.settings';
const listeners = new Set();
let state = load();

function load() {
  try { return { displayName: '', theme: 'dark', serverUrl: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { displayName: '', theme: 'dark', serverUrl: '' }; }
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
  // Match the browser/OS status bar to the theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--topbar').trim() || '#1d2125';
}

export function useSettings() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
