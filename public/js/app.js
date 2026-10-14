(function () {
  const R = window.AmazeRules, A = window.AmazeAudio;
  const $ = (s) => document.querySelector(s);
  const board = window.AmazeBoard.create($('#board'), { onTap: (id) => onTap(id) });
  const DEFAULTS = { bgm: true, sfx: true, reduce: false, faces: false };
  let settings = Object.assign({}, DEFAULTS), progress = {}, nick = '';
  try { Object.assign(settings, JSON.parse(localStorage.getItem('amaze.settings') || '{}')); } catch (e) {}
  try { progress = JSON.parse(localStorage.getItem('amaze.progress') || '{}'); } catch (e) {}
  try { nick = localStorage.getItem('amaze.nick') || ''; } catch (e) {}
  const save = () => { try { localStorage.setItem('amaze.settings', JSON.stringify(settings)); localStorage.setItem('amaze.progress', JSON.stringify(progress)); } catch (e) {} };
  let diff = 'easy', level = 0, state = null, busy = false; // level 0 = 隨機盤

  function applySettings() {
    document.body.classList.toggle('reduce', settings.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.body.classList.toggle('nofaces', !settings.faces);
    A.apply(settings); save();
  }

  /* ---------- 畫面切換 ---------- */
  const SCREENS = ['home', 'game', 'lobby', 'online'];
  function show(id) {
    SCREENS.forEach((s) => { $('#' + s).hidden = s !== id; });
    document.body.dataset.screen = id;
    if (id === 'home') renderHome();
  }

  /* ---------- 首頁 ---------- */
  const unlockedUpTo = (d) => (progress[d] || 0) + 1;
  function chipGroup(container, items, current, onPick) {
    container.innerHTML = '';
    items.forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === current)); b.textContent = label;
      b.onclick = () => { A.sfx.tick(); onPick(v); };
      container.appendChild(b);
    });
  }
  const DIFF_ITEMS = Object.keys(R.DIFFICULTIES).map((d) => [d, R.DIFFICULTIES[d].name]);
  function renderHome() {
    chipGroup($('#diffChips'), DIFF_ITEMS, diff, (d) => { diff = d; renderHome(); });
    const g = $('#levelGrid'); g.innerHTML = '';
    for (let l = 1; l <= R.LEVELS_PER_DIFFICULTY; l++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lv'; b.textContent = l;
      if (l <= (progress[diff] || 0)) { b.classList.add('done'); b.innerHTML = l + '<small>★</small>'; }
      if (l > unlockedUpTo(diff)) { b.disabled = true; b.setAttribute('aria-label', '第 ' + l + ' 關（尚未解鎖）'); } else b.setAttribute('aria-label', '第 ' + l + ' 關');
      b.onclick = () => startLevel(l);
      g.appendChild(b);
    }
    $('#progressText').textContent = '（已通 ' + (progress[diff] || 0) + '／' + R.LEVELS_PER_DIFFICULTY + '）';
  }

  /* ---------- 單機遊戲 ---------- */
  function heartSvg(full) {
    return '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z" fill="' + (full ? '#ff6b8f' : '#f3dbe3') + '" stroke="#e0558a" stroke-width="1.5"/></svg>';
  }
  function renderHud() {
    const h = $('#hearts');
    if (state.maxLives === Infinity) { h.innerHTML = heartSvg(true) + '<span style="font-size:16px;font-weight:800;line-height:26px">∞</span>'; h.setAttribute('aria-label', '愛心無限'); }
    else { h.innerHTML = Array.from({ length: state.maxLives }, (_, i) => heartSvg(i < state.lives)).join(''); h.setAttribute('aria-label', '愛心 ' + state.lives + '／' + state.maxLives); }
    $('#hintCount').textContent = state.hints === Infinity ? '∞' : '×' + state.hints;
    $('#hintBtn').disabled = state.hints <= 0 || state.status !== 'playing';
    $('#gameTitle').textContent = R.DIFFICULTIES[diff].name + '・' + (level ? '第 ' + level + ' 關' : '隨機盤') + '・' + state.shape.name + '（剩 ' + R.remaining(state) + '）';
  }
  const say = (t) => { $('#live').textContent = t; };
  function startLevel(l) {
    level = l; busy = false;
    state = l ? R.createState(diff, l) : R.createStateFromSpec(diff, R.randomSpec(diff));
    $('#result').hidden = true; show('game'); board.draw(state); board.setEnabled(true); renderHud(); A.unlock();
  }
  function onTap(id) {
    if (!state || state.status !== 'playing' || busy) return;
    A.unlock();
    const res = R.tap(state, id);
    if (res.ok) { board.fly(id); A.sfx.pop(); say('飛出去了，還剩 ' + R.remaining(state) + ' 支'); }
    else if (res.reason === 'blocked') { board.shake(id, res.blockers); A.sfx.bonk(); say('被擋住了' + (state.maxLives === Infinity ? '' : '，剩 ' + state.lives + ' 顆愛心')); }
    renderHud();
    if (state.status !== 'playing') { busy = true; setTimeout(showResult, state.status === 'won' ? 650 : 450); }
  }
  function medal(win) {
    return win
      ? '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" fill="#ffc26b" stroke="#f0a93f" stroke-width="5"/><path d="M26 42l10 10 18-22" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" fill="#c9d6ff" stroke="#8fa6f0" stroke-width="5"/><path d="M28 54q12-12 24 0M29 32h.1M51 32h.1" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>';
  }
  function showResult() {
    const win = state.status === 'won';
    if (win && level) { progress[diff] = Math.max(progress[diff] || 0, level); save(); }
    win ? A.sfx.win() : A.sfx.lose();
    $('#resultIcon').innerHTML = medal(win);
    $('#resultTitle').textContent = win ? '過關囉！' : '愛心用完了';
    $('#resultText').textContent = win ? '共點 ' + state.moves + ' 次，失誤 ' + state.mistakes + ' 次' + (state.mistakes === 0 ? '，完美！' : '。') : '再試一次，先看清楚誰擋住誰～';
    const next = win && level && level < R.LEVELS_PER_DIFFICULTY;
    $('#againBtn').textContent = next ? '下一關' : '再來一局';
    $('#againBtn').onclick = () => startLevel(next ? level + 1 : level);
    $('#roomNote').hidden = true;
    $('#result').hidden = false; $('#againBtn').focus();
  }

  /* ---------- 彈窗（焦點鎖定、Esc、返回原焦點） ---------- */
  let lastFocus = null, openModal = null;
  function open(m) { lastFocus = document.activeElement; openModal = m; m.hidden = false; const f = m.querySelector('input,button'); f && f.focus(); }
  function close() { if (!openModal) return; openModal.hidden = true; openModal = null; lastFocus && lastFocus.focus && lastFocus.focus(); }
  document.addEventListener('keydown', (e) => {
    const m = openModal || ([...document.querySelectorAll('.result')].find((x) => !x.hidden) || null);
    if (!m) return;
    if (e.key === 'Escape' && openModal) { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...m.querySelectorAll('button:not([disabled]),input')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) close(); }));

  function renderSettings() {
    const rows = [['bgm', '背景音樂'], ['sfx', '音效'], ['reduce', '減少動態'], ['faces', '箭頭表情']];
    const list = $('#setList'); list.innerHTML = '';
    rows.forEach(([k, label]) => {
      const row = document.createElement('div'); row.className = 'setrow';
      const sp = document.createElement('span'); sp.textContent = label; sp.id = 'lb-' + k;
      const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'sw'; sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-labelledby', 'lb-' + k); sw.setAttribute('aria-checked', String(!!settings[k]));
      sw.onclick = () => { settings[k] = !settings[k]; sw.setAttribute('aria-checked', String(settings[k])); applySettings(); if (k === 'sfx' && settings.sfx) { A.unlock(); A.sfx.tick(); } if (k === 'bgm' && settings.bgm) A.unlock(); };
      row.append(sp, sw); list.appendChild(row);
    });
  }
  $('#gearBtn').onclick = () => { renderSettings(); open($('#settings')); };
  $('#resetSet').onclick = () => { settings = Object.assign({}, DEFAULTS); applySettings(); renderSettings(); };
  $('#howBtn').onclick = () => open($('#how'));
  $('#randomBtn').onclick = () => startLevel(0);
  $('#levelsBtn').onclick = () => { const p = $('#levelPanel'); p.hidden = !p.hidden; $('#levelsBtn').setAttribute('aria-expanded', String(!p.hidden)); };
  $('#onlineBtn').onclick = () => window.AmazeOnline.enter();
  $('#backBtn').onclick = () => show('home');
  $('#homeBtn').onclick = () => { $('#result').hidden = true; show('home'); };
  $('#restartBtn').onclick = () => startLevel(level);
  $('#roomBtn').onclick = () => { $('#roomNote').hidden = false; };
  $('#hintBtn').onclick = () => {
    const id = R.hint(state); if (id === null) return;
    board.hint(id); say('提示：箭頭 ' + (id + 1) + ' 現在可以飛'); renderHud();
  };
  document.addEventListener('pointerdown', () => A.unlock(), { once: true });

  window.AmazeApp = {
    $, show, open, close, say, A, DIFF_ITEMS, chipGroup,
    get nick() { return nick; }, set nick(v) { nick = v; try { localStorage.setItem('amaze.nick', v); } catch (e) {} },
  };
  applySettings(); show('home');
  window.__amaze = { get state() { return state; }, startLevel, start(d, l) { diff = d; startLevel(l); } };
})();
