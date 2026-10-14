(function () {
  const R = window.AmazeRules, A = window.AmazeAudio;
  const $ = (s) => document.querySelector(s);
  const COLORS = ['#ff8fb1', '#7fd6c2', '#ffc26b', '#8fc7ff', '#c3a6ff', '#ff9d7a', '#9ddc8a'];
  const C = 60; // 每格 user units
  const SVGNS = 'http://www.w3.org/2000/svg';
  const DEFAULTS = { bgm: true, sfx: true, reduce: false };
  let settings = Object.assign({}, DEFAULTS);
  let progress = {};
  try { Object.assign(settings, JSON.parse(localStorage.getItem('amaze.settings') || '{}')); } catch (e) {}
  try { progress = JSON.parse(localStorage.getItem('amaze.progress') || '{}'); } catch (e) {}
  const save = () => { try { localStorage.setItem('amaze.settings', JSON.stringify(settings)); localStorage.setItem('amaze.progress', JSON.stringify(progress)); } catch (e) {} };
  let diff = 'easy', level = 1, state = null, busy = false;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function applySettings() {
    document.body.classList.toggle('reduce', settings.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches);
    A.apply(settings); save();
  }

  /* ---------- 首頁 ---------- */
  function unlockedUpTo(d) { return (progress[d] || 0) + 1; }
  function renderHome() {
    const chips = $('#diffChips'); chips.innerHTML = '';
    Object.keys(R.DIFFICULTIES).forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(d === diff)); b.textContent = R.DIFFICULTIES[d].name;
      b.onclick = () => { diff = d; A.sfx.tick(); renderHome(); };
      chips.appendChild(b);
    });
    const g = $('#levelGrid'); g.innerHTML = '';
    for (let l = 1; l <= R.LEVELS_PER_DIFFICULTY; l++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lv'; b.textContent = l;
      if (l <= (progress[diff] || 0)) { b.classList.add('done'); b.innerHTML = l + '<small>★</small>'; }
      if (l > unlockedUpTo(diff)) { b.disabled = true; b.setAttribute('aria-label', '第 ' + l + ' 關（尚未解鎖）'); }
      else b.setAttribute('aria-label', '第 ' + l + ' 關');
      b.onclick = () => startLevel(l);
      g.appendChild(b);
      if (l === unlockedUpTo(diff) && l <= R.LEVELS_PER_DIFFICULTY) b.dataset.current = '1';
    }
    $('#progressText').textContent = '（已通 ' + (progress[diff] || 0) + '／' + R.LEVELS_PER_DIFFICULTY + '）';
    const cur = g.querySelector('[data-current]'); if (cur && (progress[diff] || 0) > 0) requestAnimationFrame(() => cur.scrollIntoView({ block: 'center' }));
  }
  function show(id) { $('#home').hidden = id !== 'home'; $('#game').hidden = id !== 'game'; if (id === 'home') renderHome(); }

  /* ---------- 遊戲 ---------- */
  function heartSvg(full) {
    return '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.500 4.500 0 0 1 8-2.800A4.500 4.500 0 0 1 20 10c0 5.800-8 11-8 11Z" fill="' + (full ? '#ff6b8f' : '#f3dbe3') + '" stroke="#e0558a" stroke-width="1.500"/></svg>';
  }
  function renderHud() {
    const h = $('#hearts');
    if (state.maxLives === Infinity) { h.innerHTML = heartSvg(true) + '<span style="font-size:16px;font-weight:800;line-height:26px">∞</span>'; h.setAttribute('aria-label', '愛心無限'); }
    else { h.innerHTML = Array.from({ length: state.maxLives }, (_, i) => heartSvg(i < state.lives)).join(''); h.setAttribute('aria-label', '愛心 ' + state.lives + '／' + state.maxLives); }
    $('#hintCount').textContent = state.hints === Infinity ? '∞' : '×' + state.hints;
    $('#hintBtn').disabled = state.hints <= 0 || state.status !== 'playing';
    $('#gameTitle').textContent = R.DIFFICULTIES[diff].name + '・第 ' + level + ' 關・' + state.shape.name + '（剩 ' + R.remaining(state) + '）';
  }
  function arrowShape(a) {
    const pts = a.cells.map(([x, y]) => [x * C + C / 2, y * C + C / 2]);
    // 尾端稍微縮短，頭部畫三角形
    const [dx, dy] = R.DIRS[a.dir];
    const head = pts[0];
    const poly = pts.map((p) => p.join(',')).join(' ');
    const tip = [head[0] + dx * 25, head[1] + dy * 25];
    const px = -dy, py = dx;
    const tri = [tip, [head[0] + px * 19 - dx * 2, head[1] + py * 19 - dy * 2], [head[0] - px * 19 - dx * 2, head[1] - py * 19 - dy * 2]].map((p) => p.join(',')).join(' ');
    return { poly, tri };
  }
  function drawBoard() {
    const svg = $('#board'); svg.innerHTML = '';
    svg.setAttribute('viewBox', `-14 -14 ${state.w * C + 28} ${state.h * C + 28}`);
    // 棋盤底：依輪廓遮罩逐格鋪色，外圍加一圈邊線
    for (const pass of [0, 1]) for (let y = 0; y < state.h; y++) for (let x = 0; x < state.w; x++) {
      if (state.mask[y][x] !== '1') continue;
      el('rect', pass === 0
        ? { x: x * C - 2, y: y * C - 2, width: C + 4, height: C + 4, rx: 6, fill: '#f3cfdc', stroke: '#f3cfdc', 'stroke-width': 12, 'stroke-linejoin': 'round' }
        : { x: x * C - 1, y: y * C - 1, width: C + 2, height: C + 2, fill: '#fffafc' }, svg);
    }
    if (false) for (let y = 0; y < state.h; y++) for (let x = 0; x < state.w; x++) el('circle', { cx: x * C + C / 2, cy: y * C + C / 2, r: 3.500, class: 'cellDot' }, svg);
    state.arrows.forEach((a) => {
      const color = COLORS[a.id % COLORS.length];
      const g = el('g', { class: 'arrow', tabindex: 0, role: 'button', 'data-id': a.id, 'aria-label': '箭頭 ' + (a.id + 1) + '，朝' + { U: '上', D: '下', L: '左', R: '右' }[a.dir] }, svg);
      const [dx, dy] = R.DIRS[a.dir];
      g.style.setProperty('--sx', dx * 10 + 'px'); g.style.setProperty('--sy', dy * 10 + 'px');
      const s = arrowShape(a);
      el('polyline', { class: 'halo', points: s.poly }, g);
      el('polyline', { points: s.poly, fill: 'none', stroke: '#fff', 'stroke-width': 36, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      el('polyline', { points: s.poly, fill: 'none', stroke: color, 'stroke-width': 31, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      el('polygon', { points: s.tri, fill: color, stroke: '#fff', 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
      // 可愛小眼睛在頭部
      const hx = a.cells[0][0] * C + C / 2, hy = a.cells[0][1] * C + C / 2, px = -dy, py = dx;
      [-1, 1].forEach((k) => el('circle', { cx: hx + px * k * 6 - dx * 2, cy: hy + py * k * 6 - dy * 2, r: 3, fill: '#5a3d4a' }, g));
      el('polyline', { points: s.poly, fill: 'none', stroke: 'transparent', 'stroke-width': 40, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      g.addEventListener('click', () => onTap(a.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(a.id); } });
    });
  }
  const node = (id) => document.querySelector('.arrow[data-id="' + id + '"]');
  function say(t) { $('#live').textContent = t; }

  function startLevel(l) {
    level = l; state = R.createState(diff, l); busy = false;
    $('#result').hidden = true; show('game'); drawBoard(); renderHud(); A.unlock();
  }
  function onTap(id) {
    if (!state || state.status !== 'playing' || busy) return;
    A.unlock();
    const a = state.arrows[id], res = R.tap(state, id), n = node(id);
    if (res.ok) {
      const dist = (a.dir === 'U' ? a.cells[0][1] + 1 : a.dir === 'D' ? state.h - a.cells[0][1] : a.dir === 'L' ? a.cells[0][0] + 1 : state.w - a.cells[0][0]) + a.cells.length + 1;
      const [dx, dy] = R.DIRS[a.dir];
      n.style.setProperty('--fx', dx * dist * C + 'px'); n.style.setProperty('--fy', dy * dist * C + 'px');
      n.classList.add('fly'); A.sfx.pop(); say('飛出去了，還剩 ' + R.remaining(state) + ' 支');
      setTimeout(() => n.remove(), 520);
    } else if (res.reason === 'blocked') {
      n.classList.remove('shake'); void n.getBBox(); n.classList.add('shake');
      res.blockers.forEach((b) => { const bn = node(b); if (bn) { bn.classList.add('blocker'); setTimeout(() => bn.classList.remove('blocker'), 700); } });
      A.sfx.bonk(); say('被擋住了' + (state.maxLives === Infinity ? '' : '，剩 ' + state.lives + ' 顆愛心'));
    }
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
    if (win) { progress[diff] = Math.max(progress[diff] || 0, level); save(); A.sfx.win(); } else A.sfx.lose();
    $('#resultIcon').innerHTML = medal(win);
    $('#resultTitle').textContent = win ? '過關囉！' : '愛心用完了';
    $('#resultText').textContent = win ? '共點 ' + state.moves + ' 次，失誤 ' + state.mistakes + ' 次' + (state.mistakes === 0 ? '，完美！' : '。') : '再試一次，先看清楚誰擋住誰～';
    const next = win && level < R.LEVELS_PER_DIFFICULTY;
    $('#againBtn').textContent = next ? '下一關' : '再來一局';
    $('#againBtn').onclick = () => startLevel(next ? level + 1 : level);
    $('#roomNote').hidden = true;
    $('#result').hidden = false; $('#againBtn').focus();
  }

  /* ---------- 彈窗（焦點鎖定、Esc、返回原焦點） ---------- */
  let lastFocus = null, openModal = null;
  function open(m) {
    lastFocus = document.activeElement; openModal = m; m.hidden = false;
    const f = m.querySelector('button'); f && f.focus();
  }
  function close() { if (!openModal) return; openModal.hidden = true; openModal = null; lastFocus && lastFocus.focus && lastFocus.focus(); }
  document.addEventListener('keydown', (e) => {
    const m = openModal || (!$('#result').hidden ? $('#result') : null);
    if (!m) return;
    if (e.key === 'Escape' && openModal) { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...m.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) close(); }));

  function renderSettings() {
    const rows = [['bgm', '背景音樂'], ['sfx', '音效'], ['reduce', '減少動態']];
    const list = $('#setList'); list.innerHTML = '';
    rows.forEach(([k, label]) => {
      const row = document.createElement('div'); row.className = 'setrow';
      const sp = document.createElement('span'); sp.textContent = label; sp.id = 'lb-' + k;
      const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'sw'; sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-labelledby', 'lb-' + k); sw.setAttribute('aria-checked', String(!!settings[k]));
      sw.onclick = () => { settings[k] = !settings[k]; sw.setAttribute('aria-checked', String(settings[k])); applySettings(); if (k === 'sfx' && settings.sfx) A.unlock(), A.sfx.tick(); if (k === 'bgm' && settings.bgm) A.unlock(); };
      row.append(sp, sw); list.appendChild(row);
    });
  }

  $('#gearBtn').onclick = () => { renderSettings(); open($('#settings')); };
  $('#resetSet').onclick = () => { settings = Object.assign({}, DEFAULTS); applySettings(); renderSettings(); };
  $('#howBtn').onclick = () => open($('#how'));
  $('#backBtn').onclick = () => show('home');
  $('#homeBtn').onclick = () => { $('#result').hidden = true; show('home'); };
  $('#restartBtn').onclick = () => startLevel(level);
  $('#roomBtn').onclick = () => { $('#roomNote').hidden = false; };
  $('#hintBtn').onclick = () => {
    const id = R.hint(state); if (id === null) return;
    const n = node(id); n.classList.remove('hint'); void n.getBBox(); n.classList.add('hint');
    setTimeout(() => n.classList.remove('hint'), 2000); say('提示：箭頭 ' + (id + 1) + ' 現在可以飛'); renderHud();
  };
  document.addEventListener('pointerdown', () => A.unlock(), { once: true });
  applySettings(); show('home');
  window.__amaze = { get state() { return state; }, startLevel, start(d, l) { diff = d; startLevel(l); } };
})();
