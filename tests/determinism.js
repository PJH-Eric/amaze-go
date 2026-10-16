const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const R = require('../public/js/rules.js');
const extra = require('../public/js/levels-v1-extra.js');
const expected = { ...require('./fixtures/levels-v1.sha256.json'), ...require('./fixtures/levels-v1-extra.sha256.json') };

assert.equal(extra.startLevel, 101);
assert.equal(extra.version, 'story-v1');
for (const difficulty of Object.keys(R.DIFFICULTIES)) assert.equal(extra.boards[difficulty].length, 100);

const hash = (state) => crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
function atClock(now, difficulty, level) {
  const original = Date.now;
  Date.now = now;
  try { return R.createState(difficulty, level); }
  finally { Date.now = original; }
}

let slow = 0;
const fast = atClock(() => 0, 'myth', 6);
const delayed = atClock(() => (slow += 1000), 'myth', 6);
console.log('同一關卡，快速裝置：', hash(fast));
console.log('同一關卡，慢速裝置：', hash(delayed));
assert.equal(hash(delayed), hash(fast), '同一難度／關卡不得因生成速度或時間而改變盤面');

function boardHash(state) {
  const entry = [state.seed, state.w, state.h, state.shape, state.mask, state.arrows.map((a) => [a.dir, a.cells.flat()])];
  return hash(entry);
}

const original = { now: Date.now, random: Math.random, sort: Array.prototype.sort };
let count = 0;
try {
  const forbidden = () => { throw new Error('固定闖關盤面不得使用時鐘、隨機數或排序'); };
  Date.now = forbidden;
  Math.random = forbidden;
  Array.prototype.sort = forbidden;
  for (const difficulty of Object.keys(R.DIFFICULTIES)) {
    const layouts = new Set();
    for (let level = 1; level <= R.LEVELS_PER_DIFFICULTY; level++) {
      const state = R.createState(difficulty, level);
      const key = difficulty + '/' + level;
      assert.equal(state.boardVersion, 'story-v1');
      assert.equal(boardHash(state), expected[key], key + ' 與固定盤面不符');
      const layout = hash([state.w, state.h, state.mask, state.arrows]);
      if (level > 100) assert.ok(!layouts.has(layout), key + ' 重複既有盤面');
      layouts.add(layout);
      const before = hash(state);
      state.arrows[0].cells[0][0] = -1;
      state.arrows[0].removed = true;
      state.mask[0] = '';
      state.shape.name = '已修改';
      assert.equal(hash(R.createState(difficulty, level)), before, key + ' 汙染了其他玩家或下一次開局');
      count++;
    }
  }
} finally {
  Date.now = original.now;
  Math.random = original.random;
  Array.prototype.sort = original.sort;
}
assert.equal(count, 1000);
assert.equal(Object.keys(expected).length, count);
for (const level of [0, 201, 1.5, undefined]) assert.throws(() => R.createState('easy', level), RangeError);
assert.throws(() => R.createState('unknown', 1), RangeError);
console.log('✓ 全部 1,000 關符合固定雜湊，不依賴時間／隨機／排序，且各次開局互不影響');
