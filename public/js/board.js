/* 棋盤繪製與動畫（單機與線上共用）。只負責畫面，不含規則。 */
window.AmazeBoard = (function () {
  const R = window.AmazeRules;
  const C = 60, NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#ff8fb1', '#7fd6c2', '#ffc26b', '#8fc7ff', '#c3a6ff', '#ff9d7a', '#9ddc8a'];
  const DIRNAME = { U: '上', D: '下', L: '左', R: '右' };
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function shape(a) {
    const pts = a.cells.map(([x, y]) => [x * C + C / 2, y * C + C / 2]);
    const [dx, dy] = R.DIRS[a.dir], head = pts[0], px = -dy, py = dx;
    const poly = pts.map((p) => p.join(',')).join(' ');
    const tip = [head[0] + dx * 29, head[1] + dy * 29];
    const tri = [tip, [head[0] + px * 21 - dx * 6, head[1] + py * 21 - dy * 6], [head[0] - px * 21 - dx * 6, head[1] - py * 21 - dy * 6]].map((p) => p.join(',')).join(' ');
    return { poly, tri, head, dx, dy, px, py };
  }
  function create(svg, opts) {
    let state = null, enabled = true;
    const node = (id) => svg.querySelector('.arrow[data-id="' + id + '"]');
    function draw(st) {
      state = st; svg.innerHTML = '';
      svg.setAttribute('viewBox', `-14 -14 ${st.w * C + 28} ${st.h * C + 28}`);
      for (const pass of [0, 1]) for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
        if (st.mask[y][x] !== '1') continue;
        el('rect', pass === 0
          ? { x: x * C - 2, y: y * C - 2, width: C + 4, height: C + 4, rx: 6, fill: '#f3cfdc', stroke: '#f3cfdc', 'stroke-width': 12, 'stroke-linejoin': 'round' }
          : { x: x * C - 1, y: y * C - 1, width: C + 2, height: C + 2, fill: '#fffafc' }, svg);
      }
      st.arrows.forEach((a) => {
        if (a.removed) return;
        const color = COLORS[a.id % COLORS.length], s = shape(a);
        const g = el('g', { class: 'arrow', tabindex: 0, role: 'button', 'data-id': a.id, 'aria-label': '箭頭 ' + (a.id + 1) + '，朝' + DIRNAME[a.dir] }, svg);
        g.style.setProperty('--sx', s.dx * 10 + 'px'); g.style.setProperty('--sy', s.dy * 10 + 'px');
        el('polyline', { class: 'halo', points: s.poly }, g);
        el('polyline', { points: s.poly, fill: 'none', stroke: '#fff', 'stroke-width': 25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        el('polyline', { points: s.poly, fill: 'none', stroke: color, 'stroke-width': 19, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        el('polygon', { points: s.tri, fill: color, stroke: '#fff', 'stroke-width': 3.5, 'stroke-linejoin': 'round' }, g);
        el('polyline', { points: s.poly, fill: 'none', stroke: 'transparent', 'stroke-width': 40, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        const tap = () => enabled && opts.onTap(a.id);
        g.addEventListener('click', tap);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
      });
    }
    function fly(id) {
      const a = state.arrows[id], n = node(id); if (!n) return;
      const h = a.cells[0];
      const dist = (a.dir === 'U' ? h[1] + 1 : a.dir === 'D' ? state.h - h[1] : a.dir === 'L' ? h[0] + 1 : state.w - h[0]) + a.cells.length + 1;
      const [dx, dy] = R.DIRS[a.dir];
      n.style.setProperty('--fx', dx * dist * C + 'px'); n.style.setProperty('--fy', dy * dist * C + 'px');
      n.classList.add('fly'); setTimeout(() => n.remove(), 520);
    }
    function flash(id, cls, ms) {
      const n = node(id); if (!n) return;
      n.classList.remove(cls); void n.getBBox(); n.classList.add(cls); setTimeout(() => n.classList.remove(cls), ms);
    }
    return {
      draw, fly,
      shake: (id, blockers) => { flash(id, 'shake', 400); (blockers || []).forEach((b) => flash(b, 'blocker', 700)); },
      hint: (id) => flash(id, 'hint', 2000),
      late: (id) => flash(id, 'late', 500),
      setEnabled: (v) => { enabled = v; },
      get state() { return state; },
    };
  }
  return { create };
})();
