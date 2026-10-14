/* 合成音效／背景音樂（無外部資產、無授權問題）；需使用者手勢後解鎖 */
window.AmazeAudio = (function () {
  let ctx = null, bgmTimer = null, step = 0;
  const S = { bgm: true, sfx: true };
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 587.33];
  function ensure() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f, dur, type, vol, when) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    pop() { if (S.sfx) { tone(660, .12, 'triangle', .12); tone(990, .14, 'triangle', .1, .06); } },
    bonk() { if (S.sfx) { tone(180, .22, 'square', .09); tone(120, .25, 'square', .07, .05); } },
    win() { if (S.sfx) [523, 659, 784, 1047].forEach((f, i) => tone(f, .25, 'triangle', .12, i * .12)); },
    lose() { if (S.sfx) [392, 330, 262].forEach((f, i) => tone(f, .3, 'sine', .12, i * .16)); },
    tick() { if (S.sfx) tone(880, .06, 'sine', .08); },
  };
  function startBgm() {
    stopBgm(); if (!S.bgm) return;
    bgmTimer = setInterval(() => {
      const f = scale[step % scale.length];
      tone(f / 2, .5, 'sine', .035);
      if (step % 2 === 0) tone(f, .35, 'triangle', .03, .05);
      step++;
    }, 480);
  }
  function stopBgm() { if (bgmTimer) clearInterval(bgmTimer); bgmTimer = null; }
  function apply(s) { S.bgm = !!s.bgm; S.sfx = !!s.sfx; if (S.bgm && ctx && ctx.state === 'running') startBgm(); else stopBgm(); }
  function unlock() { ensure(); if (S.bgm && !bgmTimer) startBgm(); }
  return { sfx, apply, unlock };
})();
