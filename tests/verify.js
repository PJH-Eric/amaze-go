const assert = require('assert');
const R = require('../public/js/rules.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

t('同種子產生相同盤面（可重現）', () => {
  const a = R.createState('normal', 3), b = R.createState('normal', 3);
  assert.deepStrictEqual(a.arrows, b.arrows);
});
const LV = R.LEVELS_PER_DIFFICULTY;
const all = [];
let tmax = 0;
for (const d of Object.keys(R.DIFFICULTIES)) for (let l = 1; l <= LV; l++) { const t0 = Date.now(); all.push([d, l, R.createState(d, l)]); tmax = Math.max(tmax, Date.now() - t0); }
t('四種難度各 100 關全部有解（共 ' + all.length + ' 關）', () => { for (const [d, l, s] of all) assert.ok(R.isSolvable(s), `${d}-${l} 無解`); });
t('單關生成最長 ' + tmax + ' ms（需 < 1500）', () => assert.ok(tmax < 1500));
t('緊密排列：每關遮罩內填滿率 ≥ 88%，且箭頭不超出遮罩', () => {
  for (const [d, l, s] of all) {
    let cells = 0, used = 0;
    for (const row of s.mask) cells += row.split('1').length - 1;
    for (const a of s.arrows) for (const [x, y] of a.cells) { assert.strictEqual(s.mask[y][x], '1', `${d}-${l} 超出遮罩`); used++; }
    assert.ok(used / cells >= 0.88, `${d}-${l} 填滿率 ${(used / cells).toFixed(2)}`);
    assert.ok(cells >= 10 && s.arrows.length >= 3, `${d}-${l} 盤面太小`);
  }
});
t('每種難度用到至少 30 種輪廓，且大量非方形', () => {
  for (const d of Object.keys(R.DIFFICULTIES)) {
    const ids = new Set(), nonSq = new Set();
    for (const [dd, l, s] of all) if (dd === d) { ids.add(s.shape.id); if (s.w !== s.h) nonSq.add(l); }
    assert.ok(ids.size >= 30, d + ' 只有 ' + ids.size + ' 種'); assert.ok(nonSq.size >= 40, d + ' 非方形只有 ' + nonSq.size);
  }
});
t('難度有可觀察差異（100 關平均箭頭數遞增）', () => {
  const avg = Object.keys(R.DIFFICULTIES).map((d) => { const xs = all.filter((x) => x[0] === d).map((x) => x[2].arrows.length); return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length); });
  console.log('    各難度平均箭頭數：', avg.join(' / '));
  for (let i = 1; i < avg.length; i++) assert.ok(avg[i] > avg[i - 1], avg.join());
});
t('同難度後期關卡比前期更大（關卡漸進）', () => {
  for (const d of Object.keys(R.DIFFICULTIES)) {
    const f = (r) => all.filter((x) => x[0] === d && x[1] >= r[0] && x[1] <= r[1]).reduce((n, x) => n + x[2].arrows.length, 0);
    assert.ok(f([91, 100]) > f([1, 10]), d);
  }
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
  for (let l = 1; l <= 30 && !blocked; l++) { s = R.createState('toddler', l); blocked = s.arrows.find((a) => R.blockersOf(s, a.id).length); }
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
