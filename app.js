let modules = [];
let pool = [];
let current = null;
let currentIndex = -1;
let englishVoice = null;
let japaneseVoice = null;
let playState = 'stopped'; // stopped | playing | paused
let playToken = 0;
let pausedResolver = null;
let activeUtterance = null;

const $ = id => document.getElementById(id);
const state = JSON.parse(localStorage.getItem('be-state') || '{"favorites":[],"learned":[]}');
const save = () => localStorage.setItem('be-state', JSON.stringify(state));

async function start() {
  const manifest = await (await fetch('modules.json?v=20261029-repeat1')).json();
  modules = await Promise.all(manifest.modules.map(async item => ({
    ...await (await fetch(`${item.file}?v=20261029-repeat1`)).json(),
    file: item.file
  })));
  addUI();
  setupVoices();
  selectModule();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js?v=20261029-repeat1');
  }
}

function addUI() {
  const controls = document.querySelector('.controls');
  const moduleSelect = document.createElement('select');
  moduleSelect.id = 'module';
  moduleSelect.innerHTML = '<option value="all">全教材</option>' +
    modules.map(m => `<option value="${m.id}">${m.title}</option>`).join('');
  controls.prepend(moduleSelect);
  moduleSelect.addEventListener('change', selectModule);

  const actions = document.querySelector('.actions');
  const oldNext = $('next');
  if (oldNext) oldNext.remove();

  const nav = document.createElement('div');
  nav.id = 'cardNavigation';
  nav.style.cssText = 'grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:10px';
  nav.innerHTML = `
    <button id="prev" type="button">◀ 前へ</button>
    <button id="next" type="button" class="primary">次へ ▶</button>
    <button id="random" type="button">🎲 ランダム</button>
    <button id="speak" type="button">🔊 英文を読む</button>
    <label style="grid-column:1/-1">再生範囲
      <select id="repeatScope" style="width:100%;margin-top:6px">
        <option value="current">現在のカードを繰り返す</option>
        <option value="selected" selected>選択中の教材を繰り返す</option>
        <option value="all">全教材を繰り返す</option>
      </select>
    </label>
    <label style="grid-column:1/-1">再生順序
      <select id="playMode" style="width:100%;margin-top:6px">
        <option value="sequential">順番再生</option>
        <option value="random">ランダム再生（1周内は重複なし）</option>
      </select>
    </label>
    <button id="autoplay" type="button" class="primary" style="grid-column:1/-1">▶ 連続再生</button>
    <button id="pause" type="button" disabled>⏸ 一時停止</button>
    <button id="stop" type="button" disabled>■ 終了</button>
  `;
  actions.appendChild(nav);

  $('prev').addEventListener('click', previousCard);
  $('next').addEventListener('click', nextCard);
  $('random').addEventListener('click', randomCard);
  $('speak').addEventListener('click', speakEnglish);
  $('autoplay').addEventListener('click', startOrResumePlayback);
  $('pause').addEventListener('click', pausePlayback);
  $('stop').addEventListener('click', stopPlayback);
}

function setupVoices() {
  if (!('speechSynthesis' in window)) {
    $('speak').disabled = true;
    $('autoplay').disabled = true;
    return;
  }
  const pick = () => {
    const voices = speechSynthesis.getVoices();
    englishVoice = voices.find(v => /^en-US$/i.test(v.lang)) ||
      voices.find(v => /^en-GB$/i.test(v.lang)) ||
      voices.find(v => /^en[-_]/i.test(v.lang)) || null;
    japaneseVoice = voices.find(v => /^ja-JP$/i.test(v.lang)) ||
      voices.find(v => /^ja[-_]/i.test(v.lang)) || null;
  };
  pick();
  speechSynthesis.addEventListener('voiceschanged', pick);
}

function selectedModules() {
  return $('module').value === 'all' ? modules : modules.filter(m => m.id === $('module').value);
}

function cardsFromModules(targetModules, honorCategory = true) {
  const category = $('category').value;
  return targetModules.flatMap(m => m.categories
    .filter(c => !honorCategory || category === 'all' || category === `${m.id}|${c.id}`)
    .flatMap(c => c.cards.map(card => ({
      ...card,
      moduleId: m.id,
      moduleTitle: m.title,
      category: c.title,
      order: c.order
    }))))
    .filter(card => !$('favOnly').checked || state.favorites.includes(card.id))
    .filter(card => !$('unlearnedOnly').checked || !state.learned.includes(card.id));
}

function selectModule() {
  stopPlayback();
  const selected = selectedModules();
  $('moduleTitle').textContent = $('module').value === 'all' ? '全教材' : selected[0].title;
  $('category').innerHTML = '<option value="all">全カテゴリー</option>' + selected.flatMap(m =>
    m.categories.map(c => `<option value="${m.id}|${c.id}">${m.title}｜${c.order}. ${c.title}（${c.cards.length}）</option>`)
  ).join('');
  rebuild();
}

function rebuild() {
  stopPlayback();
  pool = cardsFromModules(selectedModules(), true);
  currentIndex = pool.length ? 0 : -1;
  show();
}

function show() {
  if (!pool.length || currentIndex < 0) {
    current = null;
    $('question').textContent = '条件に合うカードがありません';
    $('answerWrap').hidden = true;
    $('reveal').hidden = true;
    $('progress').textContent = '0 / 0';
    return;
  }
  current = pool[currentIndex];
  render();
}

function render() {
  const reverse = $('direction').value === 'en-jp';
  $('categoryName').textContent = `${current.moduleTitle}｜${current.order}. ${current.category}`;
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

function nextCard() { stopPlayback(); if (pool.length) { currentIndex = (currentIndex + 1) % pool.length; show(); } }
function previousCard() { stopPlayback(); if (pool.length) { currentIndex = (currentIndex - 1 + pool.length) % pool.length; show(); } }
function randomCard() { stopPlayback(); if (pool.length) { let n = currentIndex; while (pool.length > 1 && n === currentIndex) n = Math.floor(Math.random() * pool.length); currentIndex = n; show(); } }

function shuffledIndexes(length) {
  const result = Array.from({ length }, (_, i) => i);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function waitWhilePaused(token) {
  if (playState !== 'paused') return Promise.resolve(token === playToken && playState === 'playing');
  return new Promise(resolve => { pausedResolver = resolve; });
}

async function interruptiblePause(ms, token) {
  let remaining = ms;
  while (remaining > 0) {
    if (token !== playToken || playState === 'stopped') return false;
    if (playState === 'paused') {
      const resumed = await waitWhilePaused(token);
      if (!resumed) return false;
    }
    const slice = Math.min(200, remaining);
    await new Promise(resolve => setTimeout(resolve, slice));
    if (playState === 'playing') remaining -= slice;
  }
  return token === playToken && playState === 'playing';
}

function speakText(text, lang, voice, token) {
  return new Promise(async resolve => {
    if (playState === 'paused' && !await waitWhilePaused(token)) return resolve(false);
    if (token !== playToken || playState !== 'playing') return resolve(false);
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    activeUtterance = utterance;
    utterance.lang = voice ? voice.lang : lang;
    if (voice) utterance.voice = voice;
    utterance.rate = lang.startsWith('ja') ? 0.95 : 0.9;
    utterance.onend = () => resolve(token === playToken && playState !== 'stopped');
    utterance.onerror = () => resolve(false);
    speechSynthesis.speak(utterance);
  });
}

function buildPlaybackPool() {
  const scope = $('repeatScope').value;
  if (scope === 'current') return current ? [current] : [];
  if (scope === 'all') return cardsFromModules(modules, false);
  return cardsFromModules(selectedModules(), true);
}

function updatePlaybackButtons() {
  $('autoplay').textContent = playState === 'paused' ? '▶ 続きから再開' : '▶ 連続再生';
  $('pause').disabled = playState !== 'playing';
  $('stop').disabled = playState === 'stopped';
  $('repeatScope').disabled = playState !== 'stopped';
  $('playMode').disabled = playState !== 'stopped';
}

function pausePlayback() {
  if (playState !== 'playing') return;
  playState = 'paused';
  if ('speechSynthesis' in window) speechSynthesis.pause();
  updatePlaybackButtons();
}

function resumePlayback() {
  if (playState !== 'paused') return;
  playState = 'playing';
  if ('speechSynthesis' in window) speechSynthesis.resume();
  if (pausedResolver) {
    const resolve = pausedResolver;
    pausedResolver = null;
    resolve(true);
  }
  updatePlaybackButtons();
}

function stopPlayback() {
  if (playState === 'stopped') return;
  playState = 'stopped';
  playToken += 1;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  activeUtterance = null;
  if (pausedResolver) {
    const resolve = pausedResolver;
    pausedResolver = null;
    resolve(false);
  }
  updatePlaybackButtons();
}

async function startOrResumePlayback() {
  if (playState === 'paused') return resumePlayback();
  if (playState === 'playing' || !('speechSynthesis' in window)) return;

  const playbackPool = buildPlaybackPool();
  if (!playbackPool.length) return;
  playState = 'playing';
  const token = ++playToken;
  updatePlaybackButtons();

  const scope = $('repeatScope').value;
  const randomMode = $('playMode').value === 'random';
  let cycle = 0;

  while (playState !== 'stopped' && token === playToken) {
    cycle += 1;
    const order = randomMode ? shuffledIndexes(playbackPool.length) : Array.from({ length: playbackPool.length }, (_, i) => i);

    for (let position = 0; position < order.length; position++) {
      if (playState === 'stopped' || token !== playToken) break;
      if (playState === 'paused' && !await waitWhilePaused(token)) break;

      current = playbackPool[order[position]];
      const visibleIndex = pool.findIndex(card => card.id === current.id && card.moduleId === current.moduleId);
      if (visibleIndex >= 0) currentIndex = visibleIndex;
      render();
      $('progress').textContent = `${randomMode ? 'ランダム' : '順番'}再生 ${position + 1} / ${order.length}｜${cycle}周目`;

      if (!await speakText(current.jp, 'ja-JP', japaneseVoice, token)) break;
      if (!await interruptiblePause(4000, token)) break;
      if (!await speakText(current.en, 'en-US', englishVoice, token)) break;
      if (!await interruptiblePause(1000, token)) break;
    }

    // All three scopes repeat until the user stops. Current-card scope simply has one item per cycle.
    if (scope === 'current' && playState === 'playing') continue;
  }

  if (token === playToken) stopPlayback();
}

function speakEnglish() {
  stopPlayback();
  if (!current || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(current.en);
  utterance.lang = englishVoice ? englishVoice.lang : 'en-US';
  if (englishVoice) utterance.voice = englishVoice;
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

$('reveal').addEventListener('click', () => { $('answerWrap').hidden = false; $('reveal').hidden = true; });
$('category').addEventListener('change', rebuild);
$('direction').addEventListener('change', () => current && render());
$('favOnly').addEventListener('change', rebuild);
$('unlearnedOnly').addEventListener('change', rebuild);
$('favorite').addEventListener('click', () => { if (!current) return; const list = state.favorites, i = list.indexOf(current.id); i < 0 ? list.push(current.id) : list.splice(i, 1); save(); render(); });
$('learned').addEventListener('click', () => { if (!current) return; const list = state.learned, i = list.indexOf(current.id); i < 0 ? list.push(current.id) : list.splice(i, 1); save(); render(); });
$('reset').addEventListener('click', () => { state.favorites = []; state.learned = []; save(); rebuild(); });
$('addon').addEventListener('change', async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const added = JSON.parse(await file.text());
    if (!Array.isArray(added.categories)) throw new Error('invalid');
    modules = modules.filter(m => m.id !== added.id);
    modules.push(added);
    $('module').innerHTML = '<option value="all">全教材</option>' + modules.map(m => `<option value="${m.id}">${m.title}</option>`).join('');
    $('module').value = added.id;
    selectModule();
  } catch {
    alert('対応する追加教材JSONではありません。');
  }
});

start().catch(error => {
  console.error(error);
  $('question').textContent = '教材データを読み込めませんでした。';
});
