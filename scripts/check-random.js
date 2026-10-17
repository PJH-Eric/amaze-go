/* 單機隨機模式：真實按鈕操作、五難度、紀錄隔離、雙語與 RWD。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { server } = require('../server.js');
const sizes = [[320, 568], [360, 640], [393, 786], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900]];
const output = process.env.RANDOM_SCREENSHOTS || path.join(os.tmpdir(), 'amaze-random');

async function clear(page) {
  while (await page.evaluate(() => __amaze.state.status === 'playing')) {
    const id = await page.evaluate(() => AmazeRules.freeArrows(__amaze.state)[0]);
    assert.notEqual(id, undefined, '隨機盤面應有解');
    await page.locator('#board .arrow[data-id="' + id + '"]').press('Enter');
  }
  await page.locator('#result').waitFor({ state: 'visible' });
}

async function bounds(page, selector) {
  const bad = await page.locator(selector).evaluateAll((nodes) => nodes.filter((n) => n.getClientRects().length).filter((n) => {
    const r = n.getBoundingClientRect();
    return r.left < -1 || r.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
  }).map((n) => n.id || n.className));
  assert.deepEqual(bad, [], '水平溢出：' + selector);
}

(async () => {
  let browser;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce', viewport: { width: 393, height: 786 } });
    await context.addInitScript(() => {
      localStorage.setItem('game-island-lang', 'zh-Hant');
      localStorage.setItem('amaze.stars', JSON.stringify({ normal: { 1: 4, 2: 5 } }));
      localStorage.setItem('amaze.times', JSON.stringify({ normal: { 1: 12345 } }));
      localStorage.setItem('amaze.diff', 'normal');
      localStorage.setItem('amaze.settings', JSON.stringify({ bgm: false, sfx: false, reduce: true }));
      window.__events = [];
      window.gtag = (name, event, params) => __events.push({ name, event, params });
    });
    const page = await context.newPage(), errors = [], sockets = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (s) => sockets.push(s.url()));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await context.setOffline(true);
    const records = () => page.evaluate(() => ['amaze.stars', 'amaze.times', 'amaze.diff'].map((k) => localStorage.getItem(k)));
    const saved = await records();
    await page.locator('#randomBtn').tap();
    for (const difficulty of ['toddler', 'easy', 'normal', 'hard', 'myth']) {
      await page.locator('#randomChips [data-v="' + difficulty + '"]').tap();
      await page.locator('#randomStart').tap();
      assert.ok(await page.evaluate((d) => {
        const s = __amaze.state, cfg = AmazeRules.DIFFICULTIES[d];
        return __amaze.mode === 'random' && !('level' in s) && s.difficulty === d && s.lives === cfg.lives && s.hints === cfg.hints && AmazeRules.isSolvable(s);
      }, difficulty));
      const original = await page.evaluate(() => JSON.stringify(__amaze.state));
      const expectedTarget = await page.evaluate((d) => AmazeApp.fmtTime(Math.round((5 + __amaze.state.arrows.length * { toddler: 1, easy: 1.2, normal: 1.5, hard: 1.7, myth: 2 }[d]) * 1000)), difficulty);
      const blocked = await page.evaluate(() => __amaze.state.arrows.find((a) => AmazeRules.blockersOf(__amaze.state, a.id).length)?.id);
      if (blocked != null) await page.locator('#board .arrow[data-id="' + blocked + '"]').press('Enter');
      if (await page.locator('#hintBtn').isEnabled()) await page.locator('#hintBtn').tap();
      await page.locator('#restartBtn').tap();
      assert.equal(await page.evaluate(() => JSON.stringify(__amaze.state)), original, '重來應還原原盤面與資源');
      await page.evaluate(() => I18N.setLang('en'));
      assert.equal(await page.evaluate(() => JSON.stringify(__amaze.state)), original, '切換語言不可重置隨機盤面');
      assert.match(await page.locator('#gameTitle').textContent(), /Random/);
      await clear(page);
      for (const id of ['resultStars', 'resultBest']) assert.equal(await page.locator('#' + id).isVisible(), false);
      assert.equal(await page.locator('#resultTargetStat').isVisible(), true);
      assert.match(await page.locator('#resultTarget').textContent(), /^\d+:\d{2}\.\d{2}$/);
      assert.equal(await page.locator('#resultTarget').textContent(), expectedTarget, '目標時間依本盤難度與箭頭數量計算');
      assert.equal(await page.locator('#resultTargetStatus').textContent(), 'On target');
      assert.equal(await page.locator('#resultTitle').textContent(), 'Puzzle cleared!');
      assert.equal(await page.locator('#againBtn').textContent(), 'New Puzzle');
      assert.equal(await page.locator('#roomBtn').isVisible(), false);
      assert.equal(await page.locator('#result .stack .btn:visible').count(), 3);
      await page.evaluate(() => I18N.setLang('zh-Hant'));
      assert.equal(await page.locator('#againBtn').textContent(), '再來一局（新盤面）');
      assert.equal(await page.locator('#replayBtn').textContent(), '重玩這盤');
      assert.doesNotMatch(await page.locator('#resultLevel').textContent(), /第\s*\d+\s*關/);
      await page.locator('#replayBtn').tap();
      assert.equal(await page.evaluate(() => JSON.stringify(__amaze.state)), original);
      await clear(page);
      const seed = await page.evaluate(() => __amaze.state.seed);
      await page.locator('#againBtn').tap();
      assert.notEqual(await page.evaluate(() => __amaze.state.seed), seed, '再來一局應產生新盤面');
      await page.locator('#backBtn').tap();
      const stopped = await page.locator('#timerText').textContent();
      await page.waitForTimeout(40);
      assert.equal(await page.locator('#timerText').textContent(), stopped, '離開後計時應停止');
      assert.deepEqual(await records(), saved, '隨機模式不可修改闖關紀錄');
      console.log('✓ 隨機', difficulty, '有解／資源／重來／過關／重玩／新盤／雙語／紀錄隔離');
    }
    // 有限愛心耗盡後，仍可重試原盤或直接換新盤。
    await page.locator('#randomChips [data-v="myth"]').tap();
    await page.locator('#randomStart').tap();
    const failedStart = await page.evaluate(() => JSON.stringify(__amaze.state));
    const loss = await page.evaluate(() => ({ id: __amaze.state.arrows.find((a) => AmazeRules.blockersOf(__amaze.state, a.id).length).id, lives: __amaze.state.lives }));
    for (let i = 0; i < loss.lives; i++) await page.locator('#board .arrow[data-id="' + loss.id + '"]').press('Enter');
    await page.locator('#result').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => __amaze.state.status), 'lost');
    assert.equal(await page.locator('#resultTargetStatus').textContent(), '未完成');
    await page.locator('#replayBtn').tap();
    assert.equal(await page.evaluate(() => JSON.stringify(__amaze.state)), failedStart);
    await page.locator('#backBtn').tap();
    assert.deepEqual(await records(), saved);
    await page.locator('#randomChips [data-v="toddler"]').tap();
    await page.locator('#randomStart').tap();
    await page.evaluate(() => {
      window.__originalNow = performance.now.bind(performance);
      performance.now = () => __originalNow() + 600000;
    });
    await clear(page);
    assert.equal(await page.locator('#resultTargetStatus').textContent(), await page.evaluate(() => I18N.t('result.slow')));
    await page.evaluate(() => { performance.now = __originalNow; });
    await page.locator('#homeBtn').tap();
    assert.equal(await page.locator('#home').isVisible(), true);
    await page.locator('#randomBtn').tap();
    assert.deepEqual(await records(), saved);
    assert.deepEqual(sockets, [], '單機隨機模式不應建立網路房間');
    assert.ok(await page.evaluate(() => __events.some((e) => e.event === 'game_start' && e.params.mode === 'solo_random')));
    assert.ok(await page.evaluate(() => __events.some((e) => e.event === 'game_end' && e.params.mode === 'solo_random')));
    for (const lang of ['zh-Hant', 'en']) for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate((l) => { I18N.setLang(l); AmazeApp.show('home'); }, lang);
      await bounds(page, '#home .menu, #home .btn');
      await page.locator('#randomBtn').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `home-${lang}-${width}x${height}.png`) });
      await page.locator('#randomBtn').tap();
      await bounds(page, '#random .topbar, .randomPanel, #randomChips .chip');
      await page.locator('#randomStart').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `setup-${lang}-${width}x${height}.png`) });
      await page.locator('#randomChips [data-v="toddler"]').tap();
      await page.locator('#randomStart').tap();
      await bounds(page, '#game .topbar, #game .bottombar');
      await clear(page);
      await bounds(page, '#result .card, #result .btn, #resultText, .result-stat');
      assert.equal(await page.locator('#result .card').evaluate((n) => n.scrollTop), 0, '結算應從頂部顯示耗時與目標時間');
      const covered = await page.locator('#result .result-stat dt, #result .btn').evaluateAll((nodes) => {
        const tools = [...document.querySelectorAll('.gear,.lang-toggle')].filter((n) => n.getClientRects().length).map((n) => n.getBoundingClientRect());
        return nodes.filter((n) => n.getClientRects().length).filter((n) => {
          const r = n.getBoundingClientRect();
          const card = n.closest('.card').getBoundingClientRect();
          return tools.some((t) => Math.max(r.left, card.left) < t.right && Math.min(r.right, card.right) > t.left && Math.max(r.top, card.top) < t.bottom && Math.min(r.bottom, card.bottom) > t.top);
        }).map((n) => n.id || n.textContent);
      });
      if (covered.length) {
        await page.screenshot({ path: path.join(output, `overlap-${lang}-${width}x${height}.png`) });
        console.log(await page.locator('#result').evaluate((n) => ({ padding: getComputedStyle(n).padding, height: innerHeight, card: n.querySelector('.card').getBoundingClientRect().toJSON() })));
      }
      assert.deepEqual(covered, [], '工具列不可遮住結算資訊與操作');
      const card = await page.locator('#result .card').boundingBox();
      assert.ok(card.y >= 0 && card.y + card.height <= height + 1);
      assert.equal(await page.locator('#result .stack .btn:visible').count(), 3);
      for (const id of ['againBtn', 'replayBtn', 'homeBtn']) {
        await page.locator('#' + id).scrollIntoViewIfNeeded();
        const r = await page.locator('#' + id).boundingBox();
        assert.ok(r.height >= 48 && r.y >= 0 && r.y + r.height <= height + 1, id + ' 無法觸及');
      }
      await page.locator('#result .card').evaluate((n) => { n.scrollTop = 0; n._cs.update(); });
      await page.screenshot({ path: path.join(output, `result-${lang}-${width}x${height}.png`) });
      await page.locator('#homeBtn').tap();
      assert.equal(await page.locator('#home').isVisible(), true);
      assert.deepEqual(await records(), saved);
      console.log('✓ 隨機 RWD', lang, width, height);
    }
    await page.evaluate(() => __amaze.start('normal', 1));
    assert.equal(await page.evaluate(() => __amaze.mode), 'story');
    await clear(page);
    assert.equal(await page.locator('#resultStars').isVisible(), true);
    assert.equal(await page.locator('#resultTargetStat').isVisible(), true);
    assert.equal(await page.locator('#roomBtn').isVisible(), true, '返回闖關時應恢復選關按鈕');
    assert.deepEqual(errors, []);
    console.log('✓ 單機隨機完整流程、失敗重試、離線、模式切換；截圖：' + output);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
