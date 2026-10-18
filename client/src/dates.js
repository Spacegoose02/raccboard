// Dates are stored as "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local time).

export function parseDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59); // date-only = end of that day
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const hasTime = (v) => v && v.includes('T');

export function formatDate(v, { withTime = true } = {}) {
  const d = parseDate(v);
  if (!d) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return withTime && hasTime(v) ? `${date}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : date;
}

// 'overdue' | 'soon' (within 24h) | 'done' | ''
export function dueStatus(v, completed) {
  const d = parseDate(v);
  if (!d) return '';
  if (completed) return 'done';
  const diff = d.getTime() - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 24 * 3600 * 1000) return 'soon';
  return '';
}

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
