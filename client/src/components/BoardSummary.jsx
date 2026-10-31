import { useEffect, useState } from 'react';
import { api } from '../api.js';

// "✨ Summary": a short AI rundown of what's moving, overdue or stuck on the board.
export default function BoardSummary({ boardId, onClose }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/boards/${boardId}/ai/summary`).then((r) => setText(r.summary)).catch((e) => setError(e.message));
  }, [boardId]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <h3>✨ Board summary</h3>
        {error ? <p className="error">{error}</p> : text ? <p className="ai-summary">{text}</p> : <p className="muted">Reading the board…</p>}
        <p className="muted small">Written by AI; check anything important.</p>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
