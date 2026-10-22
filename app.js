let modules = [];
let module = null;
let pool = [];
let current = null;
let currentIndex = -1;

const $ = id => document.getElementById(id);
const state = JSON.parse(localStorage.getItem('be-state') || '{"favorites":[],"learned":[]}');
const save = () => localStorage.setItem('be-state', JSON.stringify(state));

async function start() {
  module = await (await fetch('business_english_101.json?v=20261023-3')).json();
  modules = [module];
  setupNavigationButtons();
  setupModule(module);

  // Updated cache name in sw.js is recommended when replacing app.js.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js');
  }
}

function setupNavigationButtons() {
  const actions = document.querySelector('.actions');
  if (!actions) return;

  // Keep existing favorite and learned buttons, then replace the old random-only control area.
  const oldNext = $('next');
  if (oldNext) oldNext.remove();

  let nav = document.getElementById('cardNavigation');
  if (!nav) {
    nav = document.createElement('div');
    nav.id = 'cardNavigation';
    nav.style.gridColumn = '1 / -1';
    nav.style.display = 'grid';
    nav.style.gridTemplateColumns = '1fr 1fr';
    nav.style.gap = '10px';
    nav.innerHTML = `
      <button id="prev" type="button">◀ 前へ</button>
      <button id="next" type="button" class="primary">次へ ▶</button>
      <button id="random" type="button" style="grid-column:1/-1">🎲 ランダム表示</button>
    `;
    actions.appendChild(nav);
  }

  $('prev').addEventListener('click', previousCard);
  $('next').addEventListener('click', nextCard);
  $('random').addEventListener('click', randomCard);
}

function setupModule(m) {
  module = m;
  $('moduleTitle').textContent = m.title;
  const sel = $('category');
  sel.innerHTML = '<option value="all">全カテゴリー</option>' +
    m.categories.map(c => `<option value="${c.id}">${c.order}. ${c.title}（${c.cards.length}）</option>`).join('');
  rebuild();
}

function rebuild() {
  const cid = $('category').value || 'all';
  pool = module.categories
    .filter(c => cid === 'all' || c.id === cid)
    .flatMap(c => c.cards.map(x => ({ ...x, category: c.title, order: c.order })))
    .filter(x => !$('favOnly').checked || state.favorites.includes(x.id))
    .filter(x => !$('unlearnedOnly').checked || !state.learned.includes(x.id));

  currentIndex = pool.length ? 0 : -1;
  showCurrentCard();
}

function showCurrentCard() {
  if (!pool.length || currentIndex < 0) {
    current = null;
    $('question').textContent = '条件に合うカードがありません';
    $('answerWrap').hidden = true;
    $('reveal').hidden = true;
    $('progress').textContent = '0 / 0';
    return;
  }

  if (currentIndex >= pool.length) currentIndex = 0;
  if (currentIndex < 0) currentIndex = pool.length - 1;
  current = pool[currentIndex];
  render();
}

function nextCard() {
  if (!pool.length) return;
  currentIndex = (currentIndex + 1) % pool.length;
  showCurrentCard();
}

function previousCard() {
  if (!pool.length) return;
  currentIndex = (currentIndex - 1 + pool.length) % pool.length;
  showCurrentCard();
}

function randomCard() {
  if (!pool.length) return;
  if (pool.length === 1) {
    currentIndex = 0;
  } else {
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * pool.length);
    } while (nextIndex === currentIndex);
    currentIndex = nextIndex;
  }
  showCurrentCard();
}

function render() {
  const reverse = $('direction').value === 'en-jp';
  $('categoryName').textContent = `${current.order}. ${current.category}`;
  $('progress').textContent = `${currentIndex + 1} / ${pool.length}`;
  $('question').textContent = reverse ? current.en : current.jp;
  $('answer').textContent = reverse ? current.jp : current.en;
  $('note').textContent = current.note || '';
  $('note').hidden = !current.note;
  $('answerWrap').hidden = true;
  $('reveal').hidden = false;

  const favorite = state.favorites.includes(current.id);
  const learned = state.learned.includes(current.id);
  $('favorite').textContent = (favorite ? '★' : '☆') + ' お気に入り';
  $('favorite').classList.toggle('active', favorite);
  $('learned').classList.toggle('active', learned);
}

$('reveal').addEventListener('click', () => {
  $('answerWrap').hidden = false;
  $('reveal').hidden = true;
});

$('category').addEventListener('change', rebuild);
$('direction').addEventListener('change', () => current && render());
$('favOnly').addEventListener('change', rebuild);
$('unlearnedOnly').addEventListener('change', rebuild);

$('favorite').addEventListener('click', () => {
  if (!current) return;
  const list = state.favorites;
  const index = list.indexOf(current.id);
  index < 0 ? list.push(current.id) : list.splice(index, 1);
  save();
  render();
});

$('learned').addEventListener('click', () => {
  if (!current) return;
  const list = state.learned;
  const index = list.indexOf(current.id);
  index < 0 ? list.push(current.id) : list.splice(index, 1);
  save();
  render();
});

$('reset').addEventListener('click', () => {
  state.favorites = [];
  state.learned = [];
  save();
  rebuild();
});

$('addon').addEventListener('change', async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const m = JSON.parse(await file.text());
    if (m.schemaVersion !== 1 || !Array.isArray(m.categories)) throw new Error('invalid format');
    modules.push(m);
    setupModule(m);
  } catch (error) {
    alert('対応する追加教材JSONではありません。');
  }
});

start().catch(error => {
  console.error(error);
  $('question').textContent = '教材データを読み込めませんでした。';
});
