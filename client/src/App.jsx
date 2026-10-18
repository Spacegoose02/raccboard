import { useEffect, useState } from 'react';
import { APP_MASCOT, APP_NAME, IS_NATIVE } from './config.js';
import { updateSettings, useSettings } from './settings.js';
import { refreshAuth, signOut, useAuth } from './auth.js';
import Home from './components/Home.jsx';
import Board from './components/Board.jsx';
import Settings from './components/Settings.jsx';
import ServerSetup from './components/ServerSetup.jsx';
import SignIn from './components/SignIn.jsx';
import { Avatar } from './components/Avatar.jsx';
import { Menu } from './components/ui.jsx';

// Tiny hash router: #/  ·  #/login  ·  #/settings[/board/:boardId]  ·  #/b/:boardId  ·  #/b/:boardId/c/:cardId
function parse(hash) {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (parts[0] === 'settings') return { page: 'settings', boardId: parts[1] === 'board' ? parts[2] : null };
  if (parts[0] === 'b' && parts[1]) return { page: 'board', boardId: parts[1], cardId: parts[2] === 'c' ? parts[3] : null };
  return { page: 'home' };
}

export default function App() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  const { serverUrl } = useSettings();
  const auth = useAuth();
  const needsServer = IS_NATIVE && !serverUrl;

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    const onChangeServer = () => updateSettings({ serverUrl: '', authToken: '' });
    window.addEventListener('hashchange', onHash);
    window.addEventListener('rb:change-server', onChangeServer);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('rb:change-server', onChangeServer); };
  }, []);

  useEffect(() => { if (!needsServer) refreshAuth(); }, [needsServer, serverUrl]);

  useEffect(() => {
    if (route.page !== 'board') document.title = route.page === 'settings' ? `Settings · ${APP_NAME}` : APP_NAME;
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
  } else if (!auth.user) content = <SignIn key={auth.setupRequired ? 'setup' : 'login'} />;
  else {
    content = (
      <>
        {route.page === 'home' && <Home />}
        {route.page === 'settings' && <Settings key={route.boardId || ''} boardId={route.boardId} />}
        {route.page === 'board' && <Board key={route.boardId} boardId={route.boardId} cardId={route.cardId} />}
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/"><span className="mascot">{APP_MASCOT}</span>{APP_NAME}</a>
        {auth.user && (
          <nav className="topnav">
            <a href="#/" className={route.page === 'home' ? 'active' : ''}>Boards</a>
            <a href="#/settings" className={route.page === 'settings' ? 'active' : ''} title="Settings">⚙<span className="hide-sm"> Settings</span></a>
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
      <main className="main">{content}</main>
    </div>
  );
}
