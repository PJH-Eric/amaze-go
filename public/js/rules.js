/* 箭頭解密 規則核心：瀏覽器與伺服器（日後線上版）共用，純函式、無 DOM、可注入種子 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmazeRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const DIR_KEYS = Object.keys(DIRS);

  const DIFFICULTIES = {
    toddler: { name: '幼幼班', w: 4, h: 4, minLen: 2, maxLen: 3, fill: 0.7, lives: Infinity, hints: Infinity },
    easy: { name: '簡單', w: 6, h: 6, minLen: 2, maxLen: 4, fill: 0.75, lives: 5, hints: 3 },
    normal: { name: '普通', w: 8, h: 8, minLen: 2, maxLen: 5, fill: 0.8, lives: 3, hints: 2 },
    hard: { name: '困難', w: 10, h: 10, minLen: 3, maxLen: 7, fill: 0.85, lives: 3, hints: 1 },
  };
  const LEVELS_PER_DIFFICULTY = 10;

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

  /**
   * 構造式生成：新箭頭的身體絕不落在既有箭頭的射線上，
   * 因此「後放的被先放的擋住」，依放置順序必可全部清空（保證有解）。
   */
  function generate(opts) {
    const { w, h, seed, minLen, maxLen, fill } = opts;
    const rnd = mulberry32(seed >>> 0);
    const occupied = new Set();
    const rays = new Set();
    const arrows = [];
    const total = w * h;
    let attempts = total * 40;
    const target = Math.floor(total * fill);
    const ints = (n) => Math.floor(rnd() * n);

    while (attempts-- > 0 && occupied.size < target) {
      const sx = ints(w), sy = ints(h);
      if (occupied.has(key(sx, sy)) || rays.has(key(sx, sy))) continue;
      const len = minLen + ints(maxLen - minLen + 1);
      const cells = [[sx, sy]];
      const used = new Set([key(sx, sy)]);
      while (cells.length < len) {
        const [cx, cy] = cells[cells.length - 1];
        const opts2 = DIR_KEYS.map((d) => [cx + DIRS[d][0], cy + DIRS[d][1]]).filter(([x, y]) =>
          x >= 0 && y >= 0 && x < w && y < h && !used.has(key(x, y)) && !occupied.has(key(x, y)) && !rays.has(key(x, y)));
        if (!opts2.length) break;
        const n = opts2[ints(opts2.length)];
        cells.push(n); used.add(key(n[0], n[1]));
      }
      if (cells.length < Math.min(minLen, 2)) continue;
      // 頭朝向：優先沿身體延伸方向（自然的蛇形），否則任一不撞自己的方向
      const order = DIR_KEYS.slice().sort(() => rnd() - 0.5);
      let dir = null;
      if (cells.length > 1) {
        const dx = cells[0][0] - cells[1][0], dy = cells[0][1] - cells[1][1];
        const nat = DIR_KEYS.find((d) => DIRS[d][0] === dx && DIRS[d][1] === dy);
        if (nat && rnd() < 0.6) order.unshift(nat);
      }
      for (const d of order) {
        const r = rayCells(cells, d, w, h);
        if (!r.some(([x, y]) => used.has(key(x, y)))) { dir = d; break; }
      }
      if (!dir) continue;
      for (const c of cells) occupied.add(key(c[0], c[1]));
      for (const [x, y] of rayCells(cells, dir, w, h)) rays.add(key(x, y));
      arrows.push({ id: arrows.length, cells, dir, removed: false });
    }
    return arrows;
  }

  function createState(difficulty, level) {
    const cfg = DIFFICULTIES[difficulty];
    const seed = (Object.keys(DIFFICULTIES).indexOf(difficulty) + 1) * 10007 + level * 131;
    return createStateFromSeed(difficulty, seed);
  }

  function createStateFromSeed(difficulty, seed) {
    const cfg = DIFFICULTIES[difficulty];
    const arrows = generate({ ...cfg, seed });
    return {
      difficulty, seed, w: cfg.w, h: cfg.h, arrows,
      lives: cfg.lives, maxLives: cfg.lives, hints: cfg.hints,
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

  return { DIRS, DIFFICULTIES, LEVELS_PER_DIFFICULTY, mulberry32, generate, createState, createStateFromSeed, rayCells, blockersOf, tap, freeArrows, hint, isSolvable, remaining };
});
