(function () {
  const R = window.AmazeRules, A = window.AmazeAudio;
  const $ = (s) => document.querySelector(s);
  const T = (k, p) => window.I18N.t(k, p);
  const dname = (d) => T('diff.' + d);
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
  let diff = 'easy', level = 1, state = null, levelStart = null, busy = false, playMode = 'story', randomDiff = 'easy';
  try { const d = localStorage.getItem('amaze.diff'); if (R.DIFFICULTIES[d]) diff = d; } catch (e) {}
  try { const d = localStorage.getItem('amaze.randomDiff'); if (R.DIFFICULTIES[d]) randomDiff = d; } catch (e) {}

  function applySettings() {
    document.body.classList.toggle('reduce', settings.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.body.classList.toggle('nofaces', !settings.faces);
    A.apply(settings); save();
  }

  /* ---------- 畫面切換 ---------- */
  const SCREENS = ['home', 'levels', 'random', 'game', 'lobby', 'online'];
  function show(id) {
    SCREENS.forEach((s) => { $('#' + s).hidden = s !== id; });
    document.body.dataset.screen = id;
    if (id === 'levels') renderLevels();
    if (id === 'random') renderRandom();
    if (window.AmazeScroll) AmazeScroll.refresh();
  }

  /* ---------- 闖關：選關 ---------- */
  const fmtTime = (ms) => {
    const centiseconds = Math.floor(Math.max(0, ms) / 10);
    const minutes = Math.floor(centiseconds / 6000);
    const seconds = Math.floor(centiseconds / 100) % 60;
    const fraction = centiseconds % 100;
    return minutes + ':' + String(seconds).padStart(2, '0') + '.' + String(fraction).padStart(2, '0');
  };
  const bestOf = (d, l) => (times[d] && times[d][l]) || 0;
  let t0 = 0, elapsed = 0, tickT = 0, hintsUsed = 0;
  const showTimer = () => { $('#timerText').textContent = fmtTime(elapsed); };
  function startTimer() { clearInterval(tickT); t0 = performance.now(); elapsed = 0; showTimer(); tickT = setInterval(() => { elapsed = performance.now() - t0; showTimer(); }, 10); }
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
  const diffItems = () => Object.keys(R.DIFFICULTIES).map((d) => [d, dname(d)]);
  function renderRandom() {
    chipGroup($('#randomChips'), diffItems(), randomDiff, (d) => {
      randomDiff = d;
      try { localStorage.setItem('amaze.randomDiff', d); } catch (e) {}
      renderRandom();
      $('#randomChips [data-v="' + d + '"]').focus();
    });
    [...$('#randomChips').children].forEach((button, index) => {
      const label = document.createElement('span'), detail = document.createElement('span');
      label.className = 'randomDiffName'; label.textContent = button.textContent;
      detail.className = 'randomDiffDetail'; detail.textContent = T('random.diff.' + button.dataset.v);
      const meter = document.createElement('span'), selected = document.createElement('span');
      meter.className = 'randomDiffMeter'; meter.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 5; i++) {
        const mark = document.createElement('i'); mark.className = i <= index ? 'filled' : '';
        meter.appendChild(mark);
      }
      selected.className = 'randomDiffCheck'; selected.textContent = '✓'; selected.setAttribute('aria-hidden', 'true');
      button.replaceChildren(label, detail, meter, selected);
    });
    const cfg = R.DIFFICULTIES[randomDiff];
    const count = (n) => n === Infinity ? T('random.unlimited') : n;
    $('#randomSelection').textContent = T('random.selected', { d: dname(randomDiff) });
    $('#randomRules').textContent = T('random.rules', { lives: count(cfg.lives), hints: count(cfg.hints) });
  }

  const starSvg = (on) => '<svg viewBox="0 0 24 24" class="' + (on ? 'on' : 'off') + '"><path d="M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9z" stroke-linejoin="round"/></svg>';
  const starRow = (n) => starSvg(n >= 1) + starSvg(n >= 2) + starSvg(n >= 3) + starSvg(n >= 4) + starSvg(n >= 5);
  function renderLevels(keep) {
    chipGroup($('#diffChips'), diffItems(), diff, (d) => { diff = d; try { localStorage.setItem('amaze.diff', d); } catch (e) {} renderLevels(); $('#levelScroll').scrollTop = 0; });
    const g = $('#levelGrid'); g.innerHTML = '';
    let cleared = 0, total = 0, firstOpen = 0;
    for (let l = 1; l <= R.LEVELS_PER_DIFFICULTY; l++) {
      const st = starsOf(diff, l), open = unlocked(diff, l);
      if (st) { cleared++; total += st; } else if (open && !firstOpen) firstOpen = l;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lv' + (st ? ' done' : '') + (l === firstOpen ? ' next' : '');
      b.innerHTML = '<b>' + l + '</b>' + (open ? '<span class="st" aria-hidden="true">' + starRow(st) + '</span>' + (bestOf(diff, l) ? '<small class="tm" aria-hidden="true">' + fmtTime(bestOf(diff, l)) + '</small>' : '') : '<span class="lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke-width="2.4"/></svg></span>');
      b.setAttribute('aria-label', T('lv.aria', { l }) + (open ? (st ? T('lv.stars', { n: st }) + (bestOf(diff, l) ? T('lv.best', { t: fmtTime(bestOf(diff, l)) }) : '') : T('lv.notCleared')) : T('lv.locked')));
      if (!open) { b.disabled = true; } else b.onclick = () => startLevel(l);
      g.appendChild(b);
    }
    $('#progressText').textContent = T('levels.progress', { c: cleared, n: R.LEVELS_PER_DIFFICULTY, s: total, m: R.LEVELS_PER_DIFFICULTY * 5 });
    const target = g.children[(firstOpen || R.LEVELS_PER_DIFFICULTY) - 1];
    requestAnimationFrame(() => { const sc = $('#levelScroll'); if (keep != null) { sc.scrollTop = keep; return; } if (target && !sc.dataset.placed) { sc.scrollTop = Math.max(0, target.offsetTop - sc.clientHeight / 3); } sc.dataset.placed = ''; });
  }

  /* ---------- 單機遊戲 ---------- */
  function heartSvg(full) {
    return '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z" fill="' + (full ? '#ff6b8f' : '#f3dbe3') + '" stroke="#e0558a" stroke-width="1.5"/></svg>';
  }
  function renderHud() {
    const h = $('#hearts');
    if (state.maxLives === Infinity) { h.innerHTML = heartSvg(true) + '<span style="font-size:16px;font-weight:800;line-height:26px">∞</span>'; h.setAttribute('aria-label', T('hud.heartsInf')); }
    else { h.innerHTML = Array.from({ length: state.maxLives }, (_, i) => heartSvg(i < state.lives)).join(''); h.setAttribute('aria-label', T('hud.hearts', { a: state.lives, b: state.maxLives })); }
    $('#progFill').style.width = (100 * (1 - R.remaining(state) / state.arrows.length)) + '%';
    $('#hintCount').textContent = state.hints === Infinity ? '∞' : '×' + state.hints;
    $('#hintBtn').disabled = state.hints <= 0 || state.status !== 'playing';
    $('#gameTitle').textContent = playMode === 'random' ? T('random.hud', { d: dname(state.difficulty) }) : T('hud.title', { d: dname(diff), l: level });
    $('#gameTitle').title = T('hud.titleTip', { shape: T('shape.' + state.shape.id, null, state.shape.name), n: R.remaining(state) });
  }
  const say = (t) => { $('#live').textContent = t; };
  function startLevel(l, replay = false) {
    playMode = 'story'; level = l;
    // 重玩還原獨立開局快照，不修改固定關卡資料與其他局的狀態。
    beginSolo(replay && levelStart ? structuredClone(levelStart) : R.createState(diff, l));
  }

  function startRandom(replay = false) {
    let next;
    if (replay && playMode === 'random' && levelStart) next = structuredClone(levelStart);
    else {
      const spec = R.randomSpec(randomDiff);
      if (playMode === 'random' && state && spec.seed === state.seed) spec.seed = (spec.seed + 1) % 2147483647;
      next = R.createStateFromSpec(randomDiff, spec);
    }
    playMode = 'random';
    beginSolo(next);
  }

  function beginSolo(next) {
    state = next; busy = false; resInfo = null;
    levelStart = structuredClone(state);
    GameAnalytics.start({ mode: playMode === 'random' ? 'solo_random' : 'solo', difficulty: state.difficulty, players: 1 });
    hintsUsed = 0; startTimer();
    $('#result').hidden = true; show('game'); board.draw(state); board.setEnabled(true); renderHud(); A.unlock();
    $('#restartBtn').focus();
  }
  function onTap(id) {
    if (!state || state.status !== 'playing' || busy) return;
    A.unlock();
    const res = R.tap(state, id);
    if (res.ok) { board.fly(id); A.sfx.pop(); say(T('say.fly', { n: R.remaining(state) })); }
    else if (res.reason === 'blocked') { board.shake(id, res.blockers); const hh = $('#hearts'); hh.classList.remove('hit'); void hh.offsetWidth; hh.classList.add('hit'); A.sfx.bonk(); say(T('say.blocked') + (state.maxLives === Infinity ? '' : T('say.lives', { n: state.lives }))); }
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
    toddler: { miss: 4, hint: 2, sec: 1.0 }, easy: { miss: 2, hint: 1, sec: 1.2 }, normal: { miss: 1, hint: 1, sec: 1.5 },
    hard: { miss: 1, hint: 0, sec: 1.7 }, myth: { miss: 1, hint: 0, sec: 2.0 },   // 越難允許的失誤／提示越少，但每支箭給的思考時間越多
  };
  const parMs = () => Math.round((5 + state.arrows.length * RULE[state.difficulty].sec) * 1000);
  function rate() {
    const r = RULE[state.difficulty], m = state.mistakes, fast = elapsed <= parMs();
    return { stars: 1 + (m === 0 ? 2 : m <= r.miss ? 1 : 0) + (hintsUsed <= r.hint ? 1 : 0) + (fast ? 1 : 0), fast };
  }
  let resInfo = null;
  function paintResult() {
    const { win, rt, got, prev, prevBest, newBest } = resInfo, df = resInfo.df, lv = resInfo.lv;
    const random = resInfo.mode === 'random';
    $('#result').dataset.mode = resInfo.mode;
    $('#resultIcon').innerHTML = medal(win);
    $('#resultLevel').textContent = random ? T('random.playing', { d: dname(df) }) : T('result.level', { d: dname(df), l: lv });
    $('#resultTitle').textContent = win ? (random ? T('random.win') : T('result.win')) : T('result.lose');
    $('#resultTime').textContent = fmtTime(resInfo.time);
    $('#resultMistakes').textContent = resInfo.mistakes;
    $('#resultHints').textContent = resInfo.hints;
    $('#resultTargetStat').hidden = false;
    $('#resultTarget').textContent = fmtTime(resInfo.par);
    $('#resultTargetStatus').textContent = win ? (rt.fast ? T('result.hit') : T('result.slow')) : T('result.fail');
    $('#resultTargetStatus').classList.toggle('achieved', win && rt.fast);
    $('#roomBtn').hidden = false;
    $('#roomBtn').textContent = random ? T('random.reselect') : T('result.toLevels');
    $('#replayBtn').textContent = random ? T('random.replay') : T('result.replay');
    if (random) {
      $('#resultStars').hidden = true; $('#resultStars').innerHTML = '';
      $('#resultBest').hidden = true; $('#resultBest').textContent = '';
      $('#resultText').textContent = win ? T('random.complete') : T('result.t.lose');
      $('#againBtn').textContent = T('random.new');
      $('#againBtn').onclick = () => startRandom();
      $('#replayBtn').hidden = false;
      return;
    }
    $('#resultStars').innerHTML = win ? starRow(got) : '';
    $('#resultStars').hidden = !win;
    $('#resultStars').setAttribute('aria-label', T('result.starsAria', { n: got }));
    $('#resultText').textContent = win
      ? (got === 5 ? T('result.t.perfect') : got > prev && prev ? T('result.t.up') : T('result.t.ok'))
      : T('result.t.lose');
    const best = bestOf(df, lv);
    $('#resultBest').hidden = !best;
    $('#resultBest').textContent = (newBest && prevBest ? T('result.bestNew') : T('result.best')) + fmtTime(best);
    const next = win && lv < R.LEVELS_PER_DIFFICULTY;
    $('#againBtn').textContent = next ? T('result.next') : win ? T('result.replay') : T('result.retry');
    $('#againBtn').onclick = () => startLevel(next ? level + 1 : level, !next);
    $('#replayBtn').hidden = !next;
  }
  function showResult() {
    const win = state.status === 'won';
    const random = playMode === 'random';
    GameAnalytics.end({ result: win ? 'win' : 'lose' });
    const rt = win ? (random ? { fast: elapsed <= parMs() } : rate()) : null, got = win && !random ? rt.stars : 0;
    const prev = random ? 0 : starsOf(diff, level);
    const prevBest = random ? 0 : bestOf(diff, level), newBest = !random && win && (!prevBest || elapsed < prevBest);
    if (newBest) (times[diff] = times[diff] || {})[level] = Math.floor(elapsed);
    if (win && !random) { (stars[diff] = stars[diff] || {})[level] = Math.max(prev, got); save(); }
    win ? A.sfx.win() : A.sfx.lose();
    resInfo = { mode: playMode, win, rt, got, prev, prevBest, newBest, mistakes: state.mistakes, hints: hintsUsed, time: elapsed, par: parMs(), lv: random ? null : level, df: state.difficulty };
    paintResult();
    $('#result').hidden = false; $('#againBtn').focus({ preventScroll: true });
    const card = $('#result .card'); card.scrollTop = 0;
    if (card._cs) card._cs.update();
    if (win) confetti($('#result'));
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
      const f = [...m.querySelectorAll('button:not([disabled]),input')].filter((x) => x.getClientRects().length);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) close(); }));

  function renderSettings() {
    const rows = [['bgm', T('set.bgm')], ['sfx', T('set.sfx')], ['reduce', T('set.reduce')], ['faces', T('set.faces')]];
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
  $('#randomBtn').onclick = () => show('random');
  $('#randomBack').onclick = () => show('home');
  $('#randomStart').onclick = () => startRandom();
  $('#vsAiBtn').onclick = () => window.AmazeOnline.enterLocal();
  $('#onlineBtn').onclick = () => window.AmazeOnline.enter();
  $('#levelsBack').onclick = () => show('home');
  function leaveSolo(target) {
    clearInterval(tickT); GameAnalytics.reset();
    $('#result').hidden = true; show(target);
  }
  const replaySolo = () => playMode === 'random' ? startRandom(true) : startLevel(level, true);
  $('#backBtn').onclick = () => leaveSolo(playMode === 'random' ? 'random' : 'levels');
  $('#homeBtn').onclick = () => leaveSolo('home');
  $('#restartBtn').onclick = replaySolo;
  $('#replayBtn').onclick = replaySolo;
  $('#roomBtn').onclick = () => leaveSolo(playMode === 'random' ? 'random' : 'levels');
  $('#hintBtn').onclick = () => {
    const id = R.hint(state); if (id === null) return; hintsUsed++;
    board.hint(id); say(T('say.hint', { n: id + 1 })); renderHud();
  };
  document.addEventListener('pointerdown', () => A.unlock(), { once: true });

  window.AmazeApp = {
    fmtTime, $, show, open, close, say, A, get DIFF_ITEMS() { return diffItems(); }, chipGroup, confetti, T, dname,
    get nick() { return nick; }, set nick(v) { nick = v; try { localStorage.setItem('amaze.nick', v); } catch (e) {} },
  };
  // 自繪捲軸：所有可能超出裝置的區塊
  ['#home', '#levelScroll', '#randomScroll', '#lobbyScroll', '#roomScroll', '#chatLog', '#sum'].forEach((q) => AmazeScroll.attach($(q)));
  document.querySelectorAll('.card').forEach((c) => AmazeScroll.attach(c));
  document.querySelectorAll('.boardWrap').forEach((w) => AmazeScroll.attach(w));
  // 瀏覽器／手機「上一頁」：依畫面回到上一層，不會直接離開遊戲
  const lobbyUrl = (window.AMAZE_CONFIG || {}).lobbyUrl || 'https://pjh-eric.github.io/game-lobby/';
  const syncLobbyLink = () => { $('#lobbyLink').href = window.I18N.withLang(lobbyUrl); };   // 帶上 ?lang=，大廳與遊戲語言同步
  syncLobbyLink();
  const BACK = { levels: '#levelsBack', random: '#randomBack', game: '#backBtn', lobby: '#lobbyBack', online: '#leaveBtn' };
  try { history.pushState({ amaze: 1 }, ''); } catch (e) {}
  window.addEventListener('popstate', () => {
    const cur = document.body.dataset.screen;
    if (cur === 'home' && !openModal) { location.href = window.I18N.withLang(lobbyUrl); return; }   // 首頁按上一頁 → 回遊戲大廳
    try { history.pushState({ amaze: 1 }, ''); } catch (e) {}
    if (openModal) { close(); return; }
    const b = BACK[cur]; b && $(b).click();
  });
  // 語言切換：只重繪文字，不重置遊戲狀態
  const gear = $('#gearBtn');
  window.I18N.mountToggle({ after: gear });
  window.I18N.onChange(() => {
    syncLobbyLink();
    const cur = document.body.dataset.screen;
    if (cur === 'levels') { const sc = $('#levelScroll'); renderLevels(sc.scrollTop); }
    if (cur === 'random') renderRandom();
    if (cur === 'game' && state) { renderHud(); if (resInfo && !$('#result').hidden) paintResult(); }
    if (openModal && openModal.id === 'settings') renderSettings();
    if (window.AmazeScroll) AmazeScroll.refresh();
  });
  applySettings(); show('home');
  window.__amaze = { get state() { return state; }, get mode() { return playMode; }, startLevel, start(d, l) { diff = d; startLevel(l); }, stars };
})();
