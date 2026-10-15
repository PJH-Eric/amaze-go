/* 棋盤繪製與動畫（單機與線上共用）。只負責畫面，不含規則。 */
window.AmazeBoard = (function () {
  const R = window.AmazeRules;
  const C = 60, NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#d62839', '#2a6fdb', '#16294f', '#ef8a2e', '#1f9d8a', '#7a4fd6', '#e0568a'];
  const DARK = ['#d9577f', '#3fae96', '#e0993a', '#4f9be6', '#9a78e0', '#e0724d', '#6cb85a'];
  const DIRNAME = { U: '上', D: '下', L: '左', R: '右' };
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // 轉折處改成圓滑彎角（像路標彎箭頭），r 為彎角半徑
  function rounded(pts, r) {
    if (pts.length < 3) return 'M' + pts.map((p) => p.join(' ')).join(' L');
    let d = 'M' + pts[0].join(' ');
    for (let i = 1; i < pts.length - 1; i++) {
      const [px0, py0] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(x - px0, y - py0), l2 = Math.hypot(nx - x, ny - y), rr = Math.min(r, l1 / 2, l2 / 2);
      const ax = x + (px0 - x) / l1 * rr, ay = y + (py0 - y) / l1 * rr, bx = x + (nx - x) / l2 * rr, by = y + (ny - y) / l2 * rr;
      d += ` L${ax} ${ay} Q${x} ${y} ${bx} ${by}`;
    }
    return d + ' L' + pts[pts.length - 1].join(' ');
  }
  function shape(a) {
    const pts = a.cells.map(([x, y]) => [x * C + C / 2, y * C + C / 2]);
    const [dx, dy] = R.DIRS[a.dir], head = pts[0], px = -dy, py = dx;
    // 線身一路延伸過頭部格的中心再往箭頭方向伸出一小段 → 轉折處一定看得到「轉彎後指向哪裡」
    const stem = [head[0] + dx * 12, head[1] + dy * 12];
    // 尾端也往外多延伸半格（沿最後一段方向），讓前後相接的箭頭之間沒有斷開的縫
    const L = pts.length, tailDir = L > 1 ? [pts[L - 1][0] - pts[L - 2][0], pts[L - 1][1] - pts[L - 2][1]] : [-dx * C, -dy * C];
    const tl = Math.hypot(tailDir[0], tailDir[1]) || 1;
    const tail = [pts[L - 1][0] + tailDir[0] / tl * 9, pts[L - 1][1] + tailDir[1] / tl * 9];
    const poly = rounded([stem].concat(pts, [tail]), 20);
    const at = (f, w) => [head[0] + dx * f + px * w, head[1] + dy * f + py * w].join(',');
    const tri = [at(31, 0), at(12, 20), at(12, -20)].join(' ');
    return { poly, line: [stem].concat(pts, [tail]), tri, head, dx, dy, px, py, fc: [head[0] + dx * 18, head[1] + dy * 18] };
  }
  // 可愛臉：白眼睛＋黑瞳孔＋微笑＋粉紅腮紅（臉保持正向，方向由三角形尖端表示）
  function face(g, cx, cy) {
    const f = el('g', { class: 'face', transform: `translate(${cx} ${cy}) scale(.72) translate(${-cx} ${-cy})` }, g);
    [-1, 1].forEach((k) => { el('circle', { cx: cx + k * 6, cy: cy - 3, r: 4.6, fill: '#fff' }, f); el('circle', { cx: cx + k * 6, cy: cy - 2.6, r: 2.4, fill: '#3b2a33' }, f); });
    el('path', { d: `M${cx - 3.2} ${cy + 3.6} q3.2 3.2 6.4 0`, fill: 'none', stroke: '#3b2a33', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, f);
    [-1, 1].forEach((k) => el('circle', { cx: cx + k * 10.5, cy: cy + 3.2, r: 3.2, fill: '#ff9db8', opacity: 0.9 }, f));
  }
  function create(svg, opts) {
    let state = null, enabled = true, zoom = 1;
    const wrap = svg.parentElement, host = wrap.parentElement;
    function applyZoom(z) {
      const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / (wrap.scrollWidth || 1), cy = (wrap.scrollTop + wrap.clientHeight / 2) / (wrap.scrollHeight || 1);
      zoom = Math.max(1, Math.min(3.5, z));
      svg.style.width = zoom * 100 + '%'; svg.style.height = zoom * 100 + '%';
      wrap.classList.toggle('zoomed', zoom > 1);
      zin.disabled = zoom >= 3.5; zout.disabled = zoom <= 1;
      // 以目前畫面中心為準縮放（不會跳到角落）
      wrap.scrollLeft = cx * wrap.scrollWidth - wrap.clientWidth / 2; wrap.scrollTop = cy * wrap.scrollHeight - wrap.clientHeight / 2;
    }
    const zbtn = (txt, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'zbtn'; b.textContent = txt; b.setAttribute('aria-label', label); b.onclick = fn; return b; };
    const zin = zbtn('＋', '放大棋盤', () => applyZoom(zoom + 0.75));
    const zout = zbtn('－', '縮小棋盤', () => applyZoom(zoom - 0.75));
    const zbar = document.createElement('div'); zbar.className = 'zbar'; zbar.append(zin, zout); host.appendChild(zbar);
    applyZoom(1);
    // 滑鼠 Ctrl＋滾輪、雙指捏合、鍵盤 + / - / 0 也能縮放
    wrap.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); applyZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    const pts = new Map(); let d0 = 0, z0 = 1;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    wrap.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { d0 = dist(); z0 = zoom; } });
    wrap.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && d0) applyZoom(z0 * dist() / d0); });
    const up = (e) => { pts.delete(e.pointerId); d0 = 0; };
    wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
    document.addEventListener('keydown', (e) => {
      if (!svg.isConnected || !svg.offsetParent || e.target.closest('input,textarea') || document.querySelector('.modal:not([hidden]),.result:not([hidden])')) return;
      if (e.key === '+' || e.key === '=') applyZoom(zoom + 0.75); else if (e.key === '-') applyZoom(zoom - 0.75); else if (e.key === '0') applyZoom(1);
    });
    const node = (id) => svg.querySelector('.arrow[data-id="' + id + '"]');
    const headOf = (id) => svg.querySelector('.head[data-id="' + id + '"]');   // 箭頭尖端畫在最上層：永遠不會被任何線條蓋住
    function draw(st) {
      state = st; svg.innerHTML = ''; applyZoom(1); wrap.scrollLeft = 0; wrap.scrollTop = 0;
      svg.setAttribute('viewBox', `-14 -14 ${st.w * C + 28} ${st.h * C + 28}`);
      // 底色只用淡淡的填色襯出輪廓，不畫外框線（避免誤以為箭頭飛不出去）
      for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
        if (st.mask[y][x] !== '1') continue;
        el('rect', { x: x * C - 1, y: y * C - 1, width: C + 2, height: C + 2, fill: '#fff', 'fill-opacity': 0.55 }, svg);
      }
      const bodies = svg, heads = el('g', { class: 'heads', 'pointer-events': 'none' }, svg);
      const live = st.arrows.filter((a) => !a.removed);
      // 線身外加白色細邊，相鄰線條與轉角清楚分開
      live.forEach((a) => {
        const color = COLORS[a.id % COLORS.length], s = shape(a);
        const g = el('g', { class: 'arrow', tabindex: 0, role: 'button', 'data-id': a.id, 'aria-label': '箭頭 ' + (a.id + 1) + '，朝' + DIRNAME[a.dir] });
        bodies.insertBefore(g, heads);
        const hd = el('g', { class: 'head', 'data-id': a.id }, heads);
        hd.style.setProperty('--sx', s.dx * 10 + 'px'); hd.style.setProperty('--sy', s.dy * 10 + 'px');
        g.style.setProperty('--sx', s.dx * 10 + 'px'); g.style.setProperty('--sy', s.dy * 10 + 'px');
        el('path', { class: 'halo', d: s.poly }, g);
        el('path', { d: s.poly, fill: 'none', stroke: '#fffafc', 'stroke-width': 24, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        el('path', { d: s.poly, fill: 'none', stroke: color, 'stroke-width': 21, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        el('polygon', { points: s.tri, fill: color, stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, hd);
        face(hd, s.fc[0], s.fc[1]);
        el('path', { d: s.poly, fill: 'none', stroke: 'transparent', 'stroke-width': 50, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        const tap = () => enabled && opts.onTap(a.id);
        const lift = (on) => { g.classList.toggle('lift', on); hd.classList.toggle('lift', on); };
        g.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'mouse' || !enabled) return; if (g.nextSibling !== heads) bodies.insertBefore(g, heads); lift(true); });   // 滑鼠移上去：浮起
        g.addEventListener('pointerleave', () => lift(false));
        g.addEventListener('focus', () => lift(true)); g.addEventListener('blur', () => lift(false));
        g.addEventListener('click', tap);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
      });
    }
    // 沿著自己的路徑滑出去：頭領先、身體隨路徑轉彎、尾巴最後離開（參考錄影）
    function fly(id) {
      const a = state.arrows[id], n = node(id); if (!n) return;
      if (document.body.classList.contains('reduce')) { n.remove(); const h1 = headOf(id); h1 && h1.remove(); return; }
      const sh = shape(a), [dx, dy] = R.DIRS[a.dir], color = COLORS[a.id % COLORS.length];
      const base = sh.line.slice().reverse();                 // 尾 → 頭（stem）
      const cum = [0]; for (let i = 1; i < base.length; i++) cum.push(cum[i - 1] + Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]));
      const Lb = cum[cum.length - 1], h = a.cells[0];
      const edge = (a.dir === 'U' ? h[1] + 1 : a.dir === 'D' ? state.h - h[1] : a.dir === 'L' ? h[0] + 1 : state.w - h[0]) * C;
      const uEnd = 2 * Lb + edge + 80;
      const end = base[base.length - 1], far = [end[0] + dx * (uEnd - Lb + 20), end[1] + dy * (uEnd - Lb + 20)];
      const P = base.concat([far]); cum.push(Lb + Math.hypot(far[0] - end[0], far[1] - end[1]));
      const at = (u) => { for (let i = 1; i < P.length; i++) if (u <= cum[i] || i === P.length - 1) { const t = (u - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, i]; } };
      const clip = (u0, u1) => { const A = at(Math.max(0, u0)), B = at(u1), pts = [[A[0], A[1]]]; for (let i = A[2]; i < B[2]; i++) pts.push(P[i]); pts.push([B[0], B[1]]); return pts; };
      const g = el('g', { class: 'snake' }, svg);
      const edgeP = el('path', { fill: 'none', stroke: '#fffafc', 'stroke-width': 24, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      const bodyP = el('path', { fill: 'none', stroke: color, 'stroke-width': 21, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      const hg = el('g', {}, g);
      el('polygon', { points: '19,0 0,20 0,-20', fill: color, stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, hg);
      const fg = el('g', {}, g); face(fg, 0, 0);
      n.style.visibility = 'hidden'; n.style.pointerEvents = 'none'; const hd0 = headOf(id); hd0 && (hd0.style.visibility = 'hidden');
      const dur = Math.max(420, Math.min(950, 320 + (uEnd - Lb) * 0.5)), t0 = performance.now();
      const frame = (now) => {
        const k = Math.max(0, Math.min(1, (now - t0) / dur)), u = Lb + (uEnd - Lb) * Math.pow(k, 1.7);   // 越滑越快
        const pts = clip(u - Lb, u), d = rounded(pts, 20);
        edgeP.setAttribute('d', d); bodyP.setAttribute('d', d);
        const hp = pts[pts.length - 1];
        hg.setAttribute('transform', `translate(${hp[0]} ${hp[1]}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`);
        fg.setAttribute('transform', `translate(${hp[0] + dx * 6} ${hp[1] + dy * 6})`);
        if (k < 1) requestAnimationFrame(frame); else { g.remove(); n.remove(); hd0 && hd0.remove(); }
      };
      requestAnimationFrame(frame);
    }
    function flash(id, cls, ms) {
      const n = node(id); if (!n) return; const h = headOf(id), all = h ? [n, h] : [n];
      all.forEach((e) => e.classList.remove(cls)); void n.getBBox(); all.forEach((e) => e.classList.add(cls)); setTimeout(() => all.forEach((e) => e.classList.remove(cls)), ms);
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
