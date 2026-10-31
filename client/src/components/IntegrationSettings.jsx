import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const when = (t) => (t ? new Date(t).toLocaleString() : 'never');

// Personal API tokens and per-board webhooks. Secrets are shown once, right after creating.
export default function IntegrationSettings() {
  return (
    <>
      <h3>API & webhooks</h3>
      <p className="muted">Use a token as <code>Authorization: Bearer rb_…</code> with the REST API (see docs/API.md).</p>
      <Tokens />
      <Webhooks />
    </>
  );
}

function Tokens() {
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api.get('/tokens').then(setTokens).catch((e) => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    try { setFresh(await api.post('/tokens', { name })); setName(''); load(); } catch (err) { setMsg(err.message); }
  };
  const revoke = async (t) => {
    if (!window.confirm(`Revoke "${t.name}"? Anything using it stops working.`)) return;
    await api.del(`/tokens/${t.id}`);
    load();
  };

  return (
    <div className="integration-block">
      <h4>API tokens</h4>
      <form className="row" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Home Assistant" maxLength={80} />
        <button className="btn primary">Create token</button>
      </form>
      {fresh && <p className="secret-once">Copy this now, it won't be shown again: <code>{fresh.token}</code></p>}
      {msg && <p className="muted">{msg}</p>}
      <ul className="backup-list">
        {tokens.map((t) => (
          <li key={t.id}>
            <span>{t.name} · …{t.hint} · last used {when(t.last_used_at)}</span>
            <button className="btn subtle" onClick={() => revoke(t)}>Revoke</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Webhooks() {
  const [boards, setBoards] = useState([]);
  const [board, setBoard] = useState('');
  const [hooks, setHooks] = useState([]);
  const [url, setUrl] = useState('');
  const [fresh, setFresh] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/boards').then((all) => {
      const owned = all.filter((b) => b.my_role === 'owner');
      setBoards(owned);
      setBoard(owned[0]?.id || '');
    }).catch((e) => setMsg(e.message));
  }, []);
  const load = useCallback(() => {
    if (board) api.get(`/boards/${board}/webhooks`).then(setHooks).catch((e) => setMsg(e.message));
  }, [board]);
  useEffect(() => { setFresh(null); load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setMsg('');
    try { setFresh(await api.post(`/boards/${board}/webhooks`, { url })); setUrl(''); load(); } catch (err) { setMsg(err.message); }
  };
  const test = async (h) => { const r = await api.post(`/boards/${board}/webhooks/${h.id}/test`); setMsg(`Test ping: ${r.status}`); load(); };
  const remove = async (h) => { await api.del(`/boards/${board}/webhooks/${h.id}`); load(); };

  if (!boards.length) return null;
  return (
    <div className="integration-block">
      <h4>Webhooks</h4>
      <p className="muted">Each change on the board POSTs a <code>board.changed</code> event, signed with <code>X-Raccboard-Signature</code>.</p>
      <select value={board} onChange={(e) => setBoard(e.target.value)}>
        {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <form className="row" onSubmit={add}>
        <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" />
        <button className="btn primary">Add webhook</button>
      </form>
      {fresh && <p className="secret-once">Signing secret (shown once): <code>{fresh.secret}</code></p>}
      {msg && <p className="muted">{msg}</p>}
      <ul className="backup-list">
        {hooks.map((h) => (
          <li key={h.id}>
            <span>{h.url} · last {h.last_status || 'not sent'} {h.last_sent_at ? `(${when(h.last_sent_at)})` : ''}</span>
            <span>
              <button className="btn subtle" onClick={() => test(h)}>Test</button>
              <button className="btn subtle" onClick={() => remove(h)}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
