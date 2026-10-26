// Branding lives here so the app is easy to rename.
export const APP_NAME = 'Raccboard';
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

// Board background presets. Keys must match BACKGROUND_PRESETS in server/api.js.
export const BACKGROUNDS = {
  ocean: 'linear-gradient(135deg, #0ea5e9, #1e3a8a)',
  sunset: 'linear-gradient(135deg, #f97316, #db2777)',
  forest: 'linear-gradient(135deg, #22c55e, #14532d)',
  grape: 'linear-gradient(135deg, #a855f7, #4c1d95)',
  peach: 'linear-gradient(135deg, #fda4af, #fdba74)',
  midnight: 'linear-gradient(135deg, #1e293b, #020617)',
  aurora: 'linear-gradient(135deg, #2dd4bf, #6366f1, #a855f7)',
  slate: 'linear-gradient(135deg, #94a3b8, #475569)',
};

// True inside the Android app (Capacitor). The app then talks to a server URL chosen on first launch.
export const IS_NATIVE = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
