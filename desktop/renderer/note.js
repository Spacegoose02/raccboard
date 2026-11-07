const $ = (id) => document.getElementById(id);
const cardId = new URLSearchParams(location.search).get('card');
let card = null, noteColor = null, editing = false, labelCache = { board: null, labels: [] };

// Turns a label colour into a soft sticky-note background.
function tint(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null;
  const n = parseInt(m[1], 16), mix = (c, w) => Math.round(c + (255 - c) * w);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return { bg: `rgb(${mix(r, .72)},${mix(g, .72)},${mix(b, .72)})`, bar: `rgb(${mix(r, .5)},${mix(g, .5)},${mix(b, .5)})` };
}

async function load() {
  if (editing) return; // don't clobber what the user is typing
  try {
    const data = await rb.get(`/cards/${cardId}`);
    card = data.card;
    if (card.archived) { $('err').textContent = 'This card was archived on the board.'; }
    else $('err').textContent = '';
    if (labelCache.board !== card.board_id) {
      labelCache = { board: card.board_id, labels: (await rb.get(`/boards/${card.board_id}`)).labels };
    }
    render(data);
  } catch (e) {
    $('err').textContent = e.status === 404 ? 'This card was deleted. Unpin it with ✕.' : e.message;
  }
}

function render({ checklists }) {
  document.title = card.title;
  $('list').textContent = card.list_name;
  if (document.activeElement !== $('title')) $('title').textContent = card.title;
  if (document.activeElement !== $('desc')) $('desc').value = card.description || '';
  $('done').checked = !!card.completed;
  document.body.classList.toggle('completed', !!card.completed);
  applyColor();
  const due = card.due_date;
  $('due').textContent = due ? `Due ${new Date(due + (due.length === 10 ? 'T00:00' : '')).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : '';
  $('due').classList.toggle('late', !!due && !card.completed && due.slice(0, 10) < new Date().toISOString().slice(0, 10));

  const box = $('checklists');
  box.innerHTML = '';
  for (const cl of checklists) {
    const wrap = document.createElement('div'); wrap.className = 'cl';
    const h = document.createElement('h4');
    h.textContent = `${cl.title} (${cl.items.filter((i) => i.done).length}/${cl.items.length})`;
    wrap.append(h);
    for (const it of cl.items) {
      const l = document.createElement('label'); l.className = it.done ? 'done' : '';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!it.done;
      cb.onchange = () => save(() => rb.patch(`/items/${it.id}`, { done: cb.checked }));
      const s = document.createElement('span'); s.textContent = it.text;
      l.append(cb, s); wrap.append(l);
    }
    const add = document.createElement('input'); add.className = 'add'; add.placeholder = '+ Add item';
    add.onkeydown = (e) => {
      if (e.key === 'Enter' && add.value.trim()) { const text = add.value.trim(); add.value = ''; save(() => rb.post(`/checklists/${cl.id}/items`, { text })); }
    };
    wrap.append(add); box.append(wrap);
  }
}

// A color picked from the right-click menu wins over the card's first label color.
function applyColor() {
  const label = card && labelCache.labels.find((l) => l.id === card.label_ids[0]);
  const t = tint(noteColor) || tint(label?.color);
  document.documentElement.style.setProperty('--bg', t ? t.bg : '#fff7b1');
  document.documentElement.style.setProperty('--bar', t ? t.bar : '#f5e97a');
}

async function save(fn) {
  try { await fn(); $('err').textContent = ''; rb.changed(); }
  catch (e) { $('err').textContent = e.message; }
  editing = false;
  load();
}

$('done').onchange = () => save(() => rb.patch(`/cards/${cardId}`, { completed: $('done').checked }));

const title = $('title');
title.onfocus = () => { editing = true; };
title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { title.textContent = card.title; title.blur(); } };
title.onblur = () => {
  const v = title.textContent.trim();
  if (!card || !v || v === card.title) { editing = false; title.textContent = card?.title || ''; return; }
  save(() => rb.patch(`/cards/${cardId}`, { title: v }));
};

const desc = $('desc');
desc.onfocus = () => { editing = true; };
desc.onblur = () => {
  if (!card || desc.value === (card.description || '')) { editing = false; return; }
  save(() => rb.patch(`/cards/${cardId}`, { description: desc.value }));
};

$('close').onclick = () => rb.unpin(cardId);
$('open').onclick = () => card && rb.openInBrowser(card.board_id, cardId);
$('top').onclick = async () => {
  const on = !$('top').classList.contains('on');
  await rb.setOnTop(cardId, on);
  $('top').classList.toggle('on', on);
};
rb.noteState(cardId).then((s) => {
  $('top').classList.toggle('on', !!s?.onTop);
  noteColor = s?.color || null; applyColor();
});
window.addEventListener('contextmenu', (e) => { e.preventDefault(); rb.colorMenu(cardId); });
rb.onColor((c) => { noteColor = c; applyColor(); });
rb.onRefresh(load);
load();
