/* 棋盤輪廓：以向量圖元（橢圓／矩形／多邊形，可扣洞）定義實物剪影，
   依難度解析度柵格化成「格子遮罩」。純資料＋純函式，瀏覽器與 Node 共用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmazeShapes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const E = (cx, cy, rx, ry, sub) => ({ t: 'e', cx, cy, rx, ry, sub });
  const R = (x, y, w, h, sub) => ({ t: 'r', x, y, w, h, sub });
  const P = (pts, sub) => ({ t: 'p', pts, sub });
  const arc = (cx, cy, rx, ry, a0, a1, n = 18) => Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + (a1 - a0) * i / n) * Math.PI) / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
  const star = (cx, cy, ro, ri) => Array.from({ length: 10 }, (_, i) => {
    const a = (-90 + i * 36) * Math.PI / 180, r = i % 2 ? ri : ro; return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

  // aspect = 寬 / 高
  const SHAPES = [
    // —— 蔬果 ——
    { id: 'apple', name: '蘋果', cat: '蔬果', aspect: 1, prims: [E(.5, .58, .43, .38), R(.46, .06, .08, .22), E(.68, .14, .13, .07), E(.5, .24, .07, .06, true)] },
    { id: 'cherry', name: '櫻桃', cat: '蔬果', aspect: 1, prims: [E(.27, .74, .24, .22), E(.73, .74, .24, .22), P([[.2, .55], [.3, .52], [.58, .08], [.46, .08]]), P([[.8, .55], [.7, .52], [.5, .08], [.62, .08]])] },
    { id: 'strawberry', name: '草莓', cat: '蔬果', aspect: 1, prims: [E(.5, .42, .44, .32), P([[.07, .5], [.93, .5], [.5, 1]]), R(.3, .04, .4, .16), R(.44, 0, .12, .12)] },
    { id: 'pear', name: '梨子', cat: '蔬果', aspect: .85, prims: [E(.5, .72, .42, .27), E(.5, .36, .24, .3), R(.47, .0, .07, .14)] },
    { id: 'carrot', name: '紅蘿蔔', cat: '蔬果', aspect: .8, prims: [P([[.12, .3], [.88, .3], [.5, 1]]), E(.5, .3, .38, .1), R(.3, .0, .1, .26), R(.45, 0, .1, .26), R(.6, .02, .1, .24)] },
    { id: 'pumpkin', name: '南瓜', cat: '蔬果', aspect: 1.2, prims: [E(.27, .6, .26, .36), E(.73, .6, .26, .36), E(.5, .6, .26, .4), R(.45, .1, .1, .16)] },
    { id: 'mushroom', name: '香菇', cat: '蔬果', aspect: 1, prims: [P(arc(.5, .55, .5, .5, 180, 360)), R(.5 - .17, .5, .34, .46), R(.1, .5, .8, .1)] },
    { id: 'watermelon', name: '西瓜', cat: '蔬果', aspect: 1.6, prims: [P(arc(.5, .12, .5, .88, 0, 180, 24)), R(.02, .08, .96, .08), E(.35, .45, .04, .06, true), E(.5, .55, .04, .06, true), E(.65, .45, .04, .06, true)] },
    { id: 'banana', name: '香蕉', cat: '蔬果', aspect: 1.2, prims: [E(.5, .48, .5, .5), E(.5, .26, .5, .5, true), R(.02, .12, .1, .16)] },
    { id: 'grapes', name: '葡萄', cat: '蔬果', aspect: .9, prims: [E(.25, .3, .2, .16), E(.5, .3, .2, .16), E(.75, .3, .2, .16), E(.37, .55, .2, .16), E(.63, .55, .2, .16), E(.5, .8, .2, .16), R(.46, .0, .08, .18)] },
    { id: 'eggplant', name: '茄子', cat: '蔬果', aspect: .75, prims: [E(.45, .68, .34, .3), E(.55, .35, .22, .28), R(.5, .0, .1, .14), P([[.3, .05], [.7, .05], [.62, .22], [.38, .22]])] },
    // —— 動物 ——
    { id: 'cat', name: '小貓', cat: '動物', aspect: 1, prims: [E(.5, .62, .43, .36), P([[.08, .5], [.14, .04], [.42, .3]]), P([[.92, .5], [.86, .04], [.58, .3]]), E(.36, .58, .05, .06, true), E(.64, .58, .05, .06, true)] },
    { id: 'rabbit', name: '兔子', cat: '動物', aspect: .85, prims: [E(.5, .72, .38, .27), E(.34, .26, .11, .26), E(.66, .26, .11, .26)] },
    { id: 'fish', name: '小魚', cat: '動物', aspect: 1.5, prims: [E(.4, .5, .4, .36), P([[.68, .5], [1, .12], [1, .88]]), E(.2, .42, .04, .05, true)] },
    { id: 'duck', name: '小鴨', cat: '動物', aspect: 1.1, prims: [E(.42, .68, .4, .28), E(.68, .3, .2, .2), P([[.84, .28], [1, .36], [.84, .44]]), P([[.1, .55], [0, .4], [.2, .5]])] },
    { id: 'turtle', name: '烏龜', cat: '動物', aspect: 1.35, prims: [E(.45, .48, .4, .34), E(.9, .5, .1, .12), R(.15, .74, .14, .2), R(.6, .74, .14, .2), P([[.05, .5], [0, .62], [.12, .6]])] },
    { id: 'butterfly', name: '蝴蝶', cat: '動物', aspect: 1.1, prims: [E(.26, .34, .24, .3), E(.74, .34, .24, .3), E(.3, .74, .18, .2), E(.7, .74, .18, .2), R(.46, .12, .08, .76), R(.38, .0, .06, .16), R(.56, .0, .06, .16)] },
    { id: 'snail', name: '蝸牛', cat: '動物', aspect: 1.3, prims: [E(.45, .4, .32, .38), R(.02, .72, .96, .22), E(.9, .62, .08, .16), E(.45, .4, .14, .16, true)] },
    { id: 'bear', name: '小熊', cat: '動物', aspect: 1, prims: [E(.5, .6, .4, .38), E(.18, .2, .15, .15), E(.82, .2, .15, .15)] },
    { id: 'bird', name: '小鳥', cat: '動物', aspect: 1.2, prims: [E(.45, .55, .36, .3), E(.8, .38, .17, .17), P([[.94, .36], [1, .42], [.94, .48]]), P([[.1, .5], [0, .8], [.28, .65]]), R(.38, .82, .05, .16), R(.52, .82, .05, .16)] },
    // —— 交通工具 ——
    { id: 'car', name: '汽車', cat: '交通工具', aspect: 1.7, prims: [R(.04, .45, .92, .3), P([[.22, .46], [.34, .14], [.66, .14], [.8, .46]]), E(.26, .76, .13, .2), E(.74, .76, .13, .2), R(.38, .22, .1, .2, true), R(.52, .22, .1, .2, true)] },
    { id: 'bus', name: '公車', cat: '交通工具', aspect: 1.7, prims: [R(.03, .12, .94, .64), E(.25, .8, .11, .17), E(.75, .8, .11, .17), R(.1, .24, .2, .22, true), R(.4, .24, .2, .22, true), R(.7, .24, .2, .22, true)] },
    { id: 'plane', name: '飛機', cat: '交通工具', aspect: 1.15, prims: [E(.5, .5, .09, .46), P([[.5, .34], [.99, .64], [.99, .74], [.5, .6], [.01, .74], [.01, .64]]), P([[.5, .8], [.76, .96], [.24, .96]])] },
    { id: 'sailboat', name: '帆船', cat: '交通工具', aspect: 1, prims: [P([[.46, .04], [.46, .68], [.1, .68]]), P([[.54, .14], [.54, .68], [.9, .68]]), R(.47, .02, .06, .7), P([[.06, .74], [.94, .74], [.76, .96], [.24, .96]])] },
    { id: 'rocket', name: '火箭', cat: '交通工具', aspect: .75, prims: [E(.5, .42, .23, .4), P([[.27, .62], [.04, .94], [.3, .84]]), P([[.73, .62], [.96, .94], [.7, .84]]), P([[.38, .8], [.62, .8], [.5, 1]]), E(.5, .32, .09, .08, true)] },
    { id: 'truck', name: '卡車', cat: '交通工具', aspect: 1.7, prims: [R(.03, .15, .6, .55), R(.63, .35, .34, .35), E(.2, .76, .11, .19), E(.5, .76, .11, .19), E(.8, .76, .11, .19), R(.7, .42, .15, .12, true)] },
    { id: 'train', name: '火車', cat: '交通工具', aspect: 1.5, prims: [R(.1, .28, .8, .46), R(.14, .08, .14, .22), E(.28, .8, .12, .16), E(.55, .8, .12, .16), E(.8, .8, .12, .16), R(.5, .38, .14, .16, true), R(.7, .38, .14, .16, true)] },
    // —— 生活萬物 ——
    { id: 'heart', name: '愛心', cat: '生活', aspect: 1.05, prims: [E(.29, .32, .27, .27), E(.71, .32, .27, .27), P([[.04, .42], [.96, .42], [.5, .97]])] },
    { id: 'star', name: '星星', cat: '生活', aspect: 1, prims: [P(star(.5, .54, .52, .22))] },
    { id: 'house', name: '房子', cat: '生活', aspect: 1, prims: [R(.14, .45, .72, .5), P([[.03, .48], [.5, .04], [.97, .48]]), R(.42, .66, .16, .29, true), R(.7, .08, .1, .22)] },
    { id: 'tree', name: '小樹', cat: '生活', aspect: .85, prims: [E(.5, .35, .42, .34), E(.3, .55, .26, .2), E(.7, .55, .26, .2), R(.43, .6, .14, .38)] },
    { id: 'flower', name: '花朵', cat: '生活', aspect: .8, prims: [E(.5, .17, .14, .16), E(.5, .5, .14, .16), E(.2, .33, .16, .14), E(.8, .33, .16, .14), E(.3, .5, .12, .12), E(.7, .5, .12, .12), E(.5, .33, .12, .12), R(.46, .5, .08, .5), E(.28, .8, .2, .08), E(.72, .72, .2, .08)] },
    { id: 'moon', name: '月亮', cat: '生活', aspect: .9, prims: [E(.5, .5, .5, .5), E(.7, .42, .42, .42, true)] },
    { id: 'cloud', name: '雲朵', cat: '生活', aspect: 1.6, prims: [E(.3, .6, .24, .3), E(.55, .45, .28, .36), E(.78, .62, .2, .26), R(.1, .62, .78, .3)] },
    { id: 'icecream', name: '冰淇淋', cat: '生活', aspect: .8, prims: [E(.5, .3, .36, .28), E(.5, .14, .2, .14), P([[.16, .42], [.84, .42], [.5, 1]])] },
    { id: 'umbrella', name: '雨傘', cat: '生活', aspect: 1, prims: [P(arc(.5, .5, .5, .45, 180, 360)), R(.43, .5, .14, .4), E(.36, .9, .14, .1), E(.36, .9, .05, .04, true)] },
    { id: 'cup', name: '杯子', cat: '生活', aspect: 1.2, prims: [R(.1, .25, .6, .65), E(.8, .5, .17, .22), E(.8, .5, .08, .12, true), P([[.25, .0], [.3, .2], [.2, .2]]), P([[.5, .0], [.55, .2], [.45, .2]])] },
    { id: 'key', name: '鑰匙', cat: '生活', aspect: 1.6, prims: [E(.22, .5, .21, .38), E(.22, .5, .08, .14, true), R(.4, .42, .58, .16), R(.74, .58, .1, .2), R(.9, .58, .08, .26)] },
    // —— 幾何（讓盤面不一定是方形）——
    { id: 'rect34', name: '長方形', cat: '幾何', aspect: 1.33, prims: [R(0, 0, 1, 1)] },
    { id: 'rect43', name: '直長方形', cat: '幾何', aspect: .75, prims: [R(0, 0, 1, 1)] },
    { id: 'wide', name: '寬板', cat: '幾何', aspect: 1.8, prims: [R(0, 0, 1, 1)] },
    { id: 'oval', name: '橢圓', cat: '幾何', aspect: 1.3, prims: [E(.5, .5, .5, .5)] },
    { id: 'diamond', name: '菱形', cat: '幾何', aspect: 1, prims: [P([[.5, 0], [1, .5], [.5, 1], [0, .5]])] },
    { id: 'ring', name: '回字框', cat: '幾何', aspect: 1, prims: [R(0, 0, 1, 1), R(.3, .3, .4, .4, true)] },
    { id: 'cross', name: '十字', cat: '幾何', aspect: 1, prims: [R(.33, 0, .34, 1), R(0, .33, 1, .34)] },
    { id: 'lshape', name: 'L 形', cat: '幾何', aspect: 1, prims: [R(0, 0, .4, 1), R(0, .6, 1, .4)] },
  ];

  function inPoly(x, y, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function hit(p, x, y) {
    if (p.t === 'e') return ((x - p.cx) / p.rx) ** 2 + ((y - p.cy) / p.ry) ** 2 <= 1;
    if (p.t === 'r') return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
    return inPoly(x, y, p.pts);
  }
  function inside(shape, x, y) {
    let on = false;
    for (const p of shape.prims) if (!p.sub && hit(p, x, y)) { on = true; break; }
    if (!on) return false;
    for (const p of shape.prims) if (p.sub && hit(p, x, y)) return false;
    return true;
  }

  /** 以 dim（長邊格數）柵格化；回傳 { w, h, rows:['0110',...] }，flip 為左右鏡射 */
  function rasterize(shape, dim, flip) {
    const a = shape.aspect;
    let W, H;
    if (a >= 1) { W = dim; H = Math.max(3, Math.round(dim / a)); } else { H = dim; W = Math.max(3, Math.round(dim * a)); }
    const S = 4, grid = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++)
          if (inside(shape, (x + (sx + .5) / S) / W, (y + (sy + .5) / S) / H)) n++;
        row.push(n / (S * S) >= 0.4);
      }
      grid.push(row);
    }
    // 去除過小的零碎連通塊（< 4 格），避免畫面出現斷開的小點
    const seen = grid.map((r) => r.map(() => false));
    for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
      if (!grid[y0][x0] || seen[y0][x0]) continue;
      const comp = [], q = [[x0, y0]]; seen[y0][x0] = true;
      while (q.length) {
        const [x, y] = q.pop(); comp.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[ny][nx] && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); }
        }
      }
      if (comp.length < 4) for (const [x, y] of comp) grid[y][x] = false;
    }
    // 裁掉全空的外圈，讓棋盤貼合輪廓
    const any = (r) => r.some(Boolean);
    while (grid.length > 1 && !any(grid[0])) grid.shift();
    while (grid.length > 1 && !any(grid[grid.length - 1])) grid.pop();
    const colAny = (x) => grid.some((r) => r[x]);
    while (grid[0].length > 1 && !colAny(0)) grid.forEach((r) => r.shift());
    while (grid[0].length > 1 && !colAny(grid[0].length - 1)) grid.forEach((r) => r.pop());
    W = grid[0].length; H = grid.length;
    const rows = grid.map((r) => { const s = r.map((v) => (v ? '1' : '0')).join(''); return flip ? s.split('').reverse().join('') : s; });
    return { w: W, h: H, rows };
  }

  return { SHAPES, rasterize, inside };
});
