/* 自繪捲軸：隱藏瀏覽器原生捲軸，改畫可拖曳、可點軌道翻頁、觸控捲動時自動顯示的粉彩捲軸。
   用法：AmazeScroll.attach(el, { label })；el 需為 overflow:auto 的容器，其父層會被設成定位基準。 */
window.AmazeScroll = (function () {
  const items = new Set();
  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; items.forEach((i) => i.update()); }); }
  function attach(el, opts) {
    if (!el || el._cs) return el && el._cs;
    opts = opts || {};
    el.classList.add('cs');
    if (opts.label) { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'region'); el.setAttribute('aria-label', opts.label); }
    const host = el.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const make = (axis) => {
      const track = document.createElement('div'); track.className = 'cs-track cs-' + axis; track.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('div'); thumb.className = 'cs-thumb'; track.appendChild(thumb); host.appendChild(track);
      return { axis, track, thumb };
    };
    const bars = [make('y'), make('x')];
    let hideT = 0;
    function update() {
      const vis = el.offsetParent !== null && el.clientWidth > 0;
      bars.forEach((b) => {
        const y = b.axis === 'y';
        const size = y ? el.clientHeight : el.clientWidth, total = y ? el.scrollHeight : el.scrollWidth, pos = y ? el.scrollTop : el.scrollLeft;
        const need = vis && total > size + 1;
        b.track.style.display = need ? '' : 'none';
        if (!need) return;
        const other = bars.find((x) => x !== b), otherNeed = !y ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
        // 以實際畫面位置換算到父層座標，避免 el 的 offsetParent 不是父層時軌道飄離容器（如首頁 #home）
        const hr = host.getBoundingClientRect(), er = el.getBoundingClientRect();
        const ox = er.left - hr.left - host.clientLeft + host.scrollLeft + el.clientLeft;
        const oy = er.top - hr.top - host.clientTop + host.scrollTop + el.clientTop;
        const topGap = y ? (parseInt(el.dataset.csTop, 10) || 0) : 0; // 讓軌道避開右上角設定鈕等浮動元件
        const len = size - (otherNeed ? 12 : 0) - 8 - topGap;
        const tl = Math.max(32, Math.round(len * size / total)), travel = len - tl;
        const off = travel * (pos / (total - size || 1));
        b.track.style.cssText = y
          ? `display:;left:${ox + el.clientWidth - 10}px;top:${oy + 4 + topGap}px;height:${len}px;width:8px`
          : `display:;left:${ox + 4}px;top:${oy + el.clientHeight - 10}px;width:${len}px;height:8px`;
        b.thumb.style[y ? 'height' : 'width'] = tl + 'px';
        b.thumb.style.transform = y ? `translateY(${off}px)` : `translateX(${off}px)`;
        b.travel = travel; b.tl = tl;
      });
    }
    function flash() { bars.forEach((b) => b.track.classList.add('on')); clearTimeout(hideT); hideT = setTimeout(() => bars.forEach((b) => b.track.classList.remove('on')), 1100); }
    el.addEventListener('scroll', () => { update(); flash(); }, { passive: true });
    el.addEventListener('pointerenter', flash);
    bars.forEach((b) => {
      const y = b.axis === 'y';
      b.thumb.addEventListener('pointerdown', (e) => {
        e.preventDefault(); b.thumb.setPointerCapture(e.pointerId);
        const start = y ? e.clientY : e.clientX, from = y ? el.scrollTop : el.scrollLeft;
        const total = y ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
        const move = (ev) => { const d = (y ? ev.clientY : ev.clientX) - start; const v = from + d * (total / (b.travel || 1)); el[y ? 'scrollTop' : 'scrollLeft'] = v; };
        const up = () => { b.thumb.removeEventListener('pointermove', move); b.thumb.removeEventListener('pointerup', up); b.thumb.removeEventListener('pointercancel', up); b.track.classList.remove('drag'); };
        b.track.classList.add('drag', 'on');
        b.thumb.addEventListener('pointermove', move); b.thumb.addEventListener('pointerup', up); b.thumb.addEventListener('pointercancel', up);
      });
      b.track.addEventListener('pointerdown', (e) => {
        if (e.target !== b.track) return;
        const r = b.track.getBoundingClientRect(), pt = y ? e.clientY - r.top : e.clientX - r.left;
        const dir = pt < (parseFloat(b.thumb.style.transform.replace(/[^\d.-]/g, '')) || 0) ? -1 : 1;
        el.scrollBy({ [y ? 'top' : 'left']: dir * (y ? el.clientHeight : el.clientWidth) * 0.85, behavior: 'smooth' });
      });
    });
    const api = { update, el };
    el._cs = api; items.add(api);
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(el);
    new MutationObserver(schedule).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
    update();
    return api;
  }
  window.addEventListener('resize', schedule); window.addEventListener('orientationchange', schedule);
  return { attach, refresh: schedule };
})();
