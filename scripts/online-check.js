/* 線上流程整合測試：真 WebSocket 連到真伺服器 */
const assert = require('assert');
const WebSocket = require('ws');
process.env.PORT = 0;
const { Hub } = require('../public/js/hub.js');
const http = require('http');
const { WebSocketServer } = require('ws');

const hub = new Hub({ countdownMs: 50, graceMs: 300, aiScale: 0.15 });
const server = http.createServer();
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const c = hub.connect((o) => ws.readyState === 1 && ws.send(JSON.stringify(o)));
  ws.on('message', (d) => hub.handle(c, JSON.parse(d)));
  ws.on('close', () => hub.disconnect(c));
});

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  const c = { ws, log: [], id: null, room: null, game: null };
  ws.on('message', (d) => {
    const m = JSON.parse(d); c.log.push(m);
    if (m.t === 'welcome') c.id = m.id;
    if (m.t === 'room') c.room = m;
    if (m.t === 'game') c.game = m;
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(10); } throw new Error('逾時：' + fn.toString().slice(0, 80)); };
  c.last = (type) => [...c.log].reverse().find((m) => m.t === type);
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const [A, B, S] = [client(port), client(port), client(port)];
  await Promise.all([A.open, B.open, S.open]);
  await A.until(() => A.id); await B.until(() => B.id); await S.until(() => S.id);

  let code, playToken, watchToken;
  await t('建房：房主為真人玩家，列表可見', async () => {
    A.send({ t: 'hello', name: '甲' }); A.send({ t: 'create', name: '測試房', diff: 'normal' });
    await A.until(() => A.room);
    code = A.room.id; assert.strictEqual(A.room.role, 'player'); assert.strictEqual(A.room.hostId, A.id);
    playToken = A.room.invites.find((i) => i.role === 'play').token; watchToken = A.room.invites.find((i) => i.role === 'watch').token;
    S.send({ t: 'rooms' }); const l = await S.until(() => S.last('rooms')); assert.ok(l.rooms.some((r) => r.id === code));
  });
  await t('邀請 token 決定角色：play→玩家、watch→觀戰（不受 want 影響）', async () => {
    B.send({ t: 'join', room: code, token: playToken, want: 'spectator', name: '乙' });
    await B.until(() => B.room); assert.strictEqual(B.room.role, 'player');
    S.send({ t: 'join', room: code, token: watchToken, want: 'player', name: '<b>觀</b>' });
    await S.until(() => S.room); assert.strictEqual(S.room.role, 'spectator');
    assert.ok(!/[<>]/.test(S.room.spectators[0].name), '暱稱需消毒');
  });
  await t('無效邀請被拒、非房主看不到邀請清單', async () => {
    const X = client(port); await X.open; await X.until(() => X.id);
    X.send({ t: 'join', room: code, token: 'bad' }); const e = await X.until(() => X.last('error')); assert.strictEqual(e.code, 'INVITE_INVALID');
    assert.strictEqual(B.room.invites, undefined); X.ws.close();
  });
  await t('席位滿時 player 邀請自動轉觀戰並提示', async () => {
    A.send({ t: 'config', addAI: 'hard' }); await A.until(() => A.room.players.length === 3);
    const Y = client(port); await Y.open; await Y.until(() => Y.id);
    Y.send({ t: 'join', room: code, token: playToken, name: '丙' }); await Y.until(() => Y.room);
    assert.strictEqual(Y.room.role, 'spectator'); assert.ok(Y.last('notice')); Y.ws.close();
  });
  await t('聊天：觀戰者可發言，訊息限長', async () => {
    S.send({ t: 'chat', text: 'x'.repeat(200) }); const m = await A.until(() => A.last('chat') && A.log.filter((x) => x.t === 'chat' && x.role === 'spectator')[0]);
    assert.ok(m.text.length <= 80);
  });
  await t('開局：觀戰者收到完整盤面；非房主不能開局', async () => {
    B.send({ t: 'start' }); await sleep(100); assert.strictEqual(A.room.phase, 'lobby');
    A.send({ t: 'start' }); await S.until(() => S.game);
    assert.ok(S.game.state.arrows.length > 3 && S.game.state.mask.length === S.game.state.h);
    await sleep(80);
  });
  await t('搶飛：只有第一個點中的人得分；晚到者收到 late；觀戰者不能操作', async () => {
    const st = S.game.state;
    const free = require('../public/js/rules.js').freeArrows({ ...st, arrows: st.arrows.map((a) => ({ ...a })), w: st.w, h: st.h });
    const id = free[free.length - 1];
    S.send({ t: 'tap', id }); await sleep(60); assert.ok(!A.log.some((m) => m.t === 'move' && m.by === S.id));
    A.send({ t: 'tap', id }); B.send({ t: 'tap', id });
    await A.until(() => A.log.some((m) => m.t === 'move' && m.id === id));
    const moves = A.log.filter((m) => m.t === 'move' && m.id === id && m.ok);
    assert.strictEqual(moves.length, 1);
  });
  await t('被擋住的箭頭：扣分不低於 0（電腦會同時在清盤，故重試取一支當下仍被擋的）', async () => {
    const R = require('../public/js/rules.js'); let hit = null;
    for (let k = 0; k < 8 && !hit; k++) {
      const st = A.game.state; const removed = new Set(A.log.filter((m) => m.t === 'move' && m.ok).map((m) => m.id));
      const arrows = st.arrows.map((a) => ({ ...a, removed: removed.has(a.id) }));
      const cur = { ...st, arrows }; const free = new Set(R.freeArrows(cur));
      const blocked = arrows.find((a) => !a.removed && !free.has(a.id)); if (!blocked) break;
      const before = B.log.length; B.send({ t: 'tap', id: blocked.id }); await sleep(120);
      hit = B.log.slice(before).find((m) => m.t === 'move' && !m.ok && m.id === blocked.id);
    }
    if (hit) assert.ok(hit.scores[B.id] >= 0);
  });
  await t('電腦對手會自己玩到結束，產生排名', async () => {
    const end = await S.until(() => S.last('end'), 15000);
    assert.ok(end.rank.length === 3 && end.rank.some((r) => r.isAI));
    assert.ok(end.rank[0].score >= end.rank[1].score);
  });
  await t('結束後房主可再開一局（盤面重新產生）', async () => {
    const r1 = A.game.round; A.send({ t: 'start' }); await A.until(() => A.game.round === r1 + 1);
    A.send({ t: 'config', diff: 'easy' }); // 進行中設定無效
    await sleep(50); assert.strictEqual(A.room.diff, 'normal');
  });
  await t('房主離開 → 房主轉給下一位真人，房間續存', async () => {
    A.send({ t: 'leave' }); await B.until(() => B.room && B.room.hostId === B.id);
    assert.ok(B.room.phase === 'playing' || B.room.phase === 'ended');
  });
  await t('斷線重連：寬限內回到同一房間與角色', async () => {
    const id = B.id; B.ws.close(); await sleep(60);
    const B2 = client(port); await B2.open; await B2.until(() => B2.id);
    B2.send({ t: 'hello', resumeId: id }); await B2.until(() => B2.room);
    assert.strictEqual(B2.id, id); assert.strictEqual(B2.room.role, 'player'); B.ws = B2.ws; B.send = B2.send; B.room = B2.room;
    B2.ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'room') B.room = m; if (m.t === 'closed') B.closedMsg = m; });
    S.ws.on('message', () => {});
  });
  await t('零實體玩家 → 房間立即關閉、邀請失效、觀戰者被通知、不能復活', async () => {
    B.send({ t: 'leave' });
    const closed = await S.until(() => S.last('closed')); assert.ok(closed.reason);
    const Z = client(port); await Z.open; await Z.until(() => Z.id);
    Z.send({ t: 'join', room: code, token: playToken }); const e = await Z.until(() => Z.last('error')); assert.strictEqual(e.code, 'ROOM_CLOSED');
    Z.send({ t: 'rooms' }); const l = await Z.until(() => Z.last('rooms')); assert.ok(!l.rooms.some((r) => r.id === code));
    assert.strictEqual(hub.rooms.size, 0);
  });
  await t('只剩電腦＋觀戰者（真人斷線超過寬限）也會關閉房間', async () => {
    const P = client(port), V = client(port); await P.open; await V.open; await P.until(() => P.id); await V.until(() => V.id);
    P.send({ t: 'create', diff: 'easy' }); const r = await P.until(() => P.room);
    V.send({ t: 'join', room: r.id, want: 'spectator' }); await V.until(() => V.room);
    P.send({ t: 'config', addAI: 'easy' }); await sleep(30);
    P.ws.close(); const c = await V.until(() => V.last('closed'), 2000); assert.ok(c);
  });

  console.log(`\n${n} 項線上流程測試通過`);
  hub.stop(); [A, B, S].forEach((c) => c.ws.close()); server.close(); process.exit(0);
})().catch((e) => { console.error('✗ 失敗：', e); process.exit(1); });
