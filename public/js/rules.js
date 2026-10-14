/* 箭頭解密 規則核心：瀏覽器與伺服器（日後線上版）共用，純函式、無 DOM、可注入種子 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapes.js'));
  else root.AmazeRules = factory(root.AmazeShapes);
})(typeof self !== 'undefined' ? self : this, function (Shapes) {
  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const DIR_KEYS = Object.keys(DIRS);

  // dim：長邊格數，隨關卡 1→100 由 minDim 線性增加到 maxDim
  const DIFFICULTIES = {
    toddler: { name: '幼幼班', minDim: 6, maxDim: 8, minLen: 2, maxLen: 3, fill: 0.9, lives: Infinity, hints: Infinity },
    easy: { name: '簡單', minDim: 7, maxDim: 10, minLen: 2, maxLen: 4, fill: 0.95, lives: 5, hints: 3 },
    normal: { name: '普通', minDim: 9, maxDim: 13, minLen: 2, maxLen: 5, fill: 0.97, lives: 3, hints: 2 },
    hard: { name: '困難', minDim: 11, maxDim: 16, minLen: 3, maxLen: 7, fill: 0.98, lives: 3, hints: 1 },
  };
  const LEVELS_PER_DIFFICULTY = 100;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const key = (x, y) => x + ',' + y;

  function rayCells(cells, dir, w, h) {
    const [dx, dy] = DIRS[dir];
    const out = [];
    let x = cells[0][0] + dx, y = cells[0][1] + dy;
    while (x >= 0 && y >= 0 && x < w && y < h) { out.push([x, y]); x += dx; y += dy; }
    return out;
  }

  function solvableList(arrows, w, h) {
    const alive = new Set(arrows.map((_, i) => i));
    for (;;) {
      if (!alive.size) return true;
      const occ = new Map();
      for (const i of alive) for (const [x, y] of arrows[i].cells) occ.set(key(x, y), i);
      const free = [];
      for (const i of alive) {
        const a = arrows[i];
        if (!rayCells(a.cells, a.dir, w, h).some(([x, y]) => occ.has(key(x, y)))) free.push(i);
      }
      if (!free.length) return false;
      free.forEach((i) => alive.delete(i));
    }
  }

  /**
   * 緊密生成：在任意空格隨機走出蛇形箭頭，每放一支就用「清空模擬」驗證仍有解，
   * 不合就丟棄；最後再用 1～2 格短箭頭補滿剩餘空格，填滿率約 95% 以上。
   */
  function generate(opts) {
    const { w, h, seed, minLen, maxLen, fill, mask } = opts;
    const inM = (x, y) => mask[y][x] === '1';
    const rnd = mulberry32(seed >>> 0);
    const ints = (n) => Math.floor(rnd() * n);
    const occupied = new Set();
    const arrows = [];
    let total = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inM(x, y)) total++;
    const target = Math.floor(total * fill);

    function walk(sx, sy, len) {
      const cells = [[sx, sy]], used = new Set([key(sx, sy)]);
      while (cells.length < len) {
        const [cx, cy] = cells[cells.length - 1];
        const next = DIR_KEYS.map((d) => [cx + DIRS[d][0], cy + DIRS[d][1]]).filter(([x, y]) =>
          x >= 0 && y >= 0 && x < w && y < h && inM(x, y) && !used.has(key(x, y)) && !occupied.has(key(x, y)));
        if (!next.length) break;
        const n = next[ints(next.length)];
        cells.push(n); used.add(key(n[0], n[1]));
      }
      return cells;
    }
    function tryPlace(cells) {
      const order = DIR_KEYS.slice().sort(() => rnd() - 0.5);
      if (cells.length > 1) {
        const dx = cells[0][0] - cells[1][0], dy = cells[0][1] - cells[1][1];
        const nat = DIR_KEYS.find((d) => DIRS[d][0] === dx && DIRS[d][1] === dy);
        if (nat && rnd() < 0.6) order.unshift(nat);
      }
      for (const dir of order) {
        arrows.push({ id: arrows.length, cells, dir, removed: false });
        if (solvableList(arrows, w, h)) { for (const c of cells) occupied.add(key(c[0], c[1])); return true; }
        arrows.pop();
      }
      return false;
    }
    let attempts = total * 30;
    while (attempts-- > 0 && occupied.size < target) {
      const sx = ints(w), sy = ints(h);
      if (!inM(sx, sy) || occupied.has(key(sx, sy))) continue;
      const cells = walk(sx, sy, minLen + ints(maxLen - minLen + 1));
      if (cells.length < Math.min(minLen, 2)) continue;
      tryPlace(cells);
    }
    // 補滿零星空格：先試 2 格再試 1 格
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inM(x, y) || occupied.has(key(x, y))) continue;
      for (const len of [3, 2, 1]) {
        const cells = walk(x, y, len);
        if (cells.length === len && tryPlace(cells)) break;
      }
    }
    return arrows;
  }

  /** 關卡規格：形狀、解析度、鏡射與種子，全由 (難度, 關卡) 決定 → 可重現 */
  function levelSpec(difficulty, level) {
    const cfg = DIFFICULTIES[difficulty], di = Object.keys(DIFFICULTIES).indexOf(difficulty);
    const rnd = mulberry32(di * 7919 + 17);
    const pool = Shapes.SHAPES.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const shape = Shapes.SHAPES[pool[(level - 1) % pool.length]];
    const t = (level - 1) / (LEVELS_PER_DIFFICULTY - 1);
    const dim = Math.round(cfg.minDim + (cfg.maxDim - cfg.minDim) * t);
    const seed = (di + 1) * 100003 + level * 131;
    const flip = mulberry32(seed)() < 0.5;
    return { shape, dim, flip, seed };
  }

  /** 線上／隨機開局：每次隨機輪廓、解析度與種子（rnd 可注入以便測試） */
  function randomSpec(difficulty, rnd) {
    rnd = rnd || Math.random;
    const cfg = DIFFICULTIES[difficulty];
    const shape = Shapes.SHAPES[Math.floor(rnd() * Shapes.SHAPES.length)];
    const dim = cfg.minDim + Math.floor(rnd() * (cfg.maxDim - cfg.minDim + 1));
    return { shape, dim, flip: rnd() < 0.5, seed: Math.floor(rnd() * 2147483647) };
  }

  function createState(difficulty, level) {
    const spec = levelSpec(difficulty, level);
    const st = createStateFromSpec(difficulty, spec);
    st.level = level;
    return st;
  }

  function createStateFromSpec(difficulty, spec) {
    const cfg = DIFFICULTIES[difficulty];
    let m = Shapes.rasterize(spec.shape, spec.dim, spec.flip);
    // 細長／鏤空的輪廓在低解析度可能太小：自動放大解析度直到格數足夠
    for (let extra = 1; extra <= 4 && m.rows.join('').split('1').length - 1 < 12; extra++) m = Shapes.rasterize(spec.shape, spec.dim + extra, spec.flip);
    const arrows = generate({ ...cfg, w: m.w, h: m.h, mask: m.rows, seed: spec.seed });
    return {
      difficulty, seed: spec.seed, w: m.w, h: m.h, mask: m.rows, shape: { id: spec.shape.id, name: spec.shape.name, cat: spec.shape.cat },
      arrows, lives: cfg.lives, maxLives: cfg.lives, hints: cfg.hints,
      moves: 0, mistakes: 0, status: 'playing',
    };
  }

  function occupantMap(state) {
    const m = new Map();
    for (const a of state.arrows) if (!a.removed) for (const [x, y] of a.cells) m.set(key(x, y), a.id);
    return m;
  }

  function blockersOf(state, id, occ) {
    occ = occ || occupantMap(state);
    const a = state.arrows[id];
    const ids = new Set();
    for (const [x, y] of rayCells(a.cells, a.dir, state.w, state.h)) {
      const o = occ.get(key(x, y));
      if (o !== undefined && o !== id) ids.add(o);
    }
    return [...ids];
  }

  function remaining(state) { return state.arrows.filter((a) => !a.removed).length; }

  function tap(state, id) {
    if (state.status !== 'playing') return { ok: false, reason: 'over' };
    const a = state.arrows[id];
    if (!a || a.removed) return { ok: false, reason: 'invalid' };
    state.moves++;
    const blockers = blockersOf(state, id);
    if (blockers.length === 0) {
      a.removed = true;
      if (remaining(state) === 0) state.status = 'won';
      return { ok: true, won: state.status === 'won' };
    }
    state.mistakes++;
    if (state.lives !== Infinity) {
      state.lives--;
      if (state.lives <= 0) state.status = 'lost';
    }
    return { ok: false, reason: 'blocked', blockers, lost: state.status === 'lost' };
  }

  function freeArrows(state) {
    const occ = occupantMap(state);
    return state.arrows.filter((a) => !a.removed && blockersOf(state, a.id, occ).length === 0).map((a) => a.id);
  }

  function hint(state) {
    if (state.status !== 'playing' || state.hints <= 0) return null;
    const f = freeArrows(state);
    if (!f.length) return null;
    if (state.hints !== Infinity) state.hints--;
    return f[0];
  }

  /** 模擬一路清到底，驗證有解（測試與日後伺服器驗證用） */
  function isSolvable(state) {
    const copy = { ...state, arrows: state.arrows.map((a) => ({ ...a })) };
    for (;;) {
      const f = freeArrows(copy);
      if (!remaining(copy)) return true;
      if (!f.length) return false;
      for (const id of f) copy.arrows[id].removed = true;
    }
  }

  return { DIRS, DIFFICULTIES, LEVELS_PER_DIFFICULTY, mulberry32, generate, levelSpec, randomSpec, createState, createStateFromSpec, rayCells, blockersOf, tap, freeArrows, hint, isSolvable, remaining };
});
