/* 線上房間中樞：房間生命週期、角色權限、邀請、搶飛計分、電腦對手、聊天。
   與傳輸層分離：Hub 只要求 client.send(obj)；server.js 把 ws 接上來。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'), require('crypto'));
  else root.AmazeHub = factory(root.AmazeRules, null);
})(typeof self !== 'undefined' ? self : this, function (R, nodeCrypto) {

const GRACE_MS = 30000;            // 斷線寬限：超過就視為離開
const COUNTDOWN_MS = 3000;
const INVITE_TTL_MS = 6 * 3600e3;  // 邀請 6 小時過期（也隨房間關閉失效）
const MAX_SPECTATORS = 20;
const MAX_SEATS = 3;               // 每個房間固定最多 3 位玩家（真人＋電腦），不開放設定
const ADJ = ['開心', '勇敢', '好奇', '貪睡', '閃亮', '軟綿綿', '圓滾滾', '機靈'];
const ANI = ['小貓', '小狗', '兔兔', '企鵝', '小熊', '狐狸', '鴨鴨', '刺蝟'];
const AI_NAMES = ['電腦·糰子', '電腦·年糕', '電腦·布丁'];
const AI_PARAMS = { // 反應延遲(ms)、失誤率、是否貪心挑長箭頭
  toddler: { delay: [3500, 6000], miss: 0.35, greedy: false },
  easy: { delay: [2000, 3500], miss: 0.2, greedy: false },
  normal: { delay: [1000, 2000], miss: 0.08, greedy: false },
  hard: { delay: [450, 1000], miss: 0.02, greedy: true },
  myth: { delay: [200, 500], miss: 0, greedy: true },
};

function bytes(n) {
  if (nodeCrypto) return [...nodeCrypto.randomBytes(n)];
  const a = new Uint8Array(n); (self.crypto || window.crypto).getRandomValues(a); return [...a];
}
const hex = (n) => bytes(n).map((b) => b.toString(16).padStart(2, '0')).join('');
const rid = () => hex(8);
const tok = () => hex(10);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const randName = () => pick(ADJ) + pick(ANI);
function cleanName(n) {
  n = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').trim().slice(0, 12);
  return n || randName();
}
function cleanText(t) { return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80); }

class Hub {
  constructor(opts = {}) {
    this.clients = new Map();   // clientId -> client
    this.rooms = new Map();
    this.closed = new Map();    // 已關閉房號（防復活）
    this.now = opts.now || Date.now;
    this.countdown = opts.countdownMs == null ? COUNTDOWN_MS : opts.countdownMs;
    this.grace = opts.graceMs == null ? GRACE_MS : opts.graceMs;
    this.aiScale = opts.aiScale == null ? 1 : opts.aiScale; // 測試用：加速電腦
    this.sweep = setInterval(() => this.cleanup(), 60000); this.sweep.unref && this.sweep.unref();
  }
  stop() { clearInterval(this.sweep); for (const r of [...this.rooms.values()]) this.closeRoom(r, 'shutdown'); }
  cleanup() { const t = this.now(); for (const [k, v] of this.closed) if (t - v > 3600e3) this.closed.delete(k); }

  /* ---------- 連線 ---------- */
  connect(send) {
    const c = { id: rid(), send, name: randName(), roomId: null, connected: true, leaveTimer: null, chatTimes: [] };
    this.clients.set(c.id, c);
    c.send({ t: 'welcome', id: c.id, name: c.name });
    return c;
  }
  resume(c, oldId) {
    const old = this.clients.get(oldId);
    if (!old || old === c || old.connected) return false;
    clearTimeout(old.leaveTimer); old.leaveTimer = null;
    old.send = c.send; old.connected = true;
    this.clients.delete(c.id); c.alias = old;
    c.send({ t: 'welcome', id: old.id, name: old.name, resumed: true });
    const room = old.roomId && this.rooms.get(old.roomId);
    if (room) { this.snapshotAll(room); if (room.phase === 'playing') this.sendGame(room, old); }
    return old;
  }
  disconnect(c) {
    if (c.alias) c = c.alias;
    c.connected = false; c.send = () => {};
    const room = c.roomId && this.rooms.get(c.roomId);
    if (!room) { this.clients.delete(c.id); return; }
    this.snapshotAll(room);
    c.leaveTimer = setTimeout(() => { this.leave(c); this.clients.delete(c.id); }, this.grace);
    c.leaveTimer.unref && c.leaveTimer.unref();
  }

  /* ---------- 訊息分派 ---------- */
  handle(c, m) {
    if (c.alias) c = c.alias;
    if (!m || typeof m.t !== 'string') return;
    const f = this['on_' + m.t];
    if (f) f.call(this, c, m);
  }
  err(c, code, msg) { c.send({ t: 'error', code, msg }); }
  on_hello(c, m) {
    if (m.resumeId) { const o = this.resume(c, String(m.resumeId)); if (o) { if (m.name) o.name = cleanName(m.name); return; } }
    if (m.name) c.name = cleanName(m.name);
    c.send({ t: 'rooms', rooms: this.list() });
  }
  on_rooms(c) { c.send({ t: 'rooms', rooms: this.list() }); }
  on_rename(c, m) { c.name = cleanName(m.name); const r = this.roomOf(c); if (r) { const mem = r.members.get(c.id); mem.name = c.name; this.snapshotAll(r); } }

  list() {
    return [...this.rooms.values()].map((r) => ({
      id: r.id, name: r.name, diff: r.diff, max: r.max, phase: r.phase, rounds: r.totalRounds,
      players: this.seats(r), ais: r.ais.length, spectators: this.spectatorCount(r),
    }));
  }
  broadcastList() { for (const c of this.clients.values()) if (c.connected && !c.roomId) c.send({ t: 'rooms', rooms: this.list() }); }
  /** 大廳「在線人數」用：連線中的人（不含斷線寬限期內的）、真人玩家、觀戰者、房外等候者、房間數 */
  presence() {
    let online = 0, lobby = 0, players = 0, spectators = 0;
    for (const c of this.clients.values()) { if (!c.connected) continue; online++; if (!c.roomId) lobby++; }
    for (const r of this.rooms.values()) { players += this.humans(r).length; spectators += this.spectatorCount(r); }
    return { online, players, spectators, lobby, rooms: this.rooms.size };
  }
  roomOf(c) { return c.roomId ? this.rooms.get(c.roomId) : null; }
  humans(r) { return [...r.members.values()].filter((m) => m.role === 'player'); }
  seats(r) { return this.humans(r).length + r.ais.length; }
  spectatorCount(r) { return [...r.members.values()].filter((m) => m.role === 'spectator').length; }

  /* ---------- 房間 ---------- */
  newCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) { let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; if (!this.rooms.has(s) && !this.closed.has(s)) return s; }
  }
  on_create(c, m) {
    if (c.roomId) return this.err(c, 'IN_ROOM', '請先離開目前的房間');
    const diff = R.DIFFICULTIES[m.diff] ? m.diff : 'easy';
    const max = MAX_SEATS;
    const r = {
      id: this.newCode(), name: cleanText(m.name).slice(0, 14) || (c.name + '的房間'), hostId: c.id, diff, max,
      phase: 'lobby', round: 0, totalRounds: Math.min(5, Math.max(1, (m.rounds | 0) || 3)), matchDone: true, totals: new Map(),
      members: new Map(), ais: [], scores: new Map(), invites: new Map(),
      chat: [], state: null, startAt: 0, timers: new Set(), lastResult: null,
    };
    this.rooms.set(r.id, r);
    this.addMember(r, c, 'player');
    this.newInvite(r, 'play'); this.newInvite(r, 'watch');
    this.snapshotAll(r); this.broadcastList();
  }
  newInvite(r, role) {
    for (const [k, v] of r.invites) if (v.role === role) r.invites.delete(k);
    const t = tok(); r.invites.set(t, { role, exp: this.now() + INVITE_TTL_MS }); return t;
  }
  addMember(r, c, role) {
    c.roomId = r.id;
    r.members.set(c.id, { id: c.id, name: c.name, role });
    if (role === 'player' && !r.scores.has(c.id)) r.scores.set(c.id, 0);
  }
  on_join(c, m) {
    if (c.roomId) return this.err(c, 'IN_ROOM', '請先離開目前的房間');
    const code = String(m.room || '').toUpperCase();
    const r = this.rooms.get(code);
    if (!r) return this.err(c, this.closed.has(code) ? 'ROOM_CLOSED' : 'NO_ROOM', this.closed.has(code) ? '這個房間已經結束了' : '找不到這個房間');
    if (m.name) { c.name = cleanName(m.name); }
    let role = m.want === 'spectator' ? 'spectator' : 'player';
    if (m.token) { // 邀請：以 token 決定最終角色，不受暱稱／want 影響
      const inv = r.invites.get(String(m.token));
      if (!inv) return this.err(c, 'INVITE_INVALID', '邀請連結已失效或被房主撤銷');
      if (inv.exp < this.now()) { r.invites.delete(m.token); return this.err(c, 'INVITE_EXPIRED', '邀請連結已過期'); }
      role = inv.role === 'watch' ? 'spectator' : 'player';
    }
    let note = null;
    if (role === 'player' && (this.seats(r) >= r.max || r.phase === 'playing')) {
      role = 'spectator'; note = r.phase === 'playing' ? '遊戲進行中，先以觀戰身分加入；下一局可入座' : '席位已滿，已轉為觀戰';
    }
    if (role === 'spectator' && this.spectatorCount(r) >= MAX_SPECTATORS) return this.err(c, 'SPECTATORS_FULL', '觀戰席已滿');
    this.addMember(r, c, role);
    this.sys(r, c.name + (role === 'player' ? ' 加入了遊戲' : ' 來觀戰'));
    this.snapshotAll(r); this.broadcastList();
    if (note) c.send({ t: 'notice', msg: note });
    if (r.phase === 'playing') this.sendGame(r, c);
  }
  on_sit(c) { // 觀戰者在非進行中入座
    const r = this.roomOf(c), mem = r && r.members.get(c.id);
    if (!mem || mem.role !== 'spectator') return;
    if (r.phase === 'playing') return this.err(c, 'BUSY', '遊戲進行中，下一局才能入座');
    if (this.seats(r) >= r.max) return this.err(c, 'FULL', '席位已滿');
    mem.role = 'player'; r.scores.set(c.id, 0); this.snapshotAll(r); this.broadcastList();
  }
  on_leave(c) { this.leave(c); }
  leave(c) {
    const r = this.roomOf(c); clearTimeout(c.leaveTimer); c.leaveTimer = null;
    if (!r) return;
    const mem = r.members.get(c.id);
    r.members.delete(c.id); r.scores.delete(c.id); c.roomId = null;
    if (mem) this.sys(r, mem.name + ' 離開了');
    this.afterMembershipChange(r, c.id);
    c.send({ t: 'left' }); c.send({ t: 'rooms', rooms: this.list() });
  }
  afterMembershipChange(r, goneId) {
    const hs = this.humans(r);
    if (hs.length === 0) return this.closeRoom(r, '房內沒有真人玩家了');
    if (r.hostId === goneId || !r.members.get(r.hostId) || r.members.get(r.hostId).role !== 'player') r.hostId = hs[0].id;
    if (r.phase === 'playing' && this.humans(r).length + r.ais.length < 2) this.finish(r, true);
    else if (r.phase !== 'playing' && !r.matchDone && this.seats(r) < 2) r.matchDone = true;   // 盤間人數不足：比賽中止，才不會卡在「設定鎖定」
    this.snapshotAll(r); this.broadcastList();
  }
  closeRoom(r, reason) {
    if (!this.rooms.has(r.id)) return;
    for (const t of r.timers) clearTimeout(t); r.timers.clear();
    r.invites.clear(); r.phase = 'closed';
    this.rooms.delete(r.id); this.closed.set(r.id, this.now());
    for (const mem of r.members.values()) {
      const c = this.clients.get(mem.id);
      if (c) { c.send({ t: 'closed', reason }); c.roomId = null; clearTimeout(c.leaveTimer); }
    }
    r.members.clear();
    this.broadcastList();
  }
  on_kick(c, m) {
    const r = this.roomOf(c); if (!r || r.hostId !== c.id) return;
    const t = this.clients.get(String(m.id)); if (!t || t.id === c.id || t.roomId !== r.id) return;
    t.send({ t: 'kicked' }); this.leave(t);
  }
  on_invite(c, m) { // 房主：重發（撤銷舊的）
    const r = this.roomOf(c); if (!r || r.hostId !== c.id) return;
    const role = m.role === 'watch' ? 'watch' : 'play';
    if (m.action === 'revoke') { for (const [k, v] of r.invites) if (v.role === role) r.invites.delete(k); }
    else this.newInvite(r, role);
    this.snapshotAll(r);
  }

  /* ---------- 設定／電腦席位 ---------- */
  on_config(c, m) {
    const r = this.roomOf(c); if (!r || r.hostId !== c.id || r.phase === 'playing') return;
    if (!r.matchDone) return this.err(c, 'IN_MATCH', '比賽進行中，打完這一輪才能改設定');
    if (R.DIFFICULTIES[m.diff]) r.diff = m.diff;
    if (m.rounds) r.totalRounds = Math.min(5, Math.max(1, m.rounds | 0));
    if (m.name != null) r.name = cleanText(m.name).slice(0, 14) || r.name;
    if (m.addAI && this.seats(r) < r.max) {
      const d = R.DIFFICULTIES[m.addAI] ? m.addAI : 'normal';
      const used = new Set(r.ais.map((a) => a.name));
      const name = AI_NAMES.find((n) => !used.has(n)) || '電腦·' + (r.ais.length + 1);
      const a = { id: 'ai-' + rid().slice(0, 6), name, diff: d }; r.ais.push(a); r.scores.set(a.id, 0); this.sys(r, '房主加入了 ' + a.name + '（' + R.DIFFICULTIES[d].name + '）');
    }
    if (m.aiDiff && R.DIFFICULTIES[m.aiDiff.diff]) { const a = r.ais.find((x) => x.id === m.aiDiff.id); if (a) a.diff = m.aiDiff.diff; }
    if (m.removeAI) { const gone = r.ais.find((a) => a.id === m.removeAI); r.ais = r.ais.filter((a) => a.id !== m.removeAI); r.scores.delete(m.removeAI); if (gone) this.sys(r, '房主移除了 ' + gone.name); }
    this.snapshotAll(r); this.broadcastList();
  }

  /* ---------- 開局與對戰 ---------- */
  on_start(c) {
    const r = this.roomOf(c); if (!r || r.hostId !== c.id) return;
    if (r.phase === 'playing') return;
    if (this.seats(r) < 2) return this.err(c, 'NEED_MORE', '至少要 2 位玩家（可以加電腦）');
    if (r.matchDone) { r.round = 0; r.totals = new Map(); r.matchDone = false; }   // 新的一場比賽
    r.round++;
    for (const p of this.players(r)) { r.scores.set(p.id, 0); if (!r.totals.has(p.id)) r.totals.set(p.id, 0); }
    const spec = R.randomSpec(r.diff);
    const st = R.createStateFromSpec(r.diff, spec);
    st.lives = Infinity; st.maxLives = Infinity;
    r.state = st; r.phase = 'playing'; r.startAt = this.now() + this.countdown; r.lastResult = null;
    this.sys(r, '第 ' + r.round + '／' + r.totalRounds + ' 盤開始！');
    for (const mem of r.members.values()) { const cl = this.clients.get(mem.id); cl && this.sendGame(r, cl); }
    this.snapshotAll(r); this.broadcastList();
    for (const a of r.ais) this.scheduleAI(r, a, this.countdown);
  }
  sendGame(r, c) {
    const s = r.state; if (!s) return;
    c.send({ t: 'game', startAt: r.startAt, serverNow: this.now(), round: r.round, state: { w: s.w, h: s.h, mask: s.mask, shape: s.shape, difficulty: s.difficulty, arrows: s.arrows } });
  }
  on_tap(c, m) {
    const r = this.roomOf(c); const mem = r && r.members.get(c.id);
    if (!r || !mem || mem.role !== 'player') return;
    this.applyTap(r, { id: c.id, name: mem.name }, m.id | 0, c);
  }
  applyTap(r, actor, id, client) {
    if (r.phase !== 'playing' || this.now() < r.startAt) return;
    const s = r.state, a = s.arrows[id];
    if (!a || a.removed) { client && client.send({ t: 'late', id }); return; }
    const len = a.cells.length;
    const res = R.tap(s, id);
    if (res.ok) {
      r.scores.set(actor.id, (r.scores.get(actor.id) || 0) + len);
      this.broadcast(r, { t: 'move', id, by: actor.id, ok: true, pts: len, scores: this.scoreObj(r), remaining: R.remaining(s) });
      if (res.won) this.finish(r, false);
    } else if (res.reason === 'blocked') {
      r.scores.set(actor.id, Math.max(0, (r.scores.get(actor.id) || 0) - 1));
      this.broadcast(r, { t: 'move', id, by: actor.id, ok: false, blockers: res.blockers, pts: -1, scores: this.scoreObj(r), remaining: R.remaining(s) });
    }
  }
  scoreObj(r) { const o = {}; for (const [k, v] of r.scores) o[k] = v; return o; }
  finish(r, aborted) {
    if (r.phase !== 'playing') return;
    for (const t of r.timers) clearTimeout(t); r.timers.clear();
    r.phase = 'ended';
    const ps = this.players(r);
    for (const p of ps) r.totals.set(p.id, (r.totals.get(p.id) || 0) + (r.scores.get(p.id) || 0));
    const final = !!aborted || r.round >= r.totalRounds;
    r.matchDone = final;
    const rank = ps.map((p) => ({ id: p.id, name: p.name, isAI: !!p.isAI, score: r.scores.get(p.id) || 0, total: r.totals.get(p.id) || 0 })).sort((a, b) => b.score - a.score);
    // 累計排名：總分高者勝；同分比最後一盤；仍同分則並列同名次
    const standings = rank.slice().sort((a, b) => b.total - a.total || b.score - a.score);
    standings.forEach((x, i) => { x.place = i > 0 && standings[i - 1].total === x.total && standings[i - 1].score === x.score ? standings[i - 1].place : i + 1; });
    r.lastResult = { round: r.round, totalRounds: r.totalRounds, final, aborted: !!aborted, rank, standings };
    this.broadcast(r, { t: 'end', ...r.lastResult });
    this.snapshotAll(r); this.broadcastList();
  }
  players(r) {
    return [...this.humans(r).map((m) => ({ id: m.id, name: m.name })), ...r.ais.map((a) => ({ id: a.id, name: a.name, isAI: true, diff: a.diff }))];
  }

  /* ---------- 電腦 ---------- */
  scheduleAI(r, ai, extra = 0) {
    const p = AI_PARAMS[ai.diff] || AI_PARAMS.normal;
    const d = ((p.delay[0] + Math.random() * (p.delay[1] - p.delay[0])) * this.aiScale) + extra;
    const t = setTimeout(() => {
      r.timers.delete(t);
      if (r.phase !== 'playing' || !this.rooms.has(r.id) || !r.ais.includes(ai)) return;
      const s = r.state, free = R.freeArrows(s);
      const blocked = s.arrows.filter((a) => !a.removed && !free.includes(a.id)).map((a) => a.id);
      let id;
      if (blocked.length && Math.random() < p.miss) id = pick(blocked);
      else if (free.length) id = p.greedy ? free.slice().sort((x, y) => s.arrows[y].cells.length - s.arrows[x].cells.length)[0] : pick(free);
      if (id != null) this.applyTap(r, ai, id);
      if (r.phase === 'playing') this.scheduleAI(r, ai);
    }, d);
    t.unref && t.unref(); r.timers.add(t);
  }

  /* ---------- 聊天 ---------- */
  on_chat(c, m) {
    const r = this.roomOf(c); const mem = r && r.members.get(c.id); if (!mem) return;
    const text = cleanText(m.text); if (!text) return;
    const t = this.now(); c.chatTimes = c.chatTimes.filter((x) => t - x < 5000);
    if (c.chatTimes.length >= 5) return this.err(c, 'RATE', '說話太快了，休息一下');
    c.chatTimes.push(t);
    const msg = { t: 'chat', from: mem.name, role: mem.role, text, ts: t };
    r.chat.push(msg); if (r.chat.length > 60) r.chat.shift();
    this.broadcast(r, msg);
  }
  sys(r, text) { const msg = { t: 'chat', sys: true, text, ts: this.now() }; r.chat.push(msg); if (r.chat.length > 60) r.chat.shift(); this.broadcast(r, msg); }

  /* ---------- 廣播 ---------- */
  broadcast(r, obj) { for (const mem of r.members.values()) { const c = this.clients.get(mem.id); c && c.connected && c.send(obj); } }
  snapshotAll(r) { for (const mem of r.members.values()) { const c = this.clients.get(mem.id); c && c.connected && c.send(this.snapshot(r, mem)); } }
  snapshot(r, me) {
    const players = this.players(r).map((p) => ({ ...p, score: r.scores.get(p.id) || 0, total: r.totals.get(p.id) || 0, host: p.id === r.hostId, connected: p.isAI ? true : (this.clients.get(p.id) || {}).connected !== false }));
    const spectators = [...r.members.values()].filter((m) => m.role === 'spectator').map((m) => ({ id: m.id, name: m.name }));
    const snap = {
      t: 'room', id: r.id, name: r.name, hostId: r.hostId, diff: r.diff, max: r.max, phase: r.phase, round: r.round, totalRounds: r.totalRounds, matchDone: r.matchDone,
      you: me.id, role: me.role, players, spectators, startAt: r.startAt, serverNow: this.now(),
      remaining: r.state && r.phase === 'playing' ? R.remaining(r.state) : 0, result: r.lastResult,
      chat: r.chat.slice(-30),
    };
    if (me.id === r.hostId) snap.invites = [...r.invites.entries()].map(([token, v]) => ({ token, role: v.role, exp: v.exp }));
    return snap;
  }
}

return { Hub, AI_PARAMS };
});
