/* 產生 levels-v1-extra2.js（各難度第 201～300 關）。
   用法：node scripts/generate-levels-extra2.js [輸出檔] [起始關] [結束關]
   與 101～200 關相同做法：levelSpec 固定規格、每關最多 40 組內部種子完整搜尋，不採用裝置時間上限。
   預設不覆寫既有檔案；除錯比對 101～200 關時可指定其他輸出檔與關卡範圍。 */
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/js/rules.js');
const Shapes = require('../public/js/shapes.js');

const SEED_STRIDE = 104729;
const [, , outArg, fromArg, toArg] = process.argv;
const from = Number(fromArg || 201), to = Number(toArg || 300);
const out = path.resolve(outArg || path.join(__dirname, '..', 'public', 'js', 'levels-v1-extra2.js'));

function build(difficulty, level) {
  const cfg = R.DIFFICULTIES[difficulty];
  const spec = R.levelSpec(difficulty, level);
  let m = Shapes.rasterize(spec.shape, spec.dim, spec.flip);
  for (let extra = 1; extra <= 4 && m.rows.join('').split('1').length - 1 < 12; extra++) m = Shapes.rasterize(spec.shape, spec.dim + extra, spec.flip);
  let arrows = null, bestOnes = Infinity;
  for (let k = 0; k < 40 && bestOnes > 0; k++) {
    const cand = R.generate({ ...cfg, w: m.w, h: m.h, mask: m.rows, seed: spec.seed + k * SEED_STRIDE });
    const ones = cand.filter((a) => a.cells.length === 1).length;
    if (ones < bestOnes) { bestOnes = ones; arrows = cand; }
    if (bestOnes <= cand.length * 0.02) break;
  }
  const state = { w: m.w, h: m.h, arrows: arrows.map((a) => ({ ...a, removed: false })) };
  if (!R.isSolvable({ ...state, mask: m.rows })) throw new Error(difficulty + '/' + level + ' 無解');
  return [spec.seed, m.w, m.h, { id: spec.shape.id, name: spec.shape.name, cat: spec.shape.cat }, m.rows, arrows.map((a) => [a.dir, a.cells.flat()])];
}

const lines = [];
for (const d of Object.keys(R.DIFFICULTIES)) {
  const rows = [];
  for (let level = from; level <= to; level++) rows.push('      ' + JSON.stringify(build(d, level)));
  lines.push('    ' + d + ': [\n' + rows.join(',\n') + '\n    ]');
  console.error('完成', d);
}
const body = `/* story-v1 擴充：各難度第 ${from}～${to} 關。固定資料，不覆寫既有關卡。
   每關：[seed, w, h, shape, mask, [[方向, [x0, y0, ...]], ...]]。
   來源：13fe0c6 之後的規則核心（scripts/generate-levels-extra2.js）；固定種子與完整候選搜尋；尺寸由第 101～200 關的上限再緩增 2 格。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmazeExtraLevels2 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return { version: 'story-v1', startLevel: ${from}, boards: {
${lines.join(',\n')}
  } };
});
`;
fs.writeFileSync(out, body);
