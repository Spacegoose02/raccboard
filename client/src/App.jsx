import { useEffect, useState } from 'react';
import { APP_MASCOT, APP_NAME } from './config.js';
import Home from './components/Home.jsx';
import Board from './components/Board.jsx';
import Settings from './components/Settings.jsx';

// Tiny hash router: #/  ·  #/settings  ·  #/b/:boardId  ·  #/b/:boardId/c/:cardId
function parse(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'settings') return { page: 'settings' };
  if (parts[0] === 'b' && parts[1]) return { page: 'board', boardId: parts[1], cardId: parts[2] === 'c' ? parts[3] : null };
  return { page: 'home' };
}

export default function App() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (route.page !== 'board') document.title = route.page === 'settings' ? `Settings · ${APP_NAME}` : APP_NAME;
  }, [route.page]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/"><span className="mascot">{APP_MASCOT}</span>{APP_NAME}</a>
        <nav className="topnav">
          <a href="#/" className={route.page === 'home' ? 'active' : ''}>Boards</a>
          <a href="#/settings" className={route.page === 'settings' ? 'active' : ''} title="Settings">⚙ Settings</a>
        </nav>
      </header>
      <main className="main">
        {route.page === 'home' && <Home />}
        {route.page === 'settings' && <Settings />}
        {route.page === 'board' && <Board key={route.boardId} boardId={route.boardId} cardId={route.cardId} />}
      </main>
    </div>
  );
}
