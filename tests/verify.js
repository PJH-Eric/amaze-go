const assert = require('assert');
const R = require('../public/js/rules.js');
const Shapes = require('../public/js/shapes.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

t('同種子產生相同盤面（可重現）', () => {
  const a = R.createState('normal', 3), b = R.createState('normal', 3);
  assert.deepStrictEqual(a.arrows, b.arrows);
});
t('神話固定種子優先合併短箭頭，單格比例低於 15%', () => {
  let ones = 0, total = 0;
  for (const level of [3, 6, 10]) {
    const spec = R.levelSpec('myth', level);
    const mask = Shapes.rasterize(spec.shape, spec.dim, spec.flip);
    const arrows = R.generate({ ...R.DIFFICULTIES.myth, w: mask.w, h: mask.h, mask: mask.rows, seed: spec.seed });
    total += arrows.length;
    ones += arrows.filter((a) => a.cells.length === 1).length;
    assert.ok(R.isSolvable({ arrows, w: mask.w, h: mask.h }));
  }
  assert.ok(ones / total < 0.15, '固定種子單格比例 ' + (100 * ones / total).toFixed(2) + '%');
});
const LV = R.LEVELS_PER_DIFFICULTY;
const all = [];
let tmax = 0;
for (const d of Object.keys(R.DIFFICULTIES)) for (let l = 1; l <= LV; l++) { const t0 = Date.now(); all.push([d, l, R.createState(d, l)]); tmax = Math.max(tmax, Date.now() - t0); }
t('五種難度各 200 關全部有解（共 ' + all.length + ' 關）', () => { for (const [d, l, s] of all) assert.ok(R.isSolvable(s), `${d}-${l} 無解`); });
t('單關生成最長 ' + tmax + ' ms（需 < 1500）', () => assert.ok(tmax < 1500));
function nComp(rows) {
  const h = rows.length, w = rows[0].length, seen = new Set(); let c = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rows[y][x] !== '1' || seen.has(x + ',' + y)) continue;
    c++; const q = [[x, y]]; seen.add(x + ',' + y);
    while (q.length) { const [a, b] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = a + dx, ny = b + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && rows[ny][nx] === '1' && !seen.has(nx + ',' + ny)) { seen.add(nx + ',' + ny); q.push([nx, ny]); } } }
  }
  return c;
}
t('棋盤緊貼不斷開：每關輪廓為單一連通塊、遮罩內 100% 填滿', () => {
  for (const [d, l, s] of all) {
    assert.strictEqual(nComp(s.mask), 1, `${d}-${l} 輪廓斷開`);
    let cells = 0, used = 0;
    for (const row of s.mask) cells += row.split('1').length - 1;
    for (const a of s.arrows) used += a.cells.length;
    assert.strictEqual(used, cells, `${d}-${l} 有空格`);
  }
});
t('每支箭頭的身體為連續相鄰格；1 格箭頭低於 6%', () => {
  let tot = 0, ones = 0, mTot = 0, mOnes = 0;   // 神話盤面極大，單獨計算並放寬
  for (const [d, l, s] of all) for (const a of s.arrows) {
    if (d === 'myth') { mTot++; if (a.cells.length === 1) mOnes++; } else { tot++; if (a.cells.length === 1) ones++; }
    for (let i = 1; i < a.cells.length; i++) assert.strictEqual(Math.abs(a.cells[i][0] - a.cells[i - 1][0]) + Math.abs(a.cells[i][1] - a.cells[i - 1][1]), 1);
  }
  assert.ok(ones / tot < 0.06, '1 格箭頭比例 ' + (ones / tot).toFixed(2));
  assert.ok(mOnes / mTot < 0.15, '神話 1 格箭頭比例 ' + (mOnes / mTot).toFixed(2));
});
t('緊密排列：每關遮罩內填滿率 ≥ 88%，且箭頭不超出遮罩', () => {
  for (const [d, l, s] of all) {
    let cells = 0, used = 0;
    for (const row of s.mask) cells += row.split('1').length - 1;
    for (const a of s.arrows) for (const [x, y] of a.cells) { assert.strictEqual(s.mask[y][x], '1', `${d}-${l} 超出遮罩`); used++; }
    assert.ok(used / cells >= 0.88, `${d}-${l} 填滿率 ${(used / cells).toFixed(2)}`);
    assert.ok(cells >= 10 && s.arrows.length >= 2, `${d}-${l} 盤面太小`);
  }
});
t('每種難度用到至少 30 種輪廓，且大量非方形', () => {
  for (const d of Object.keys(R.DIFFICULTIES)) {
    const ids = new Set(), nonSq = new Set();
    for (const [dd, l, s] of all) if (dd === d) { ids.add(s.shape.id); if (s.w !== s.h) nonSq.add(l); }
    assert.ok(ids.size >= 30, d + ' 只有 ' + ids.size + ' 種'); assert.ok(nonSq.size >= 40, d + ' 非方形只有 ' + nonSq.size);
  }
});
t('難度有可觀察差異（200 關平均箭頭數遞增）', () => {
  const avg = Object.keys(R.DIFFICULTIES).map((d) => { const xs = all.filter((x) => x[0] === d).map((x) => x[2].arrows.length); return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length); });
  console.log('    各難度平均箭頭數：', avg.join(' / '));
  for (let i = 1; i < avg.length; i++) assert.ok(avg[i] > avg[i - 1], avg.join());
});
t('同難度後期關卡比前期更大（關卡漸進）', () => {
  for (const d of Object.keys(R.DIFFICULTIES)) {
    const f = (r) => all.filter((x) => x[0] === d && x[1] >= r[0] && x[1] <= r[1]).reduce((n, x) => n + x[2].arrows.length, 0);
    assert.ok(f([91, 100]) > f([1, 10]), d);
    assert.ok(f([191, 200]) > f([1, 10]), d + ' 擴充後期');
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
t('隨機開局：任意種子的盤型都有解、貼合遮罩', () => {
  const rnd = R.mulberry32(7);
  for (const d of Object.keys(R.DIFFICULTIES)) for (let i = 0; i < 60; i++) {
    const s = R.createStateFromSpec(d, R.randomSpec(d, rnd));
    assert.ok(R.isSolvable(s));
    for (const a of s.arrows) for (const [x, y] of a.cells) assert.strictEqual(s.mask[y][x], '1');
  }
});
console.log(`\n${n} 項規則測試通過`);
