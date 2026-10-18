// Branding lives here so the app is easy to rename.
export const APP_NAME = 'Rackboard';
export const APP_MASCOT = '🦝';

export const THEMES = [
  { id: 'dark', name: 'Charcoal (default)', swatch: ['#1d2125', '#101204', '#22272b', '#579dff'] },
  { id: 'light', name: 'Light', swatch: ['#f7f8f9', '#ebecf0', '#ffffff', '#0c66e4'] },
  { id: 'midnight', name: 'Midnight', swatch: ['#0b1020', '#131a2e', '#1c2540', '#7aa2ff'] },
  { id: 'raccoon', name: 'Raccoon gray', swatch: ['#2b2d31', '#3a3d42', '#4a4e54', '#e0a458'] },
  { id: 'forest', name: 'Forest', swatch: ['#13201a', '#1b2b23', '#24372d', '#6fcf97'] },
  { id: 'solarized', name: 'Solarized', swatch: ['#002b36', '#073642', '#0e4251', '#b58900'] },
  { id: 'dracula', name: 'Dracula', swatch: ['#21222c', '#282a36', '#343746', '#bd93f9'] },
];

export const COLORS = [
  '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7',
  '#3b82f6', '#06b6d4', '#84cc16', '#ec4899', '#64748b',
];

// True inside the Android app (Capacitor). The app then talks to a server URL chosen on first launch.
export const IS_NATIVE = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
