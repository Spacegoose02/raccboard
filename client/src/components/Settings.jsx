import { useState } from 'react';
import { APP_MASCOT, APP_NAME, THEMES } from '../config.js';
import { updateSettings, useSettings } from '../settings.js';
import { Avatar } from './CardModal.jsx';

export default function Settings() {
  const settings = useSettings();
  const [name, setName] = useState(settings.displayName);
  const [saved, setSaved] = useState(false);
  const saveName = () => { updateSettings({ displayName: name.trim() }); setSaved(true); setTimeout(() => setSaved(false), 1500); };

  return (
    <div className="page settings">
      <h2>Settings</h2>

      <section className="panel">
        <h3>Your name</h3>
        <p className="muted">Shown on your comments and in card activity. Saved in this browser only until accounts arrive.</p>
        <div className="row">
          <Avatar name={name || 'Someone'} />
          <input value={name} placeholder="e.g. Rocky Raccoon" maxLength={60} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveName()} />
          <button className="btn primary" onClick={saveName}>Save</button>
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </section>

      <section className="panel">
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
      </section>

      <section className="panel">
        <h3>About</h3>
        <p className="muted">{APP_MASCOT} {APP_NAME} — a self-hosted Kanban board. Data lives on your server in a single SQLite file.</p>
      </section>
    </div>
  );
}
