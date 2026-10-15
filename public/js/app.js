(function () {
  const R = window.AmazeRules, A = window.AmazeAudio;
  const $ = (s) => document.querySelector(s);
  const board = window.AmazeBoard.create($('#board'), { onTap: (id) => onTap(id) });
  const DEFAULTS = { bgm: true, sfx: true, reduce: false, faces: false };
  let settings = Object.assign({}, DEFAULTS), stars = null, nick = '';
  try { Object.assign(settings, JSON.parse(localStorage.getItem('amaze.settings') || '{}')); } catch (e) {}
  try { stars = JSON.parse(localStorage.getItem('amaze.stars') || 'null'); } catch (e) {}
  if (!stars || typeof stars !== 'object') { // 由舊版「最高通關數」轉換：舊進度一律先給 1 星
    stars = {};
    try { const old = JSON.parse(localStorage.getItem('amaze.progress') || '{}'); Object.keys(old).forEach((d) => { stars[d] = {}; for (let l = 1; l <= (old[d] | 0); l++) stars[d][l] = 1; }); } catch (e) {}
  }
  let times = {};
  try { times = JSON.parse(localStorage.getItem('amaze.times') || '{}') || {}; } catch (e) {}
  try { nick = localStorage.getItem('amaze.nick') || ''; } catch (e) {}
  const save = () => { try { localStorage.setItem('amaze.settings', JSON.stringify(settings)); localStorage.setItem('amaze.stars', JSON.stringify(stars)); localStorage.setItem('amaze.times', JSON.stringify(times)); } catch (e) {} };
  let diff = 'easy', level = 1, state = null, busy = false;
  try { const d = localStorage.getItem('amaze.diff'); if (R.DIFFICULTIES[d]) diff = d; } catch (e) {}

  function applySettings() {
    document.body.classList.toggle('reduce', settings.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.body.classList.toggle('nofaces', !settings.faces);
    A.apply(settings); save();
  }

  /* ---------- 畫面切換 ---------- */
  const SCREENS = ['home', 'levels', 'game', 'lobby', 'online'];
  function show(id) {
    SCREENS.forEach((s) => { $('#' + s).hidden = s !== id; });
    document.body.dataset.screen = id;
    if (id === 'levels') renderLevels();
    if (window.AmazeScroll) AmazeScroll.refresh();
  }

  /* ---------- 闖關：選關 ---------- */
  const fmtTime = (ms) => { const t = Math.floor(Math.max(0, ms) / 100) / 10, m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0'); };
  const bestOf = (d, l) => (times[d] && times[d][l]) || 0;
  let t0 = 0, elapsed = 0, tickT = 0, hintsUsed = 0;
  const showTimer = () => { $('#timerText').textContent = fmtTime(elapsed); };
  function startTimer() { clearInterval(tickT); t0 = performance.now(); elapsed = 0; showTimer(); tickT = setInterval(() => { elapsed = performance.now() - t0; showTimer(); }, 100); }
  function stopTimer() { clearInterval(tickT); elapsed = performance.now() - t0; showTimer(); }
  const starsOf = (d, l) => (stars[d] && stars[d][l]) || 0;
  const unlocked = (d, l) => l === 1 || starsOf(d, l - 1) > 0;
  function chipGroup(container, items, current, onPick) {
    container.innerHTML = '';
    items.forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.v = v; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === current)); b.textContent = label;
      b.onclick = () => { A.sfx.tick(); onPick(v); };
      container.appendChild(b);
    });
  }
  const DIFF_ITEMS = Object.keys(R.DIFFICULTIES).map((d) => [d, R.DIFFICULTIES[d].name]);
  const starSvg = (on) => '<svg viewBox="0 0 24 24" class="' + (on ? 'on' : 'off') + '"><path d="M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9z" stroke-linejoin="round"/></svg>';
  const starRow = (n) => starSvg(n >= 1) + starSvg(n >= 2) + starSvg(n >= 3) + starSvg(n >= 4) + starSvg(n >= 5);
  function renderLevels() {
    chipGroup($('#diffChips'), DIFF_ITEMS, diff, (d) => { diff = d; try { localStorage.setItem('amaze.diff', d); } catch (e) {} renderLevels(); $('#levelScroll').scrollTop = 0; });
    const g = $('#levelGrid'); g.innerHTML = '';
    let cleared = 0, total = 0, firstOpen = 0;
    for (let l = 1; l <= R.LEVELS_PER_DIFFICULTY; l++) {
      const st = starsOf(diff, l), open = unlocked(diff, l);
      if (st) { cleared++; total += st; } else if (open && !firstOpen) firstOpen = l;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lv' + (st ? ' done' : '') + (l === firstOpen ? ' next' : '');
      b.innerHTML = '<b>' + l + '</b>' + (open ? '<span class="st" aria-hidden="true">' + starRow(st) + '</span>' + (bestOf(diff, l) ? '<small class="tm" aria-hidden="true">' + fmtTime(bestOf(diff, l)) + '</small>' : '') : '<span class="lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke-width="2.4"/></svg></span>');
      b.setAttribute('aria-label', '第 ' + l + ' 關' + (open ? (st ? '，' + st + ' 顆星' + (bestOf(diff, l) ? '，最佳 ' + fmtTime(bestOf(diff, l)) : '') : '，尚未通關') : '，尚未解鎖'));
      if (!open) { b.disabled = true; } else b.onclick = () => startLevel(l);
      g.appendChild(b);
    }
    $('#progressText').textContent = '已通 ' + cleared + '／' + R.LEVELS_PER_DIFFICULTY + ' 關・星星 ' + total + '／' + R.LEVELS_PER_DIFFICULTY * 5;
    const target = g.children[(firstOpen || R.LEVELS_PER_DIFFICULTY) - 1];
    requestAnimationFrame(() => { const sc = $('#levelScroll'); if (target && !sc.dataset.placed) { sc.scrollTop = Math.max(0, target.offsetTop - sc.clientHeight / 3); } sc.dataset.placed = ''; });
  }

  /* ---------- 單機遊戲 ---------- */
  function heartSvg(full) {
    return '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z" fill="' + (full ? '#ff6b8f' : '#f3dbe3') + '" stroke="#e0558a" stroke-width="1.5"/></svg>';
  }
  function renderHud() {
    const h = $('#hearts');
    if (state.maxLives === Infinity) { h.innerHTML = heartSvg(true) + '<span style="font-size:16px;font-weight:800;line-height:26px">∞</span>'; h.setAttribute('aria-label', '愛心無限'); }
    else { h.innerHTML = Array.from({ length: state.maxLives }, (_, i) => heartSvg(i < state.lives)).join(''); h.setAttribute('aria-label', '愛心 ' + state.lives + '／' + state.maxLives); }
    $('#progFill').style.width = (100 * (1 - R.remaining(state) / state.arrows.length)) + '%';
    $('#hintCount').textContent = state.hints === Infinity ? '∞' : '×' + state.hints;
    $('#hintBtn').disabled = state.hints <= 0 || state.status !== 'playing';
    $('#gameTitle').textContent = R.DIFFICULTIES[diff].name + '・第 ' + level + ' 關';
    $('#gameTitle').title = state.shape.name + '・剩 ' + R.remaining(state) + ' 支';
  }
  const say = (t) => { $('#live').textContent = t; };
  function startLevel(l) {
    level = l; busy = false;
    state = R.createState(diff, l); hintsUsed = 0; startTimer();
    $('#result').hidden = true; show('game'); board.draw(state); board.setEnabled(true); renderHud(); A.unlock();
  }
  function onTap(id) {
    if (!state || state.status !== 'playing' || busy) return;
    A.unlock();
    const res = R.tap(state, id);
    if (res.ok) { board.fly(id); A.sfx.pop(); say('飛出去了，還剩 ' + R.remaining(state) + ' 支'); }
    else if (res.reason === 'blocked') { board.shake(id, res.blockers); const hh = $('#hearts'); hh.classList.remove('hit'); void hh.offsetWidth; hh.classList.add('hit'); A.sfx.bonk(); say('被擋住了' + (state.maxLives === Infinity ? '' : '，剩 ' + state.lives + ' 顆愛心')); }
    renderHud();
    if (state.status !== 'playing') { busy = true; stopTimer(); const cur = state; setTimeout(() => { if (state === cur && !$('#game').hidden) showResult(); }, state.status === 'won' ? 650 : 450); }
  }
  function medal(win) {
    return win
      ? '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" fill="#ffc26b" stroke="#f0a93f" stroke-width="5"/><path d="M26 42l10 10 18-22" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" fill="#c9d6ff" stroke="#8fa6f0" stroke-width="5"/><path d="M28 54q12-12 24 0M29 32h.1M51 32h.1" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>';
  }
  function confetti(host) {
    if (document.body.classList.contains('reduce')) return;
    const old = host.querySelector('.confetti'); old && old.remove();
    const c = document.createElement('div'); c.className = 'confetti'; c.setAttribute('aria-hidden', 'true');
    const cols = ['#ff8fb1', '#7fd6c2', '#ffc26b', '#8fc7ff', '#c3a6ff'];
    for (let i = 0; i < 28; i++) { const p = document.createElement('i'); p.style.cssText = 'left:' + Math.random() * 100 + '%;background:' + cols[i % 5] + ';animation-delay:' + Math.random() * 0.5 + 's;animation-duration:' + (1.6 + Math.random() * 1.2) + 's;--r:' + Math.round(Math.random() * 720 - 360) + 'deg;--dx:' + Math.round(Math.random() * 80 - 40) + 'px'; c.appendChild(p); }
    host.appendChild(c); setTimeout(() => c.remove(), 3200);
  }
  // 五星制（門檻皆依難度）：過關 1 星＋失誤（0 次 +2、≤門檻 +1）＋提示用量在允許內 +1＋耗時在目標內 +1
  const RULE = {
    toddler: { miss: 4, hint: 2, sec: 1.0 }, easy: { miss: 2, hint: 1, sec: 1.2 }, normal: { miss: 1, hint: 0, sec: 1.5 },
    hard: { miss: 1, hint: 0, sec: 1.8 }, myth: { miss: 1, hint: 0, sec: 2.2 },   // 越難允許的失誤／提示越少，但每支箭給的思考時間越多
  };
  const parMs = () => (5 + state.arrows.length * RULE[diff].sec) * 1000;
  function rate() {
    const r = RULE[diff], m = state.mistakes, fast = elapsed <= parMs();
    return { stars: 1 + (m === 0 ? 2 : m <= r.miss ? 1 : 0) + (hintsUsed <= r.hint ? 1 : 0) + (fast ? 1 : 0), fast };
  }
  function showResult() {
    const win = state.status === 'won';
    const rt = win ? rate() : null, got = win ? rt.stars : 0;
    const prev = starsOf(diff, level);
    const prevBest = bestOf(diff, level), newBest = win && (!prevBest || elapsed < prevBest);
    if (newBest) (times[diff] = times[diff] || {})[level] = Math.round(elapsed);
    if (win) { (stars[diff] = stars[diff] || {})[level] = Math.max(prev, got); save(); }
    win ? A.sfx.win() : A.sfx.lose();
    $('#resultIcon').innerHTML = medal(win);
    $('#resultTitle').textContent = win ? '過關囉！' : '愛心用完了';
    $('#resultStars').innerHTML = win ? starRow(got) : '';
    $('#resultStars').hidden = !win;
    $('#resultText').textContent = win
      ? '耗時 ' + fmtTime(elapsed) + (newBest ? (prevBest ? '（新紀錄！）' : '') : '（最佳 ' + fmtTime(prevBest) + '）') + '・失誤 ' + state.mistakes + ' 次・提示 ' + hintsUsed + ' 次（目標 ' + fmtTime(parMs()) + (rt.fast ? ' ✓' : ' ✗') + '）' + (got === 5 ? '，完美五星！' : got > prev && prev ? '，星星升級！' : '。')
      : '再試一次，先看清楚誰擋住誰～';
    const next = win && level < R.LEVELS_PER_DIFFICULTY;
    $('#againBtn').textContent = next ? '下一關' : win ? '再玩一次' : '再試一次';
    $('#againBtn').onclick = () => startLevel(next ? level + 1 : level);
    $('#result').hidden = false; $('#againBtn').focus(); if (win) confetti($('#result'));
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
  $('#storyBtn').onclick = () => show('levels');
  $('#vsAiBtn').onclick = () => window.AmazeOnline.enterLocal();
  $('#onlineBtn').onclick = () => window.AmazeOnline.enter();
  $('#levelsBack').onclick = () => show('home');
  $('#backBtn').onclick = () => { $('#result').hidden = true; show('levels'); };
  $('#homeBtn').onclick = () => { $('#result').hidden = true; show('home'); };
  $('#restartBtn').onclick = () => startLevel(level);
  $('#roomBtn').onclick = () => { $('#result').hidden = true; show('levels'); };
  $('#hintBtn').onclick = () => {
    const id = R.hint(state); if (id === null) return; hintsUsed++;
    board.hint(id); say('提示：箭頭 ' + (id + 1) + ' 現在可以飛'); renderHud();
  };
  document.addEventListener('pointerdown', () => A.unlock(), { once: true });

  window.AmazeApp = {
    fmtTime, $, show, open, close, say, A, DIFF_ITEMS, chipGroup, confetti,
    get nick() { return nick; }, set nick(v) { nick = v; try { localStorage.setItem('amaze.nick', v); } catch (e) {} },
  };
  // 自繪捲軸：所有可能超出裝置的區塊
  ['#home', '#levelScroll', '#lobbyScroll', '#roomScroll', '#chatLog', '#sum'].forEach((q) => AmazeScroll.attach($(q)));
  document.querySelectorAll('.card').forEach((c) => AmazeScroll.attach(c));
  document.querySelectorAll('.boardWrap').forEach((w) => AmazeScroll.attach(w));
  // 瀏覽器／手機「上一頁」：依畫面回到上一層，不會直接離開遊戲
  const lobbyUrl = (window.AMAZE_CONFIG || {}).lobbyUrl || 'https://pjh-eric.github.io/game-lobby/';
  $('#lobbyLink').href = lobbyUrl;
  const BACK = { levels: '#levelsBack', game: '#backBtn', lobby: '#lobbyBack', online: '#leaveBtn' };
  try { history.pushState({ amaze: 1 }, ''); } catch (e) {}
  window.addEventListener('popstate', () => {
    const cur = document.body.dataset.screen;
    if (cur === 'home' && !openModal) { location.href = lobbyUrl; return; }   // 首頁按上一頁 → 回遊戲大廳
    try { history.pushState({ amaze: 1 }, ''); } catch (e) {}
    if (openModal) { close(); return; }
    const b = BACK[cur]; b && $(b).click();
  });
  applySettings(); show('home');
  window.__amaze = { get state() { return state; }, startLevel, start(d, l) { diff = d; startLevel(l); }, stars };
})();
