import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applyTheme } from './settings.js';
import { IS_NATIVE } from './config.js';
import './styles.css';

applyTheme();
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installable PWA: register the app-shell service worker (not needed inside the Android app).
if (import.meta.env.PROD && !IS_NATIVE && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
