/* 線上對戰前端：大廳、房間、對戰、聊天。伺服器為唯一權威，這裡只送意圖、收事件。 */
window.AmazeOnline = (function () {
  const App = window.AmazeApp, $ = App.$, R = window.AmazeRules, A = App.A;
  const board = window.AmazeBoard.create($('#oboard'), { onTap: (id) => { if (canTap()) send({ t: 'tap', id }); } });
  const T = App.T, DNAME = App.dname;
  const QUICK_N = 5;   // 聊天快捷語：chat.q1 ～ chat.q5
  const aiName = (n) => T(n >= 1 && n <= 3 ? 'ai.' + n : 'ai.n', { n });   // 電腦名稱依語言翻譯（伺服器只送編號）
  const aiShort = (n) => aiName(n).split(/[·\s]+/).pop();
  const pname = (p) => (p.isAI ? aiName(p.aiN) : p.name);
  const cut = (s, n) => Array.from(String(s)).slice(0, n).join('');
  let autoIdx = null;
  // 使用者沒填暱稱時，由前端依目前語言產生可愛名字（每次造訪固定）；伺服器只儲存、不翻譯
  const myNick = () => {
    if (App.nick) return App.nick;
    if (!autoIdx) autoIdx = [Math.floor(Math.random() * 8), Math.floor(Math.random() * 8)];
    return T('nick.join', { a: T('adj.' + autoIdx[0]), b: T('ani.' + autoIdx[1]) });
  };
  const PCOLORS = ['#ff8fb1', '#7fd6c2', '#ffc26b', '#8fc7ff'];

  let ws = null, myId = null, room = null, gameState = null, startLocal = 0, wantOpen = false, tries = 0, retryT = null, coldT = null, countT = null;
  let local = false, hub = null, lc = null, invite = null, unread = 0, chatInit = false, lastRooms = [], resultShown = false, joined = false;
  let statusFn = null, statusBad = false, inviteErrCode = '', chatMsgs = [], lastEnd = null;
  const wide = matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)');

  /* ---------- 連線 ---------- */
  function wsUrl() {
    let base = (window.AMAZE_CONFIG || {}).serverUrl || '';
    if (!base || /^__/.test(base)) base = location.origin;
    const u = new URL(base); // 格式不對會丟錯 → 由 connect 轉成可讀錯誤
    if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('server URL must be http(s)'), { i18n: 'net.urlProto' });
    if (location.protocol === 'https:' && u.protocol === 'http:' && u.hostname !== 'localhost') throw Object.assign(new Error('HTTPS page needs an HTTPS server'), { i18n: 'net.https' });
    return u.origin.replace(/^http/, 'ws') + '/ws';
  }
  // 狀態文字以函式保存（切換語言時重新組字）；傳 null 代表清除
  function setStatus(fn, bad) { statusFn = fn || null; statusBad = !!bad; paintStatus(); }
  function paintStatus() { const e = $('#netStatus'), t = statusFn ? statusFn() : ''; e.textContent = t; e.classList.toggle('bad', statusBad); e.hidden = !t; }
  const stKey = (k, p) => () => T(k, p);
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (location.protocol === 'file:') return setStatus(stKey('net.file'), true);
    let url; try { url = wsUrl(); } catch (e) { return setStatus(() => T('net.badUrl', { msg: e.i18n ? T(e.i18n) : e.message }), true); }
    setStatus(stKey('net.connecting'));
    clearTimeout(coldT); coldT = setTimeout(() => { if (!ws || ws.readyState !== 1) setStatus(stKey('net.waking')); }, 3000);
    ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0; clearTimeout(coldT); setStatus(null);
      const NL = window.NetworkLatency;
      if (NL) { NL.setProbe(() => send({ t: 'ping', ts: Date.now() })); NL.setActive(true); }
      let rid = null; try { rid = sessionStorage.getItem('amaze.cid'); } catch (e) {}
      send({ t: 'hello', name: myNick(), resumeId: rid });
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = () => {
      clearTimeout(coldT);
      if (window.NetworkLatency) window.NetworkLatency.report(null);
      if (!wantOpen) return;
      setStatus(stKey('net.lost'), true);
      clearTimeout(retryT); retryT = setTimeout(connect, Math.min(1000 * 2 ** tries++, 8000));
    };
    ws.onerror = () => {};
  }
  function send(o) {
    if (local) { if (hub && lc) hub.handle(lc, JSON.parse(JSON.stringify(o))); return; }
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); GameAnalytics.roomRequest(o); }
  }
  function disconnect() { if (window.NetworkLatency) window.NetworkLatency.setActive(false); wantOpen = false; clearTimeout(retryT); if (ws) { ws.close(); ws = null; } }

  /* ---------- 進出 ---------- */
  // 對電腦對戰：在瀏覽器內跑同一個 Hub（計分、電腦、多盤規則與線上完全相同），不需要連線
  function enterLocal() {
    stopLocal(); disconnect();
    local = true; room = null; gameState = null; joined = false; chatInit = false;
    $('#online').dataset.local = '1';
    const mine = hub = new window.AmazeHub.Hub();
    lc = hub.connect((o) => { const m = JSON.parse(JSON.stringify(o)); queueMicrotask(() => { if (hub === mine) onMsg(m); }); });
    hub.handle(lc, { t: 'hello', name: myNick() });
    hub.handle(lc, { t: 'create', name: T('room.local'), diff: 'easy', rounds: 3 });
    hub.handle(lc, { t: 'config', addAI: 'easy' });
  }
  function stopLocal() {
    if (hub) { const h = hub; hub = null; lc = null; h.stop(); }
    local = false; delete $('#online').dataset.local;
    clearInterval(countT); $('#oresult').hidden = true; room = null; gameState = null; lastEnd = null; chatMsgs = [];
  }
  function enter() {
    stopLocal(); wantOpen = true; App.show('lobby'); $('#nickInput').value = App.nick; renderRooms(); connect();
  }
  function toLobby(msg) {   // msg 為已翻譯的文字
    room = null; gameState = null; joined = false; chatInit = false; resultShown = false; lastEnd = null; chatMsgs = [];
    $('#oresult').hidden = true; App.show('lobby'); renderRooms(); if (msg) toast(msg);
    send({ t: 'rooms' });
  }
  function toast(t) {
    let e = $('#toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; e.className = 'toast'; e.setAttribute('role', 'status'); document.body.appendChild(e); }
    e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 3500);
  }

  /* ---------- 收訊息 ---------- */
  function onMsg(m) {
    if (!local) GameAnalytics.roomResponse(m.t, m.t === 'room');
    switch (m.t) {
      case 'pong': if (!local && window.NetworkLatency) window.NetworkLatency.report(Date.now() - m.ts); break;
      case 'welcome':
        myId = m.id; if (!local) try { sessionStorage.setItem('amaze.cid', m.id); } catch (e) {}
        if (!m.resumed && room) toLobby(T('toast.reset'));
        break;
      case 'rooms': if (!local) { lastRooms = m.rooms; renderRooms(); } break;
      case 'room': onRoom(m); break;
      case 'game': onGame(m); break;
      case 'move': onMove(m); break;
      case 'late': board.late(m.id); break;
      case 'end': onEnd(m); break;
      case 'chat': addChat(m, true); break;
      case 'notice': toast(T('notice.' + m.code)); break;
      case 'closed': if (local) { stopLocal(); App.show('home'); } else toLobby(T('closed.prefix', { r: closedText(m.reason) })); break;
      case 'left': if (local) { stopLocal(); App.show('home'); } else toLobby(); break;
      case 'kicked': toast(T('toast.kicked')); break;
      case 'error': onError(m); break;
    }
  }
  const closedText = (c) => { const k = 'closed.' + c; const v = T(k); return v === k ? String(c || '') : v; };
  function onError(m) {
    if (invite && !joined) { inviteErrCode = m.code; paintInviteErr(); return; }
    toast(T('err.' + m.code));
  }
  function paintInviteErr() { $('#inviteErr').textContent = inviteErrCode ? T('err.' + inviteErrCode) : ''; }

  /* ---------- 大廳 ---------- */
  function renderRooms() {
    const ul = $('#roomList'); ul.innerHTML = '';
    if (!lastRooms.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = T('rooms.empty'); ul.appendChild(li); return; }
    lastRooms.forEach((r) => {
      const li = document.createElement('li'); li.className = 'roomRow';
      const info = document.createElement('div'); info.className = 'rinfo';
      const nm = document.createElement('b'); nm.textContent = r.name;
      const sub = document.createElement('span'); sub.textContent = T('rooms.seats', { d: DNAME(r.diff), p: r.players, m: r.max }) + (r.ais ? T('rooms.ais', { n: r.ais }) : '') + (r.spectators ? T('rooms.spec', { n: r.spectators }) : '') + T('common.sep') + (r.phase === 'playing' ? T('rooms.playing') : T('rooms.waiting'));
      info.append(nm, sub);
      const full = r.players >= r.max || r.phase === 'playing';
      const join = btn(full ? T('rooms.full') : T('rooms.join'), 'btn small' + (full ? '' : ' primary'), () => joinRoom(r.id, 'player'));
      join.disabled = full;
      const watch = btn(T('rooms.watch'), 'btn small', () => joinRoom(r.id, 'spectator'));
      li.append(info, join, watch); ul.appendChild(li);
    });
  }
  function btn(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = fn; return b; }
  function syncNick() { const v = $('#nickInput').value.trim().slice(0, 12); App.nick = v; return v; }
  function joinRoom(id, want) { send({ t: 'join', room: id, want, name: syncNick() || myNick() }); }
  $('#nickInput').addEventListener('change', () => { syncNick(); send({ t: 'rename', name: myNick() }); });
  $('#quickBtn').onclick = () => {
    const r = lastRooms.find((x) => x.phase !== 'playing' && x.players < x.max);
    if (r) joinRoom(r.id, 'player');
    else { syncNick(); send({ t: 'create', name: App.nick ? T('room.ofName', { n: App.nick }) : T('room.quick'), diff: 'easy', rounds: 3 }); send({ t: 'config', addAI: 'easy' }); }
  };
  $('#lobbyBack').onclick = () => { disconnect(); invite = null; App.show('home'); };
  const roundItems = () => [1, 2, 3, 4, 5].map((n) => [n, T('rounds.chip', { n })]);
  // 建房
  let cmDiff = 'easy', cmRounds = 3;
  function renderCm() {
    App.chipGroup($('#cmDiff'), App.DIFF_ITEMS, cmDiff, (v) => { cmDiff = v; renderCm(); });
    App.chipGroup($('#cmRounds'), roundItems(), cmRounds, (v) => { cmRounds = v; renderCm(); });
  }
  $('#createBtn').onclick = () => { renderCm(); App.open($('#createModal')); };
  $('#cmGo').onclick = () => { syncNick(); send({ t: 'create', name: $('#cmName').value.trim() || T('room.ofName', { n: myNick() }), diff: cmDiff, rounds: cmRounds }); App.close(); };

  // 邀請連結：先停在大廳，由使用者確認暱稱才加入
  function parseInvite() {
    const q = new URLSearchParams(location.search);
    if (!q.get('room') || !q.get('invite')) return;
    invite = { room: q.get('room').toUpperCase().slice(0, 8), token: q.get('invite'), as: q.get('as') === 'watch' ? 'watch' : 'play' };
    wantOpen = true; App.show('lobby'); connect();
    $('#inviteBox').hidden = false;
    renderInvite();
    $('#inviteNick').value = App.nick;
    renderRooms();
  }
  function renderInvite() {
    if (!invite) return;
    $('#inviteTitle').textContent = T('invite.title', { room: invite.room });
    $('#inviteRole').textContent = invite.as === 'watch' ? T('invite.watch') : T('invite.play');
    paintInviteErr();
  }
  $('#inviteGo').onclick = () => {
    const name = $('#inviteNick').value.trim().slice(0, 12); App.nick = name; inviteErrCode = ''; paintInviteErr();
    send({ t: 'join', room: invite.room, token: invite.token, want: invite.as === 'watch' ? 'spectator' : 'player', name: name || myNick() });
  };

  /* ---------- 房間快照 ---------- */
  function setBoardVisible(visible) {
    $('#boardView').hidden = !visible; $('#roomScroll').hidden = visible;
    $('#otimer').hidden = !visible;
    $('#online').classList.toggle('showing-board', visible);
  }

  function onRoom(m) {
    const first = !room || room.id !== m.id;
    room = m;
    if (first) {
      joined = true; chatInit = false; resultShown = false; unread = 0;
      if (invite) { history.replaceState(null, '', location.pathname); invite = null; $('#inviteBox').hidden = true; }
      App.show('online'); setPanel(wide.matches ? 'open' : 'closed');
    }
    if (!chatInit) { $('#chatLog').innerHTML = ''; chatMsgs = []; (m.chat || []).forEach((c) => addChat(c, false)); chatInit = true; }
    renderTitle();
    renderSummary();
    const playing = m.phase === 'playing';
    const showBoard = playing || (m.phase === 'ended' && resultShown);   // 結算畫面期間停留在棋盤，按「下一盤」才不會閃回房間
    setBoardVisible(showBoard);
    if (!showBoard) renderRoomView();
    board.setEnabled(canTap());
  }
  function renderTitle() { if (room) $('#roomTitle').textContent = local ? T('room.local') : room.name + T('common.sep') + room.id; }
  const me = () => room && room.players.find((p) => p.id === myId);
  const isHost = () => room && room.hostId === myId;
  const canTap = () => room && room.role === 'player' && room.phase === 'playing' && Date.now() >= startLocal;

  const multi = () => room && room.totalRounds > 1;
  const cumOf = (p) => (room.phase === 'playing' ? p.total + p.score : p.total);
  function roundText() { return room.round > 0 ? T('round.cur', { r: room.round, t: room.totalRounds }) : T('round.total', { t: room.totalRounds }); }
  function renderSummary() {
    const sum = $('#sum'); sum.innerHTML = '';
    const head = document.createElement('div'); head.className = 'shead';
    const sep = T('common.sep');
    head.textContent = roundText() + sep + DNAME(room.diff) + (room.phase === 'playing' ? sep + T('sum.left', { n: room.remaining }) : room.phase === 'ended' ? sep + T(room.matchDone ? 'sum.matchDone' : 'sum.roundDone') : '');
    sum.appendChild(head);
    const key = (p) => (multi() ? cumOf(p) * 1000 + p.score : p.score);
    const sorted = room.players.map((p, i) => ({ ...p, i })).sort((a, b) => key(b) - key(a));
    sorted.forEach((p) => {
      const row = document.createElement('div'); row.className = 'srow' + (p.id === myId ? ' me' : '');
      const dot = document.createElement('i'); dot.style.background = PCOLORS[p.i % 4];
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = pname(p) + (p.isAI ? T('paren', { x: DNAME(p.diff) }) : '') + (p.connected ? '' : T('paren', { x: T('sum.offline') }));
      const sc = document.createElement('b'); sc.textContent = multi() ? T('sum.total', { n: cumOf(p) }) : p.score;
      row.append(dot, nm);
      if (multi() && room.round > 0) { const rs = document.createElement('small'); rs.textContent = T('sum.round', { n: p.score }); row.appendChild(rs); }
      row.appendChild(sc); sum.appendChild(row);
    });
    if (!local) { const sp = document.createElement('div'); sp.className = 'sfoot'; sp.textContent = (room.role === 'spectator' ? T('sum.you') : '') + T('sum.watchers', { n: room.spectators.length }); sum.appendChild(sp); }
    const ms = $('#miniScores'); ms.innerHTML = '';
    sorted.forEach((p) => { const c = document.createElement('span'); c.className = 'mchip' + (p.id === myId ? ' me' : ''); c.style.borderColor = PCOLORS[p.i % 4]; c.textContent = cut(p.isAI ? aiShort(p.aiN) : p.name, window.I18N.lang === 'en' ? 7 : 4) + ' ' + (multi() ? cumOf(p) : p.score); ms.appendChild(c); });
  }

  /* ---------- 房間內（等待）畫面 ---------- */
  function renderRoomView() {
    const v = $('#roomView'); v.innerHTML = '';
    const host = isHost();
    const seats = document.createElement('div'); seats.className = 'seats';
    const locked = !room.matchDone;   // 比賽進行中：設定鎖定
    const seg = (current, label, onPick) => {
      const d = document.createElement('div'); d.className = 'seg'; d.setAttribute('role', 'radiogroup'); d.setAttribute('aria-label', label);
      Object.keys(R.DIFFICULTIES).forEach((k) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.v = k; b.textContent = T('diffShort.' + k);
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === current)); b.setAttribute('aria-label', DNAME(k));
        b.onclick = () => { A.sfx.tick(); onPick(k); }; d.appendChild(b);
      });
      return d;
    };
    room.players.forEach((p, i) => {
      const s = document.createElement('div'); s.className = 'seat' + (p.isAI ? ' ai' : ''); s.style.borderColor = PCOLORS[i % 4];
      const av = document.createElement('i'); av.className = 'av'; av.style.background = PCOLORS[i % 4]; av.textContent = p.isAI ? T('seat.aiAv') : cut(p.name || '?', 1); s.appendChild(av);
      const nm = document.createElement('b'); nm.textContent = pname(p); s.appendChild(nm);
      const tag = document.createElement('span'); tag.className = 'tag';
      const sep = T('common.sep');
      tag.textContent = (local ? (p.isAI ? T('seat.ai', { d: DNAME(p.diff) }) : T('seat.you')) : (p.host ? T('seat.host') : p.isAI ? T('seat.ai', { d: DNAME(p.diff) }) : T('seat.player')) + (p.id === myId ? sep + T('seat.you') : '')) + (multi() && !room.matchDone ? sep + T('sum.total', { n: p.total }) : ''); s.appendChild(tag);
      if (host && p.isAI && !locked) {
        s.appendChild(seg(p.diff, T('seat.aiDiff'), (d) => send({ t: 'config', aiDiff: { id: p.id, diff: d } })));
        const x = btn('✕', 'seatX', () => send({ t: 'config', removeAI: p.id })); x.setAttribute('aria-label', T('seat.remove')); x.title = T('seat.remove'); s.classList.add('hasX'); s.appendChild(x);
      }
      if (host && !p.isAI && p.id !== myId) s.appendChild(btn(T('seat.kick'), 'btn mini', () => send({ t: 'kick', id: p.id })));
      seats.appendChild(s);
    });
    for (let i = room.players.length; i < room.max; i++) {
      const s = document.createElement('div'); s.className = 'seat empty';
      if (host && !locked) {
        const t = document.createElement('b'); t.textContent = T('seat.addBot'); s.appendChild(t);
        const sub = document.createElement('span'); sub.className = 'tag'; sub.textContent = T('seat.addHint'); s.appendChild(sub);
        s.appendChild(seg(null, T('seat.addAria'), (d) => send({ t: 'config', addAI: d })));
      } else s.textContent = T('seat.empty');
      seats.appendChild(s);
    }
    v.appendChild(seats);

    if (host && locked) { const n = document.createElement('p'); n.className = 'note'; n.textContent = T('room.locked', { r: roundText(), t: room.totalRounds }); v.appendChild(n); }
    if (host && !locked) {
      const cfg = document.createElement('div'); cfg.className = 'cfg';
      const l1 = document.createElement('h3'); l1.textContent = T('room.cfgDiff');
      const g1 = document.createElement('div'); g1.className = 'chips'; g1.setAttribute('role', 'radiogroup');
      App.chipGroup(g1, App.DIFF_ITEMS, room.diff, (d) => send({ t: 'config', diff: d }));
      const l5 = document.createElement('h3'); l5.textContent = T('room.cfgRounds');
      const g5 = document.createElement('div'); g5.className = 'chips'; g5.setAttribute('role', 'radiogroup');
      App.chipGroup(g5, roundItems(), room.totalRounds, (n) => send({ t: 'config', rounds: n }));
      cfg.append(l1, g1, l5, g5); v.appendChild(cfg);
    }
    if (host && !local) {
      const inv = document.createElement('div'); inv.className = 'invites';
      const l4 = document.createElement('h3'); l4.textContent = T('room.invites'); inv.appendChild(l4);
      const urlOf = (role) => { const it = (room.invites || []).find((x) => x.role === role); return it ? location.origin + location.pathname + '?room=' + room.id + '&invite=' + it.token + '&as=' + role : ''; };
      [['play', T('room.invPlay')], ['watch', T('room.invWatch')]].forEach(([role, label]) => {
        const url = urlOf(role); if (!url) return;
        const li = document.createElement('div'); li.className = 'inv';
        const nm = document.createElement('b'); nm.textContent = label;
        const u = document.createElement('div'); u.className = 'invUrl'; u.textContent = url; u.title = url; u.tabIndex = 0;
        u.addEventListener('click', () => { const r = document.createRange(); r.selectNodeContents(u); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
        li.append(nm, u, btn(T('room.copy'), 'btn small', () => copy(url)));
        inv.appendChild(li);
      });
      const row = document.createElement('div'); row.className = 'irow';
      row.appendChild(btn(T('room.regen'), 'btn small ghost', () => { send({ t: 'invite', role: 'play', action: 'create' }); send({ t: 'invite', role: 'watch', action: 'create' }); toast(T('toast.regen')); }));
      inv.appendChild(row);
      v.appendChild(inv);
    }
    if (!host) { const n = document.createElement('p'); n.className = 'note'; n.textContent = T('room.matchInfo', { d: DNAME(room.diff), t: room.totalRounds }); v.appendChild(n); }
    const act = document.createElement('div'); act.className = 'row';
    if (room.role === 'spectator' && room.players.length < room.max) act.appendChild(btn(T('room.sit'), 'btn', () => send({ t: 'sit' })));
    if (host) { const st = btn(locked ? T('room.startN', { n: room.round + 1 }) : room.phase === 'ended' ? T('room.again') : T('room.start'), 'btn primary big', () => { send({ t: 'start' }); A.unlock(); }); st.disabled = room.players.length < 2; act.appendChild(st); if (room.players.length < 2) { const n = document.createElement('p'); n.className = 'note'; n.textContent = T('room.needTwo'); v.appendChild(n); } }
    else { const w = document.createElement('p'); w.className = 'note'; w.textContent = room.role === 'spectator' ? T('room.specNote') : T('room.waitHost'); act.appendChild(w); }
    v.appendChild(act);
  }
  function copy(text) {
    const done = () => toast(T('toast.copied'));
    const manual = () => { const i = $('#copyText'); i.value = text; App.open($('#copyModal')); i.focus(); i.select(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
    else manual();
  }

  /* ---------- 對戰 ---------- */
  function onGame(m) {
    if (room && room.role === 'player') GameAnalytics.start({ mode: local ? 'ai' : 'online', difficulty: room.diff, players: room.players.length }, room.id + '|' + m.startAt);
    const st = m.state; st.arrows.forEach((a) => { a.removed = !!a.removed; });
    gameState = st; resultShown = false;
    $('#oresult').hidden = true;
    startLocal = m.startAt + (Date.now() - m.serverNow);
    board.draw(st); board.setEnabled(false); $('#oprogFill').style.width = '0%';
    setBoardVisible(true);
    otStop(); $('#otimerText').textContent = App.fmtTime(0);
    runCountdown();
  }
  let otT = 0;
  function otStart() { clearInterval(otT); const tk = () => { $('#otimerText').textContent = App.fmtTime(Math.max(0, Date.now() - startLocal)); }; tk(); otT = setInterval(tk, 10); }
  function otStop(final) { clearInterval(otT); if (final) $('#otimerText').textContent = App.fmtTime(Math.max(0, Date.now() - startLocal)); }
  function runCountdown() {
    clearInterval(countT);
    const el = $('#count'), text = $('#countText');
    const tick = () => {
      const left = startLocal - Date.now();
      if (left <= 0) { clearInterval(countT); otStart(); text.textContent = T('count.go'); el.hidden = false; board.setEnabled(canTap()); A.sfx.tick(); setTimeout(() => { el.hidden = true; }, 600); return; }
      const n = Math.ceil(left / 1000); if (text.textContent !== String(n)) A.sfx.tick();
      text.textContent = n; el.hidden = false;
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
      $('#olive').textContent = T('live.score', { who: who ? pname(who) : '', p: m.pts, n: m.remaining });
    } else { board.shake(m.id, m.blockers); if (m.by === myId) A.sfx.bonk(); }
    if (room) renderSummary();
  }
  function onEnd(m) {
    if (room && room.role === 'player') GameAnalytics.end({ result: 'complete' });
    resultShown = true; clearInterval(countT); otStop(true); $('#count').hidden = true;
    setBoardVisible(true);
    if (room) { room.phase = 'ended'; room.remaining = 0; room.matchDone = m.final; room.round = m.round; }
    lastEnd = m;
    const good = paintEnd(m);
    good ? (A.sfx.win(), App.confetti($('#oresult'))) : A.sfx.lose();
    $('#oresult').hidden = false; (isHost() ? $('#orAgain') : $('#orRoom')).focus();
    board.setEnabled(false);
    if (room) renderSummary();
    if (window.AmazeScroll) AmazeScroll.refresh();
  }
  // 結算內容（切換語言時可重繪）；回傳是否為「贏」的畫面
  function paintEnd(m) {
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
    if (m.aborted) { $('#orTitle').textContent = T('or.abortT'); $('#orSub').textContent = T('or.abortS'); }
    else if (m.final) {
      $('#orTitle').textContent = !isPlayer ? T('or.over') : won ? (tied ? T('or.tied') : T('or.won')) : T('or.place', { n: myPlace }) + (tied ? T('paren', { x: T('or.tiedTag') }) : '');
      $('#orSub').textContent = multiR ? T('or.multi', { t: m.totalRounds }) : T('or.single');
    } else {
      $('#orTitle').textContent = T('or.roundEnd', { r: m.round, t: m.totalRounds });
      $('#orSub').textContent = (roundRank ? T('or.myRound', { n: roundRank }) : '') + T('or.cum');
    }
    const ol = $('#orRank'); ol.innerHTML = '';
    st.forEach((r) => {
      const li = document.createElement('li'); li.className = 'p' + Math.min(r.place, 4) + (r.id === myId ? ' me' : '');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.place + '. ' + (r.isAI ? aiShort(r.aiN) + T('paren', { x: T('or.aiTag') }) : r.name);
      const sc = document.createElement('b'); sc.textContent = T('or.pts', { n: multiR ? r.total : r.score });
      li.append(nm); if (multiR) { const sm = document.createElement('small'); sm.textContent = T('sum.round', { n: r.score }); li.appendChild(sm); } li.appendChild(sc); ol.appendChild(li);
    });
    const host = isHost();
    $('#orAgain').textContent = m.final ? (local ? T('room.again') : T('or.againFinal')) : T('or.next', { n: m.round + 1 });
    $('#orRoom').textContent = local ? T('or.adjust') : T('room.toRoom');
    $('#orAgain').disabled = !host; $('#orAgain').setAttribute('aria-disabled', String(!host));
    $('#orNote').textContent = host ? '' : m.final ? T('or.waitNew') : T('or.waitNext');
    return m.final ? won : roundRank === 1;
  }
  $('#orAgain').onclick = () => { $('#oresult').hidden = true; send({ t: 'start' }); A.unlock(); };
  $('#orRoom').onclick = () => { resultShown = false; $('#oresult').hidden = true; setBoardVisible(false); if (room) renderRoomView(); };
  $('#orHome').onclick = () => leaveRoom(true);
  $('#leaveBtn').onclick = () => leaveRoom(false);
  function leaveRoom(home) {
    $('#oresult').hidden = true;
    if (local) { stopLocal(); App.show('home'); return; }
    send({ t: 'leave' });
    if (home) { disconnect(); room = null; App.show('home'); }
  }

  /* ---------- 聊天與側欄 ---------- */
  // 系統訊息只收代碼與參數（m.k／m.p），依目前語言組句；玩家聊天內容原樣顯示、不翻譯
  function sysText(m) {
    const p = m.p || {};
    if (m.k === 'aiAdd') return T('sys.aiAdd', { name: aiName(p.n), d: DNAME(p.d) });
    if (m.k === 'aiRemove') return T('sys.aiRemove', { name: aiName(p.n) });
    return T('sys.' + m.k, p);
  }
  function chatLine(m) {
    const d = document.createElement('div');
    d.className = 'cl' + (m.sys ? ' sys' : '');
    if (!m.sys) { const n = document.createElement('b'); n.textContent = m.from + (m.role === 'spectator' ? T('chat.spec') : '') + T('common.colon'); d.appendChild(n); }
    d.appendChild(document.createTextNode(m.sys ? sysText(m) : m.text));
    return d;
  }
  function renderChat() {
    const log = $('#chatLog'); log.innerHTML = '';
    chatMsgs.forEach((m) => log.appendChild(chatLine(m)));
    log.scrollTop = log.scrollHeight;
  }
  function addChat(m, live) {
    chatMsgs.push(m); while (chatMsgs.length > 80) chatMsgs.shift();
    const log = $('#chatLog');
    log.appendChild(chatLine(m));
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    if (live && !m.sys && $('#olayout').dataset.panel === 'closed') { unread++; renderBadge(); }
  }
  function renderBadge() { const b = $('#unread'); b.hidden = !unread; b.textContent = unread > 9 ? '9+' : unread; }
  function setPanel(state) {
    $('#olayout').dataset.panel = state; $('#panelToggle').setAttribute('aria-expanded', String(state === 'open'));
    $('#panelToggle').setAttribute('aria-label', T(state === 'open' ? 'room.panelClose' : 'room.panelOpen'));
    if (state === 'open') { unread = 0; renderBadge(); const l = $('#chatLog'); l.scrollTop = l.scrollHeight; }
  }
  $('#panelToggle').onclick = () => setPanel($('#olayout').dataset.panel === 'open' ? 'closed' : 'open');
  wide.addEventListener('change', () => setPanel(wide.matches ? 'open' : 'closed'));
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chatInput'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; });
  function renderQuick() {
    const q = $('#quick'); q.innerHTML = '';
    for (let i = 1; i <= QUICK_N; i++) { const t = T('chat.q' + i); q.appendChild(btn(t, 'btn mini', () => send({ t: 'chat', text: t }))); }
  }
  renderQuick();
  // 切換語言：重繪目前看得到的所有動態文字（大廳列表、房間、聊天、結算），不動遊戲狀態
  window.I18N.onChange(() => {
    paintStatus(); renderRooms(); renderInvite(); renderQuick(); renderChat();
    if (!$('#createModal').hidden) renderCm();
    if (room) {
      renderTitle(); renderSummary(); setPanel($('#olayout').dataset.panel);
      if (!$('#roomScroll').hidden) renderRoomView();
      if (lastEnd && !$('#oresult').hidden) paintEnd(lastEnd);
    }
    if (window.AmazeScroll) AmazeScroll.refresh();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#olayout').closest('[hidden]') && !document.querySelector('.modal:not([hidden])') && $('#oresult').hidden && matchMedia('(max-width:899px), (max-aspect-ratio:1/1)').matches) setPanel('closed'); });

  parseInvite();
  window.__online = { get room() { return room; }, get ws() { return ws; } };
  return { enter, enterLocal };
})();
