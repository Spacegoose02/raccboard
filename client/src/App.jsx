import { lazy, Suspense, useEffect, useState } from 'react';
import { APP_MASCOT, APP_NAME, IS_NATIVE } from './config.js';
import { updateSettings, useSettings } from './settings.js';
import { pendingCount } from './offline.js';
import { NotificationBell } from './components/Notifications.jsx';
import { refreshAuth, signOut, useAuth } from './auth.js';
import Home from './components/Home.jsx';
import Board from './components/Board.jsx';
const Settings = lazy(() => import('./components/Settings.jsx'));
import ServerSetup from './components/ServerSetup.jsx';
import SignIn from './components/SignIn.jsx';
const CalendarView = lazy(() => import('./components/CalendarView.jsx'));
import { Avatar } from './components/Avatar.jsx';
import { Menu } from './components/ui.jsx';

// Tiny hash router: #/  ·  #/login  ·  #/calendar  ·  #/settings[/board/:boardId]  ·  #/b/:boardId  ·  #/b/:boardId/c/:cardId
function parse(hash) {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (parts[0] === 'calendar') return { page: 'calendar' };
  if (parts[0] === 'reset' && parts[1]) return { page: 'reset', token: parts[1] };
  if (parts[0] === 'settings') return { page: 'settings', boardId: parts[1] === 'board' ? parts[2] : null };
  if (parts[0] === 'b' && parts[1]) return { page: 'board', boardId: parts[1], cardId: parts[2] === 'c' ? parts[3] : null };
  return { page: 'home' };
}

export default function App() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  const { serverUrl } = useSettings();
  const auth = useAuth();
  const needsServer = IS_NATIVE && !serverUrl;
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    window.addEventListener('rb:offline', down);
    window.addEventListener('rb:online', up);
    return () => ['offline', 'online', 'rb:offline', 'rb:online'].forEach((ev, i) => window.removeEventListener(ev, [down, up, down, up][i]));
  }, []);
  const [pending, setPending] = useState(pendingCount);
  useEffect(() => {
    const on = (e) => setPending(e.detail);
    window.addEventListener('rb:queue', on);
    return () => window.removeEventListener('rb:queue', on);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    const onChangeServer = () => updateSettings({ serverUrl: '', authToken: '' });
    window.addEventListener('hashchange', onHash);
    window.addEventListener('rb:change-server', onChangeServer);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('rb:change-server', onChangeServer); };
  }, []);

  useEffect(() => { if (!needsServer) refreshAuth(); }, [needsServer, serverUrl]);

  useEffect(() => {
    if (route.page !== 'board') document.title = route.page === 'settings' ? `Settings · ${APP_NAME}` : route.page === 'calendar' ? `Calendar · ${APP_NAME}` : APP_NAME;
  }, [route.page]);

  let content;
  if (needsServer) content = <ServerSetup onDone={() => { window.location.hash = '/'; }} />;
  else if (auth.loading) content = <div className="page"><p className="muted">Loading…</p></div>;
  else if (auth.error && !auth.user) {
    content = (
      <div className="setup">
        <p className="error">Can't reach the server: {auth.error}</p>
        <button className="btn" onClick={refreshAuth}>Try again</button>
        {IS_NATIVE && <button className="btn" onClick={() => window.dispatchEvent(new Event('rb:change-server'))}>Change server</button>}
      </div>
    );
  } else if (route.page === 'reset') content = <SignIn key="reset" resetToken={route.token} />;
  else if (!auth.user) content = <SignIn key={auth.setupRequired ? 'setup' : 'login'} />;
  else {
    content = (
      <Suspense fallback={<div className="page"><p className="muted">Loading…</p></div>}>
        {route.page === 'home' && <Home />}
        {route.page === 'calendar' && <div className="page wide"><h2>Calendar</h2><p className="muted small">Everything with a date on every board you can open.</p><CalendarView /></div>}
        {route.page === 'settings' && <Settings key={route.boardId || ''} boardId={route.boardId} />}
        {route.page === 'board' && <Board key={route.boardId} boardId={route.boardId} cardId={route.cardId} />}
      </Suspense>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/"><span className="mascot">{APP_MASCOT}</span>{APP_NAME}</a>
        {auth.user && (
          <nav className="topnav">
            <a href="#/" className={route.page === 'home' ? 'active' : ''}>Boards</a>
            <a href="#/calendar" className={route.page === 'calendar' ? 'active' : ''} title="Calendar">📅<span className="hide-sm"> Calendar</span></a>
            <a href="#/settings" className={route.page === 'settings' ? 'active' : ''} title="Settings">⚙<span className="hide-sm"> Settings</span></a>
            <NotificationBell />
            <Menu
              className="user-menu"
              label={<Avatar user={auth.user} size={30} />}
              items={[
                { label: `Signed in as ${auth.user.display_name}`, onClick: () => { window.location.hash = '/settings'; } },
                { label: 'Profile & settings', onClick: () => { window.location.hash = '/settings'; } },
                { label: 'Sign out', onClick: signOut },
              ]}
            />
          </nav>
        )}
      </header>
      {(offline || pending > 0) && (
        <div className="offline-banner" role="status">
          {offline ? "You're offline. Showing saved boards; edits sync when you reconnect." : 'Syncing offline changes…'}
          {pending > 0 && ` (${pending} waiting)`}
        </div>
      )}
      <main className="main">{content}</main>
    </div>
  );
}
