/* 多盤累計：不經網路，直接驅動 Hub（與瀏覽器單機對戰同一套邏輯） */
const assert = require('assert');
const { Hub } = require('../public/js/hub.js');
const hub = new Hub({ countdownMs: 0, aiScale: 0.005 });
const log = [];
const c = hub.connect((m) => log.push(JSON.parse(JSON.stringify(m))));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(10); } throw new Error('逾時 ' + fn.toString().slice(0, 70)); };
const last = (type) => [...log].reverse().find((m) => m.t === type);
const ends = () => log.filter((m) => m.t === 'end');

(async () => {
  hub.handle(c, { t: 'hello', name: '測試' });
  assert.strictEqual(last('rooms').online, 1, '大廳快照包含目前在線人數');
  hub.handle(c, { t: 'create', name: '單機', diff: 'easy', rounds: 3 });
  const room = await until(() => last('room'));
  await t('可設 1～5 盤，超出範圍會被夾住', async () => {
    assert.strictEqual(room.totalRounds, 3);
    hub.handle(c, { t: 'config', rounds: 9 }); assert.strictEqual(last('room').totalRounds, 5);
    hub.handle(c, { t: 'config', rounds: 0 }); assert.ok(last('room').totalRounds >= 1);
    hub.handle(c, { t: 'config', rounds: 3 });
  });
  await t('固定最多 3 位玩家：1 位真人＋最多 2 位電腦（第 3 位電腦加不進去）', async () => {
    for (const d of ['easy', 'normal', 'hard', 'toddler']) hub.handle(c, { t: 'config', addAI: d });
    assert.strictEqual(last('room').players.length, 3);
  });
  await t('累計賽：前兩盤非最終、第三盤才決勝負；總分＝每盤分數相加', async () => {
    const perRound = [];
    for (let k = 1; k <= 3; k++) {
      hub.handle(c, { t: 'start' });
      const e = await until(() => ends().length === k && ends()[k - 1]);
      perRound.push(e);
      assert.strictEqual(e.round, k); assert.strictEqual(e.final, k === 3);
      const total = e.rank.reduce((a, x) => a + x.score, 0); assert.ok(total > 0);
    }
    const lastE = perRound[2], byId = {};
    perRound.forEach((e) => e.rank.forEach((x) => { byId[x.id] = (byId[x.id] || 0) + x.score; }));
    lastE.standings.forEach((x) => assert.strictEqual(x.total, byId[x.id], '累計分數不符'));
    assert.strictEqual(lastE.standings[0].place, 1);
    for (let i = 1; i < lastE.standings.length; i++) assert.ok(lastE.standings[i - 1].total >= lastE.standings[i].total);
  });
  await t('打完一場後再按開始 → 新的一場（回到第 1 盤、總分歸零）', async () => {
    hub.handle(c, { t: 'start' });
    const e = await until(() => ends().length === 4 && ends()[3]);
    assert.strictEqual(e.round, 1);
    assert.ok(e.standings.every((x) => x.total === x.score));
  });
  await t('比賽進行中（盤與盤之間）不能改設定', async () => {
    hub.handle(c, { t: 'config', rounds: 3 }); hub.handle(c, { t: 'start' });
    await until(() => ends().length === 5);
    assert.strictEqual(last('room').matchDone, false);
    hub.handle(c, { t: 'config', diff: 'hard' }); assert.ok(last('error') && last('error').code === 'IN_MATCH');
  });
  await t('盤間對手離開、人數不足 → 比賽中止，設定解鎖（不會卡死）', async () => {
    const h2 = new Hub({ countdownMs: 0, aiScale: 0.005 }), l1 = [], l2 = [];
    const a = h2.connect((m) => l1.push(JSON.parse(JSON.stringify(m)))), b = h2.connect((m) => l2.push(JSON.parse(JSON.stringify(m))));
    h2.handle(a, { t: 'hello', name: 'A' }); h2.handle(b, { t: 'hello', name: 'B' });
    h2.handle(a, { t: 'create', name: 'x', diff: 'easy', rounds: 3 });
    const code = [...l1].reverse().find((m) => m.t === 'room').id;
    h2.handle(b, { t: 'join', room: code, want: 'player' });
    h2.handle(a, { t: 'start' });
    await until(() => l1.some((m) => m.t === 'end') || (() => { const st = h2.rooms.get(code).state, f = require('../public/js/rules.js').freeArrows(st); if (f.length) h2.handle(b, { t: 'tap', id: f[0] }); return false; })());
    assert.strictEqual([...l1].reverse().find((m) => m.t === 'room').matchDone, false);
    h2.handle(b, { t: 'leave' });
    assert.strictEqual([...l1].reverse().find((m) => m.t === 'room').matchDone, true);
    h2.handle(a, { t: 'config', diff: 'hard' });
    assert.strictEqual([...l1].reverse().find((m) => m.t === 'room').diff, 'hard');
    h2.stop();
  });
  await t('伺服器只送代碼與參數：錯誤無自然語言 msg、電腦帶編號 aiN、系統訊息帶 k／p', async () => {
    const e = last('error'); assert.ok(e && e.code && e.msg === undefined);
    const rm = last('room');
    assert.ok(rm.players.filter((p) => p.isAI).every((p) => Number.isInteger(p.aiN)));
    const sysMsgs = log.filter((m) => m.t === 'chat' && m.sys);
    assert.ok(sysMsgs.length > 0 && sysMsgs.every((m) => typeof m.k === 'string' && m.text === undefined));
    assert.ok(sysMsgs.some((m) => m.k === 'aiAdd' && Number.isInteger(m.p.n) && m.p.d));
    assert.ok(sysMsgs.some((m) => m.k === 'round' && m.p.r >= 1 && m.p.t === 3));
  });
  console.log(`\n${n} 項多盤累計測試通過`);
  hub.stop(); process.exit(0);
})().catch((e) => { console.error('✗ 失敗：', e); process.exit(1); });
