import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Popover } from './ui.jsx';

const ICONS = { mention: '💬', assigned: '👤', due: '⏰' };

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// Bell in the top bar with an unread count and the inbox in a popover.
export function NotificationBell() {
  const [data, setData] = useState({ items: [], unread: 0, email: true });
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.get('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    document.addEventListener('visibilitychange', load);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [load]);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
    if (n.board_id) window.location.hash = `/b/${n.board_id}${n.card_id ? `/c/${n.card_id}` : ''}`;
    load();
  };
  const readAll = async () => { await api.post('/notifications/read'); load(); };
  const toggleEmail = async () => { await api.put('/notifications/email', { enabled: !data.email }); load(); };

  return (
    <span className="notif-wrap">
      <button className="notif-bell" onClick={() => { setOpen((o) => !o); load(); }} title="Notifications" aria-label={`Notifications, ${data.unread} unread`}>
        🔔{data.unread > 0 && <span className="notif-count">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <Popover title="Notifications" onClose={() => setOpen(false)} className="notif-pop">
          {data.items.length === 0 && <p className="muted">Nothing yet. Mentions (@username), cards you're added to and upcoming due dates show up here.</p>}
          <ul className="notif-list">
            {data.items.map((n) => (
              <li key={n.id} className={n.read_at ? '' : 'unread'}>
                <button onClick={() => openItem(n)}>
                  <span className="notif-icon">{ICONS[n.kind] || '🔔'}</span>
                  <span className="notif-text">{n.text}<small>{n.board_name ? `${n.board_name} · ` : ''}{ago(n.created_at)}</small></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="notif-foot">
            <label><input type="checkbox" checked={data.email} onChange={toggleEmail} /> Also email me</label>
            {data.unread > 0 && <button className="btn subtle" onClick={readAll}>Mark all read</button>}
          </div>
        </Popover>
      )}
    </span>
  );
}
