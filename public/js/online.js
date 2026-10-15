/* 線上對戰前端：大廳、房間、對戰、聊天。伺服器為唯一權威，這裡只送意圖、收事件。 */
window.AmazeOnline = (function () {
  const App = window.AmazeApp, $ = App.$, R = window.AmazeRules, A = App.A;
  const board = window.AmazeBoard.create($('#oboard'), { onTap: (id) => { if (canTap()) send({ t: 'tap', id }); } });
  const DNAME = (d) => R.DIFFICULTIES[d].name;
  const QUICK = ['加油！', '好快～', '等我一下', '再來一局！', 'GG'];
  const PCOLORS = ['#ff8fb1', '#7fd6c2', '#ffc26b', '#8fc7ff'];

  let ws = null, myId = null, room = null, gameState = null, startLocal = 0, wantOpen = false, tries = 0, retryT = null, coldT = null, countT = null;
  let local = false, hub = null, lc = null, invite = null, unread = 0, chatInit = false, lastRooms = [], resultShown = false, joined = false;
  const wide = matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)');

  /* ---------- 連線 ---------- */
  function wsUrl() {
    let base = (window.AMAZE_CONFIG || {}).serverUrl || '';
    if (!base || /^__/.test(base)) base = location.origin;
    const u = new URL(base); // 格式不對會丟錯 → 由 connect 轉成可讀錯誤
    if (!/^https?:$/.test(u.protocol)) throw new Error('server URL 必須是 http(s)');
    if (location.protocol === 'https:' && u.protocol === 'http:' && u.hostname !== 'localhost') throw new Error('HTTPS 頁面必須連 HTTPS 伺服器');
    return u.origin.replace(/^http/, 'ws') + '/ws';
  }
  function setStatus(t, bad) { const e = $('#netStatus'); e.textContent = t; e.classList.toggle('bad', !!bad); e.hidden = !t; }
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (location.protocol === 'file:') return setStatus('請用 npm start（或啟動遊戲.bat）開啟，線上模式不能直接開檔案。', true);
    let url; try { url = wsUrl(); } catch (e) { return setStatus('伺服器位址設定有誤：' + e.message, true); }
    setStatus('連線中…（免費伺服器冷啟動可能要 30 秒，請稍候）');
    clearTimeout(coldT); coldT = setTimeout(() => { if (!ws || ws.readyState !== 1) setStatus('伺服器喚醒中，通常 30 秒內完成…'); }, 3000);
    ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0; clearTimeout(coldT); setStatus('');
      let rid = null; try { rid = sessionStorage.getItem('amaze.cid'); } catch (e) {}
      send({ t: 'hello', name: App.nick, resumeId: rid });
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = () => {
      clearTimeout(coldT);
      if (!wantOpen) return;
      setStatus('連線中斷，重新連線中…', true);
      clearTimeout(retryT); retryT = setTimeout(connect, Math.min(1000 * 2 ** tries++, 8000));
    };
    ws.onerror = () => {};
  }
  function send(o) {
    if (local) { if (hub && lc) hub.handle(lc, JSON.parse(JSON.stringify(o))); return; }
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  }
  function disconnect() { wantOpen = false; clearTimeout(retryT); if (ws) { ws.close(); ws = null; } }

  /* ---------- 進出 ---------- */
  // 對電腦對戰：在瀏覽器內跑同一個 Hub（計分、電腦、多盤規則與線上完全相同），不需要連線
  function enterLocal() {
    stopLocal(); disconnect();
    local = true; room = null; gameState = null; joined = false; chatInit = false;
    $('#online').dataset.local = '1';
    const mine = hub = new window.AmazeHub.Hub();
    lc = hub.connect((o) => { const m = JSON.parse(JSON.stringify(o)); queueMicrotask(() => { if (hub === mine) onMsg(m); }); });
    hub.handle(lc, { t: 'hello', name: App.nick });
    hub.handle(lc, { t: 'create', name: '對電腦對戰', diff: 'easy', rounds: 3 });
    hub.handle(lc, { t: 'config', addAI: 'easy' });
  }
  function stopLocal() {
    if (hub) { const h = hub; hub = null; lc = null; h.stop(); }
    local = false; delete $('#online').dataset.local;
    clearInterval(countT); $('#oresult').hidden = true; room = null; gameState = null;
  }
  function enter() {
    stopLocal(); wantOpen = true; App.show('lobby'); $('#nickInput').value = App.nick; renderRooms(); connect();
  }
  function toLobby(msg) {
    room = null; gameState = null; joined = false; chatInit = false; resultShown = false;
    $('#oresult').hidden = true; App.show('lobby'); renderRooms(); if (msg) toast(msg);
    send({ t: 'rooms' });
  }
  function toast(t) {
    let e = $('#toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; e.className = 'toast'; e.setAttribute('role', 'status'); document.body.appendChild(e); }
    e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 3500);
  }

  /* ---------- 收訊息 ---------- */
  function onMsg(m) {
    switch (m.t) {
      case 'welcome':
        myId = m.id; if (!local) try { sessionStorage.setItem('amaze.cid', m.id); } catch (e) {}
        if (!m.resumed && room) toLobby('連線已重置，原本的房間已不存在');
        break;
      case 'rooms': if (!local) { lastRooms = m.rooms; renderRooms(); } break;
      case 'room': onRoom(m); break;
      case 'game': onGame(m); break;
      case 'move': onMove(m); break;
      case 'late': board.late(m.id); break;
      case 'end': onEnd(m); break;
      case 'chat': addChat(m, true); break;
      case 'notice': toast(m.msg); break;
      case 'closed': if (local) { stopLocal(); App.show('home'); } else toLobby('房間已結束：' + (m.reason || '')); break;
      case 'left': if (local) { stopLocal(); App.show('home'); } else toLobby(); break;
      case 'kicked': toast('你被房主請出房間'); break;
      case 'error': onError(m); break;
    }
  }
  function onError(m) {
    if (invite && !joined) { $('#inviteErr').textContent = m.msg; return; }
    toast(m.msg);
  }

  /* ---------- 大廳 ---------- */
  function renderRooms() {
    const ul = $('#roomList'); ul.innerHTML = '';
    if (!lastRooms.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '目前沒有公開房間，建立一間吧！'; ul.appendChild(li); return; }
    lastRooms.forEach((r) => {
      const li = document.createElement('li'); li.className = 'roomRow';
      const info = document.createElement('div'); info.className = 'rinfo';
      const nm = document.createElement('b'); nm.textContent = r.name;
      const sub = document.createElement('span'); sub.textContent = DNAME(r.diff) + '・' + r.players + '/' + r.max + ' 位' + (r.ais ? '（含電腦 ' + r.ais + '）' : '') + (r.spectators ? '・觀戰 ' + r.spectators : '') + '・' + (r.phase === 'playing' ? '對戰中' : '等待中');
      info.append(nm, sub);
      const full = r.players >= r.max || r.phase === 'playing';
      const join = btn(full ? '滿座' : '加入', 'btn small' + (full ? '' : ' primary'), () => joinRoom(r.id, 'player'));
      join.disabled = full;
      const watch = btn('觀戰', 'btn small', () => joinRoom(r.id, 'spectator'));
      li.append(info, join, watch); ul.appendChild(li);
    });
  }
  function btn(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = fn; return b; }
  function syncNick() { const v = $('#nickInput').value.trim().slice(0, 12); App.nick = v; return v; }
  function joinRoom(id, want) { send({ t: 'join', room: id, want, name: syncNick() }); }
  $('#nickInput').addEventListener('change', () => { syncNick(); send({ t: 'rename', name: App.nick }); });
  $('#quickBtn').onclick = () => {
    const r = lastRooms.find((x) => x.phase !== 'playing' && x.players < x.max);
    if (r) joinRoom(r.id, 'player');
    else { syncNick(); send({ t: 'create', name: (App.nick || '快速') + '的房間', diff: 'easy', rounds: 3 }); send({ t: 'config', addAI: 'easy' }); }
  };
  $('#lobbyBack').onclick = () => { disconnect(); invite = null; App.show('home'); };
  const ROUNDS = [1, 2, 3, 4, 5].map((n) => [n, n + ' 盤']);
  // 建房
  let cmDiff = 'easy', cmRounds = 3;
  function renderCm() {
    App.chipGroup($('#cmDiff'), App.DIFF_ITEMS, cmDiff, (v) => { cmDiff = v; renderCm(); });
    App.chipGroup($('#cmRounds'), ROUNDS, cmRounds, (v) => { cmRounds = v; renderCm(); });
  }
  $('#createBtn').onclick = () => { renderCm(); App.open($('#createModal')); };
  $('#cmGo').onclick = () => { syncNick(); send({ t: 'create', name: $('#cmName').value, diff: cmDiff, rounds: cmRounds }); App.close(); };

  // 邀請連結：先停在大廳，由使用者確認暱稱才加入
  function parseInvite() {
    const q = new URLSearchParams(location.search);
    if (!q.get('room') || !q.get('invite')) return;
    invite = { room: q.get('room').toUpperCase().slice(0, 8), token: q.get('invite'), as: q.get('as') === 'watch' ? 'watch' : 'play' };
    wantOpen = true; App.show('lobby'); connect();
    $('#inviteBox').hidden = false;
    $('#inviteTitle').textContent = '受邀加入房間 ' + invite.room;
    $('#inviteRole').textContent = invite.as === 'watch' ? '這是觀戰邀請：你會以觀戰者身分進入。' : '這是玩家邀請：有空位就會入座，否則轉為觀戰（實際身分由伺服器依邀請決定）。';
    $('#inviteNick').value = App.nick;
    renderRooms();
  }
  $('#inviteGo').onclick = () => {
    const name = $('#inviteNick').value.trim().slice(0, 12); App.nick = name; $('#inviteErr').textContent = '';
    send({ t: 'join', room: invite.room, token: invite.token, want: invite.as === 'watch' ? 'spectator' : 'player', name });
  };

  /* ---------- 房間快照 ---------- */
  function onRoom(m) {
    const first = !room || room.id !== m.id;
    room = m;
    if (first) {
      joined = true; chatInit = false; resultShown = false; unread = 0;
      if (invite) { history.replaceState(null, '', location.pathname); invite = null; $('#inviteBox').hidden = true; }
      App.show('online'); setPanel(wide.matches ? 'open' : 'closed');
    }
    if (!chatInit) { $('#chatLog').innerHTML = ''; (m.chat || []).forEach((c) => addChat(c, false)); chatInit = true; }
    $('#roomTitle').textContent = local ? m.name : m.name + '・' + m.id;
    renderSummary();
    const playing = m.phase === 'playing';
    $('#boardView').hidden = !playing; $('#roomScroll').hidden = playing;
    if (!playing) renderRoomView();
    board.setEnabled(canTap());
  }
  const me = () => room && room.players.find((p) => p.id === myId);
  const isHost = () => room && room.hostId === myId;
  const canTap = () => room && room.role === 'player' && room.phase === 'playing' && Date.now() >= startLocal;

  const multi = () => room && room.totalRounds > 1;
  const cumOf = (p) => (room.phase === 'playing' ? p.total + p.score : p.total);
  function roundText() { return room.round > 0 ? '第 ' + room.round + '／' + room.totalRounds + ' 盤' : '共 ' + room.totalRounds + ' 盤'; }
  function renderSummary() {
    const sum = $('#sum'); sum.innerHTML = '';
    const head = document.createElement('div'); head.className = 'shead';
    head.textContent = roundText() + '・' + DNAME(room.diff) + (room.phase === 'playing' ? '・剩 ' + room.remaining : room.phase === 'ended' ? (room.matchDone ? '・比賽結束' : '・本盤結束') : '');
    sum.appendChild(head);
    const key = (p) => (multi() ? cumOf(p) * 1000 + p.score : p.score);
    const sorted = room.players.map((p, i) => ({ ...p, i })).sort((a, b) => key(b) - key(a));
    sorted.forEach((p) => {
      const row = document.createElement('div'); row.className = 'srow' + (p.id === myId ? ' me' : '');
      const dot = document.createElement('i'); dot.style.background = PCOLORS[p.i % 4];
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.isAI ? '（' + DNAME(p.diff) + '）' : '') + (p.connected ? '' : '（斷線）');
      const sc = document.createElement('b'); sc.textContent = multi() ? '總 ' + cumOf(p) : p.score;
      row.append(dot, nm);
      if (multi() && room.round > 0) { const rs = document.createElement('small'); rs.textContent = '本盤 ' + p.score; row.appendChild(rs); }
      row.appendChild(sc); sum.appendChild(row);
    });
    if (!local) { const sp = document.createElement('div'); sp.className = 'sfoot'; sp.textContent = (room.role === 'spectator' ? '你是觀戰者・' : '') + '觀戰 ' + room.spectators.length; sum.appendChild(sp); }
    const ms = $('#miniScores'); ms.innerHTML = '';
    sorted.forEach((p) => { const c = document.createElement('span'); c.className = 'mchip' + (p.id === myId ? ' me' : ''); c.style.borderColor = PCOLORS[p.i % 4]; c.textContent = p.name.replace('電腦·', '').slice(0, 4) + ' ' + (multi() ? cumOf(p) : p.score); ms.appendChild(c); });
  }

  /* ---------- 房間內（等待）畫面 ---------- */
  function renderRoomView() {
    const v = $('#roomView'); v.innerHTML = '';
    const host = isHost();
    const seats = document.createElement('div'); seats.className = 'seats';
    const locked = !room.matchDone;   // 比賽進行中：設定鎖定
    const SHORT = { toddler: '幼', easy: '簡', normal: '普', hard: '難', myth: '神' };
    const seg = (current, label, onPick) => {
      const d = document.createElement('div'); d.className = 'seg'; d.setAttribute('role', 'radiogroup'); d.setAttribute('aria-label', label);
      Object.keys(R.DIFFICULTIES).forEach((k) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.v = k; b.textContent = SHORT[k];
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === current)); b.setAttribute('aria-label', DNAME(k));
        b.onclick = () => { A.sfx.tick(); onPick(k); }; d.appendChild(b);
      });
      return d;
    };
    room.players.forEach((p, i) => {
      const s = document.createElement('div'); s.className = 'seat' + (p.isAI ? ' ai' : ''); s.style.borderColor = PCOLORS[i % 4];
      const av = document.createElement('i'); av.className = 'av'; av.style.background = PCOLORS[i % 4]; av.textContent = p.isAI ? '電' : (p.name || '?').slice(0, 1); s.appendChild(av);
      const nm = document.createElement('b'); nm.textContent = p.name; s.appendChild(nm);
      const tag = document.createElement('span'); tag.className = 'tag';
      tag.textContent = (local ? (p.isAI ? '電腦・' + DNAME(p.diff) : '你') : (p.host ? '房主' : p.isAI ? '電腦・' + DNAME(p.diff) : '玩家') + (p.id === myId ? '・你' : '')) + (multi() && !room.matchDone ? '・總 ' + p.total : ''); s.appendChild(tag);
      if (host && p.isAI && !locked) {
        s.appendChild(seg(p.diff, '電腦難度', (d) => send({ t: 'config', aiDiff: { id: p.id, diff: d } })));
        const x = btn('✕', 'seatX', () => send({ t: 'config', removeAI: p.id })); x.setAttribute('aria-label', '移除電腦'); x.title = '移除電腦'; s.classList.add('hasX'); s.appendChild(x);
      }
      if (host && !p.isAI && p.id !== myId) s.appendChild(btn('請出', 'btn mini', () => send({ t: 'kick', id: p.id })));
      seats.appendChild(s);
    });
    for (let i = room.players.length; i < room.max; i++) {
      const s = document.createElement('div'); s.className = 'seat empty';
      if (host && !locked) {
        const t = document.createElement('b'); t.textContent = '＋ 加入電腦'; s.appendChild(t);
        const sub = document.createElement('span'); sub.className = 'tag'; sub.textContent = '點難度直接入座'; s.appendChild(sub);
        s.appendChild(seg(null, '加入電腦，選難度', (d) => send({ t: 'config', addAI: d })));
      } else s.textContent = '空位';
      seats.appendChild(s);
    }
    v.appendChild(seats);

    if (host && locked) { const n = document.createElement('p'); n.className = 'note'; n.textContent = '比賽進行中（' + roundText() + '已結束），打完 ' + room.totalRounds + ' 盤才能改設定。'; v.appendChild(n); }
    if (host && !locked) {
      const cfg = document.createElement('div'); cfg.className = 'cfg';
      const l1 = document.createElement('h3'); l1.textContent = '棋盤難度（每局隨機盤型）';
      const g1 = document.createElement('div'); g1.className = 'chips'; g1.setAttribute('role', 'radiogroup');
      App.chipGroup(g1, App.DIFF_ITEMS, room.diff, (d) => send({ t: 'config', diff: d }));
      const l5 = document.createElement('h3'); l5.textContent = '比賽盤數（累計總分決勝負）';
      const g5 = document.createElement('div'); g5.className = 'chips'; g5.setAttribute('role', 'radiogroup');
      App.chipGroup(g5, ROUNDS, room.totalRounds, (n) => send({ t: 'config', rounds: n }));
      cfg.append(l1, g1, l5, g5); v.appendChild(cfg);
    }
    if (host && !local) {
      const inv = document.createElement('div'); inv.className = 'invites';
      const l4 = document.createElement('h3'); l4.textContent = '邀請連結'; inv.appendChild(l4);
      const urlOf = (role) => { const it = (room.invites || []).find((x) => x.role === role); return it ? location.origin + location.pathname + '?room=' + room.id + '&invite=' + it.token + '&as=' + role : ''; };
      [['play', '玩家邀請'], ['watch', '觀戰邀請']].forEach(([role, label]) => {
        const url = urlOf(role); if (!url) return;
        const li = document.createElement('div'); li.className = 'inv';
        const nm = document.createElement('b'); nm.textContent = label;
        const u = document.createElement('div'); u.className = 'invUrl'; u.textContent = url; u.title = url; u.tabIndex = 0;
        u.addEventListener('click', () => { const r = document.createRange(); r.selectNodeContents(u); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
        li.append(nm, u, btn('複製', 'btn small', () => copy(url)));
        inv.appendChild(li);
      });
      const row = document.createElement('div'); row.className = 'irow';
      row.appendChild(btn('撤銷並重發', 'btn small ghost', () => { send({ t: 'invite', role: 'play', action: 'create' }); send({ t: 'invite', role: 'watch', action: 'create' }); toast('舊連結已失效，已產生新連結'); }));
      inv.appendChild(row);
      v.appendChild(inv);
    }
    if (!host) { const n = document.createElement('p'); n.className = 'note'; n.textContent = '比賽：' + DNAME(room.diff) + '・共 ' + room.totalRounds + ' 盤，累計總分決勝負。'; v.appendChild(n); }
    const act = document.createElement('div'); act.className = 'row';
    if (room.role === 'spectator' && room.players.length < room.max) act.appendChild(btn('入座成為玩家', 'btn', () => send({ t: 'sit' })));
    if (host) { const st = btn(locked ? '開始第 ' + (room.round + 1) + ' 盤' : room.phase === 'ended' ? '再來一場' : '開始遊戲', 'btn primary big', () => { send({ t: 'start' }); A.unlock(); }); st.disabled = room.players.length < 2; act.appendChild(st); if (room.players.length < 2) { const n = document.createElement('p'); n.className = 'note'; n.textContent = '至少 2 位（可加電腦）才能開始'; v.appendChild(n); } }
    else { const w = document.createElement('p'); w.className = 'note'; w.textContent = room.role === 'spectator' ? '你是觀戰者，可以聊天與看對戰。' : '等房主開始…'; act.appendChild(w); }
    v.appendChild(act);
  }
  function copy(text) {
    const done = () => toast('已複製連結');
    const manual = () => { const i = $('#copyText'); i.value = text; App.open($('#copyModal')); i.focus(); i.select(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
    else manual();
  }

  /* ---------- 對戰 ---------- */
  function onGame(m) {
    const st = m.state; st.arrows.forEach((a) => { a.removed = !!a.removed; });
    gameState = st; resultShown = false;
    $('#oresult').hidden = true;
    startLocal = m.startAt + (Date.now() - m.serverNow);
    board.draw(st); board.setEnabled(false); $('#oprogFill').style.width = '0%';
    $('#roomScroll').hidden = true; $('#boardView').hidden = false;
    runCountdown();
  }
  function runCountdown() {
    clearInterval(countT);
    const el = $('#count');
    const tick = () => {
      const left = startLocal - Date.now();
      if (left <= 0) { clearInterval(countT); el.textContent = '開始！'; el.hidden = false; board.setEnabled(canTap()); A.sfx.tick(); setTimeout(() => { el.hidden = true; }, 600); return; }
      const n = Math.ceil(left / 1000); if (el.textContent !== String(n)) A.sfx.tick();
      el.textContent = n; el.hidden = false;
    };
    tick(); if (startLocal > Date.now()) countT = setInterval(tick, 100);
  }
  function onMove(m) {
    if (!gameState) return;
    room && room.players.forEach((p) => { if (m.scores[p.id] != null) p.score = m.scores[p.id]; });
    if (room) room.remaining = m.remaining;
    if (gameState) $('#oprogFill').style.width = (100 * (1 - m.remaining / gameState.arrows.length)) + '%';
    if (m.ok) {
      gameState.arrows[m.id].removed = true; board.fly(m.id);
      m.by === myId ? A.sfx.pop() : A.sfx.tick();
      const who = room && room.players.find((p) => p.id === m.by);
      $('#olive').textContent = (who ? who.name : '') + ' 得 ' + m.pts + ' 分，剩 ' + m.remaining + ' 支';
    } else { board.shake(m.id, m.blockers); if (m.by === myId) A.sfx.bonk(); }
    if (room) renderSummary();
  }
  function onEnd(m) {
    resultShown = true; clearInterval(countT); $('#count').hidden = true;
    if (room) { room.phase = 'ended'; room.remaining = 0; room.matchDone = m.final; room.round = m.round; }
    const st = m.standings, mine = st.findIndex((r) => r.id === myId);
    const isPlayer = mine >= 0;
    const myPlace = isPlayer ? st[mine].place : 0;
    const topTotal = st[0] ? st[0].total : 0;
    const tied = isPlayer && st.filter((r) => r.place === myPlace).length > 1;
    const won = m.final && isPlayer && myPlace === 1 && topTotal > 0;
    const roundRank = m.rank.findIndex((r) => r.id === myId) + 1;
    $('#orIcon').innerHTML = (m.final ? won : roundRank === 1)
      ? '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" fill="#ffc26b" stroke="#f0a93f" stroke-width="5"/><path d="M26 42l10 10 18-22" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" fill="#c9d6ff" stroke="#8fa6f0" stroke-width="5"/><path d="M28 54q12-12 24 0M29 32h.1M51 32h.1" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>';
    const multiR = m.totalRounds > 1;
    if (m.aborted) { $('#orTitle').textContent = '對手都離開了'; $('#orSub').textContent = '比賽提前結束'; }
    else if (m.final) {
      $('#orTitle').textContent = !isPlayer ? '比賽結束' : won ? (tied ? '並列冠軍！' : '你贏了！') : '第 ' + myPlace + ' 名' + (tied ? '（並列）' : '');
      $('#orSub').textContent = multiR ? '共 ' + m.totalRounds + ' 盤・累計總分' : '單盤決勝';
    } else {
      $('#orTitle').textContent = '第 ' + m.round + '／' + m.totalRounds + ' 盤結束';
      $('#orSub').textContent = (roundRank ? '本盤你是第 ' + roundRank + ' 名・' : '') + '累計排名';
    }
    const ol = $('#orRank'); ol.innerHTML = '';
    st.forEach((r) => {
      const li = document.createElement('li'); li.className = 'p' + Math.min(r.place, 4) + (r.id === myId ? ' me' : '');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.place + '. ' + r.name.replace('電腦·', '') + (r.isAI ? '（電腦）' : '');
      const sc = document.createElement('b'); sc.textContent = multiR ? r.total + ' 分' : r.score + ' 分';
      li.append(nm); if (multiR) { const sm = document.createElement('small'); sm.textContent = '本盤 ' + r.score; li.appendChild(sm); } li.appendChild(sc); ol.appendChild(li);
    });
    (m.final ? won : roundRank === 1) ? (A.sfx.win(), App.confetti($('#oresult'))) : A.sfx.lose();
    const host = isHost();
    $('#orAgain').textContent = m.final ? (local ? '再來一場' : '再來一場（新比賽）') : '下一盤（第 ' + (m.round + 1) + ' 盤）';
    $('#orRoom').textContent = local ? '調整設定' : '回到房間';
    $('#orAgain').disabled = !host; $('#orAgain').setAttribute('aria-disabled', String(!host));
    $('#orNote').textContent = host ? '' : m.final ? '等房主開始新比賽' : '等房主開始下一盤';
    $('#oresult').hidden = false; (host ? $('#orAgain') : $('#orRoom')).focus();
    board.setEnabled(false);
    if (room) renderSummary();
    if (window.AmazeScroll) AmazeScroll.refresh();
  }
  $('#orAgain').onclick = () => { $('#oresult').hidden = true; send({ t: 'start' }); A.unlock(); };
  $('#orRoom').onclick = () => { $('#oresult').hidden = true; $('#boardView').hidden = true; $('#roomScroll').hidden = false; if (room) renderRoomView(); };
  $('#orHome').onclick = () => leaveRoom(true);
  $('#leaveBtn').onclick = () => leaveRoom(false);
  function leaveRoom(home) {
    $('#oresult').hidden = true;
    if (local) { stopLocal(); App.show('home'); return; }
    send({ t: 'leave' });
    if (home) { disconnect(); room = null; App.show('home'); }
  }

  /* ---------- 聊天與側欄 ---------- */
  function addChat(m, live) {
    const log = $('#chatLog'), d = document.createElement('div');
    d.className = 'cl' + (m.sys ? ' sys' : '');
    if (!m.sys) { const n = document.createElement('b'); n.textContent = m.from + (m.role === 'spectator' ? '（觀）' : '') + '：'; d.appendChild(n); }
    d.appendChild(document.createTextNode(m.text)); log.appendChild(d);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    if (live && !m.sys && $('#olayout').dataset.panel === 'closed') { unread++; renderBadge(); }
  }
  function renderBadge() { const b = $('#unread'); b.hidden = !unread; b.textContent = unread > 9 ? '9+' : unread; }
  function setPanel(state) {
    $('#olayout').dataset.panel = state; $('#panelToggle').setAttribute('aria-expanded', String(state === 'open'));
    $('#panelToggle').setAttribute('aria-label', state === 'open' ? '收合資訊與聊天' : '展開資訊與聊天');
    if (state === 'open') { unread = 0; renderBadge(); const l = $('#chatLog'); l.scrollTop = l.scrollHeight; }
  }
  $('#panelToggle').onclick = () => setPanel($('#olayout').dataset.panel === 'open' ? 'closed' : 'open');
  wide.addEventListener('change', () => setPanel(wide.matches ? 'open' : 'closed'));
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chatInput'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; });
  const q = $('#quick'); QUICK.forEach((t) => q.appendChild(btn(t, 'btn mini', () => send({ t: 'chat', text: t }))));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#olayout').closest('[hidden]') && !document.querySelector('.modal:not([hidden])') && $('#oresult').hidden && matchMedia('(max-width:899px), (max-aspect-ratio:1/1)').matches) setPanel('closed'); });

  parseInvite();
  window.__online = { get room() { return room; }, get ws() { return ws; } };
  return { enter, enterLocal };
})();
