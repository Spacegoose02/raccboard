const $ = (id) => document.getElementById(id);
let pins = new Set(), boards = [], boardData = null;

async function start() {
  try {
    const s = await rb.status();
    if (s.user) return showMain(s.user);
    $('loginForm').serverUrl.value = s.serverUrl || '';
  } catch (e) { $('loginError').textContent = e.message; }
  $('login').hidden = false; $('main').hidden = true;
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('loginError').textContent = '';
  try {
    const user = await rb.signIn({ serverUrl: f.serverUrl.value, username: f.username.value, password: f.password.value });
    f.password.value = '';
    showMain(user);
  } catch (err) { $('loginError').textContent = err.message; }
});

$('signOut').addEventListener('click', async () => { await rb.signOut(); start(); });

async function showMain(user) {
  $('login').hidden = true; $('main').hidden = false;
  $('who').textContent = `Signed in as ${user.display_name || user.username}. Pinned notes stay in sync with the board.`;
  pins = new Set(await rb.pins());
  boards = (await rb.get('/boards')).filter((b) => !b.archived);
  const last = localStorage.getItem('board');
  $('board').innerHTML = '';
  boards.forEach((b) => $('board').add(new Option(b.name, b.id, false, b.id === last)));
  if (boards.length) loadBoard();
  else $('cards').textContent = 'No boards yet.';
}

async function loadBoard() {
  localStorage.setItem('board', $('board').value);
  try { boardData = await rb.get(`/boards/${$('board').value}`); render(); }
  catch (e) { $('mainError').textContent = e.message; }
}

function render() {
  if (!boardData) return;
  const q = $('search').value.trim().toLowerCase();
  const labels = Object.fromEntries(boardData.labels.map((l) => [l.id, l]));
  const box = $('cards');
  box.innerHTML = '';
  for (const list of boardData.lists) {
    const cards = boardData.cards.filter((c) => c.list_id === list.id && (!q || c.title.toLowerCase().includes(q)));
    if (!cards.length) continue;
    const h = document.createElement('div'); h.className = 'list'; h.textContent = list.name; box.append(h);
    for (const c of cards) {
      const row = document.createElement('div'); row.className = 'card' + (c.completed ? ' done' : '');
      const dot = document.createElement('span'); dot.className = 'dot';
      const color = labels[c.label_ids[0]]?.color; if (color) dot.style.background = color;
      const t = document.createElement('span'); t.className = 't'; t.textContent = c.title; t.title = c.title;
      const b = document.createElement('button');
      const pinned = pins.has(c.id);
      b.textContent = pinned ? 'Unpin' : 'Pin'; b.className = pinned ? 'pinned' : '';
      b.onclick = () => (pins.has(c.id) ? rb.unpin(c.id) : rb.pin(c.id));
      row.append(dot, t, b); box.append(row);
    }
  }
  if (!box.children.length) box.textContent = q ? 'No matching cards.' : 'This board has no cards.';
}

$('board').addEventListener('change', loadBoard);
$('search').addEventListener('input', render);
rb.onPins((p) => { pins = new Set(p); render(); });
start();
