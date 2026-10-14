const assert = require('assert');
const R = require('../public/js/rules.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

t('同種子產生相同盤面（可重現）', () => {
  const a = R.createState('normal', 3), b = R.createState('normal', 3);
  assert.deepStrictEqual(a.arrows, b.arrows);
});
t('四種難度各 10 關全部有解、且箭頭數足夠', () => {
  for (const d of Object.keys(R.DIFFICULTIES))
    for (let l = 1; l <= R.LEVELS_PER_DIFFICULTY; l++) {
      const s = R.createState(d, l);
      assert.ok(R.isSolvable(s), `${d}-${l} 無解`);
      assert.ok(s.arrows.length >= 4, `${d}-${l} 箭頭太少`);
    }
});
t('緊密排列：各難度填滿率 ≥ 90%', () => {
  for (const d of Object.keys(R.DIFFICULTIES)) for (let l = 1; l <= 10; l++) {
    const s = R.createState(d, l), c = s.arrows.reduce((n, a) => n + a.cells.length, 0);
    assert.ok(c / (s.w * s.h) >= 0.9, `${d}-${l} 填滿率 ${(c / (s.w * s.h)).toFixed(2)}`);
  }
});
t('難度有可觀察差異（箭頭數遞增）', () => {
  const cnt = Object.keys(R.DIFFICULTIES).map((d) => R.createState(d, 5).arrows.length);
  console.log('    各難度第5關箭頭數：', cnt.join(' / '));
  for (let i = 1; i < cnt.length; i++) assert.ok(cnt[i] > cnt[i - 1], cnt.join());
});
t('點被擋住的箭頭：扣愛心、不移除', () => {
  const s = R.createState('normal', 1);
  const blocked = s.arrows.find((a) => R.blockersOf(s, a.id).length);
  assert.ok(blocked);
  const r = R.tap(s, blocked.id);
  assert.strictEqual(r.ok, false); assert.strictEqual(s.lives, 2); assert.ok(!blocked.removed);
});
t('點自由箭頭：移除', () => {
  const s = R.createState('easy', 1);
  const id = R.freeArrows(s)[0];
  assert.ok(R.tap(s, id).ok); assert.ok(s.arrows[id].removed);
});
t('依序清完 → won', () => {
  const s = R.createState('hard', 2);
  while (s.status === 'playing') for (const id of R.freeArrows(s)) R.tap(s, id);
  assert.strictEqual(s.status, 'won'); assert.strictEqual(s.mistakes, 0);
});
t('愛心歸零 → lost，之後不能再操作', () => {
  const s = R.createState('normal', 1);
  const blocked = s.arrows.find((a) => R.blockersOf(s, a.id).length);
  for (let i = 0; i < 3; i++) R.tap(s, blocked.id);
  assert.strictEqual(s.status, 'lost'); assert.strictEqual(R.tap(s, blocked.id).reason, 'over');
});
t('幼幼班不扣命、不會輸', () => {
  let s, blocked;
  for (let l = 1; l <= 10 && !blocked; l++) { s = R.createState('toddler', l); blocked = s.arrows.find((a) => R.blockersOf(s, a.id).length); }
  assert.ok(blocked);
  for (let i = 0; i < 20; i++) R.tap(s, blocked.id);
  assert.strictEqual(s.status, 'playing');
});
t('提示給出自由箭頭並消耗次數', () => {
  const s = R.createState('hard', 1);
  const id = R.hint(s);
  assert.ok(R.freeArrows(s).includes(id)); assert.strictEqual(s.hints, 0); assert.strictEqual(R.hint(s), null);
});
console.log(`\n${n} 項規則測試通過`);
