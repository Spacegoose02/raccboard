import { apiUrl } from '../api.js';

// Raccoon avatar presets: background, fur, and an accessory.
export const RACCOONS = [
  { bg: '#3b82f6', fur: '#aeb8c3', acc: 'none' },
  { bg: '#22c55e', fur: '#b8a99a', acc: 'party' },
  { bg: '#a855f7', fur: '#aeb8c3', acc: 'glasses' },
  { bg: '#ef4444', fur: '#c4b5a5', acc: 'bow' },
  { bg: '#f97316', fur: '#9aa5b1', acc: 'headphones' },
  { bg: '#eab308', fur: '#aeb8c3', acc: 'crown' },
  { bg: '#06b6d4', fur: '#b0a090', acc: 'beanie' },
  { bg: '#ec4899', fur: '#aeb8c3', acc: 'flower' },
  { bg: '#64748b', fur: '#d1d5db', acc: 'glasses' },
  { bg: '#84cc16', fur: '#9aa5b1', acc: 'bow' },
  { bg: '#1e293b', fur: '#aeb8c3', acc: 'headphones' },
  { bg: '#0f766e', fur: '#c4b5a5', acc: 'party' },
];

const ACCESSORIES = {
  none: null,
  party: <><path d="M256 20 L310 130 L202 130 Z" fill="#facc15" /><circle cx="256" cy="20" r="16" fill="#f472b6" /><path d="M222 100 L290 100" stroke="#ef4444" strokeWidth="10" /></>,
  glasses: <><circle cx="190" cy="262" r="42" fill="none" stroke="#111827" strokeWidth="12" /><circle cx="322" cy="262" r="42" fill="none" stroke="#111827" strokeWidth="12" /><path d="M232 258 L280 258" stroke="#111827" strokeWidth="12" /></>,
  bow: <><path d="M256 150 L196 118 L196 182 Z M256 150 L316 118 L316 182 Z" fill="#ef4444" /><circle cx="256" cy="150" r="16" fill="#b91c1c" /></>,
  headphones: <><path d="M96 270 C96 120 416 120 416 270" fill="none" stroke="#111827" strokeWidth="22" /><rect x="72" y="240" width="44" height="80" rx="18" fill="#111827" /><rect x="396" y="240" width="44" height="80" rx="18" fill="#111827" /></>,
  crown: <path d="M176 140 L176 70 L216 106 L256 56 L296 106 L336 70 L336 140 Z" fill="#facc15" stroke="#b45309" strokeWidth="6" />,
  beanie: <><path d="M120 190 C130 70 382 70 392 190 Z" fill="#2563eb" /><rect x="112" y="176" width="288" height="34" rx="14" fill="#1d4ed8" /><circle cx="256" cy="66" r="22" fill="#93c5fd" /></>,
  flower: <><g fill="#f9a8d4">{[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={360 + 26 * Math.cos((a * Math.PI) / 180)} cy={140 + 26 * Math.sin((a * Math.PI) / 180)} r="18" />)}</g><circle cx="360" cy="140" r="14" fill="#facc15" /></>,
};

export function RaccoonFace({ index = 0, size = 32 }) {
  const r = RACCOONS[index % RACCOONS.length];
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <circle cx="256" cy="256" r="256" fill={r.bg} />
      <g transform="translate(36 52) scale(0.86)">
        <path d="M120 200 L150 70 L235 160 Z" fill={r.fur} />
        <path d="M392 200 L362 70 L277 160 Z" fill={r.fur} />
        <path d="M140 170 L156 104 L205 156 Z" fill="#1d2125" />
        <path d="M372 170 L356 104 L307 156 Z" fill="#1d2125" />
        <ellipse cx="256" cy="280" rx="170" ry="140" fill={r.fur} />
        <ellipse cx="256" cy="345" rx="95" ry="75" fill="#eef1f4" />
        <path d="M92 262 C140 196 214 196 256 236 C298 196 372 196 420 262 C384 318 310 330 256 300 C202 330 128 318 92 262 Z" fill="#1d2125" />
        <circle cx="190" cy="262" r="26" fill="#fff" />
        <circle cx="322" cy="262" r="26" fill="#fff" />
        <circle cx="195" cy="266" r="12" fill="#1d2125" />
        <circle cx="327" cy="266" r="12" fill="#1d2125" />
        <ellipse cx="256" cy="330" rx="26" ry="18" fill="#1d2125" />
        <path d="M226 380 C240 392 272 392 286 380" stroke="#1d2125" strokeWidth="8" fill="none" strokeLinecap="round" />
        {ACCESSORIES[r.acc]}
      </g>
    </svg>
  );
}

const INITIAL_COLORS = ['#c2410c', '#0369a1', '#15803d', '#7e22ce', '#b91c1c', '#0f766e', '#a16207', '#4338ca'];

// user: { id, display_name, avatar } (optional); name: fallback for old comments without a user.
export function Avatar({ user, name, size = 32 }) {
  const label = user?.display_name || name || '?';
  const avatar = user?.avatar || '';
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (avatar.startsWith('raccoon:')) {
    return <span className="avatar raccoon" style={style} title={label}><RaccoonFace index={Number(avatar.slice(8))} size={size} /></span>;
  }
  if (avatar.startsWith('photo:') && user?.id) {
    return <img className="avatar photo" style={style} src={apiUrl(`/users/${user.id}/photo?v=${encodeURIComponent(avatar.split(':')[1])}`)} alt="" title={label} />;
  }
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <span className="avatar" style={{ ...style, background: INITIAL_COLORS[h % INITIAL_COLORS.length] }} title={label}>{initials}</span>;
}
