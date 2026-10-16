/* 闖關擴充驗收：舊紀錄、解鎖邊界、末關及選關 RWD。需 Playwright／Chromium。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { server } = require('../server.js');
const sizes = [[320, 568], [360, 640], [393, 786], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900]];
const output = process.env.LEVEL_SCREENSHOTS || path.join(os.tmpdir(), 'amaze-levels');

async function clearLevel(page) {
  while (await page.evaluate(() => __amaze.state.status === 'playing')) {
    const id = await page.evaluate(() => AmazeRules.freeArrows(__amaze.state)[0]);
    await page.locator('#board .arrow[data-id="' + id + '"]').press('Enter');
  }
  await page.locator('#result').waitFor({ state: 'visible' });
}

(async () => {
  let browser;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      const stars = {}, times = {};
      for (const d of ['toddler', 'easy', 'normal', 'hard', 'myth']) {
        stars[d] = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i + 1, 5]));
        times[d] = { 100: 12345 };
      }
      localStorage.setItem('amaze.stars', JSON.stringify(stars));
      localStorage.setItem('amaze.times', JSON.stringify(times));
      localStorage.setItem('amaze.settings', JSON.stringify({ bgm: false, sfx: false, reduce: true }));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    assert.match(await page.locator('#storyBtn').textContent(), /200 關・共 1,000 關/);
    await page.locator('#storyBtn').click();
    for (const difficulty of ['toddler', 'easy', 'normal', 'hard', 'myth']) {
      await page.locator('#diffChips [data-v="' + difficulty + '"]').click();
      assert.equal(await page.locator('#levelGrid .lv').count(), 200);
      assert.equal(await page.locator('#progressText').textContent(), '已通 100／200 關・星星 500／1000');
      assert.match(await page.locator('#levelGrid .lv').nth(99).getAttribute('aria-label'), /最佳 0:12.34/);
      assert.equal(await page.locator('#levelGrid .lv').nth(100).isEnabled(), true);
      assert.equal(await page.locator('#levelGrid .lv').nth(101).isEnabled(), false);
      await page.evaluate((d) => __amaze.start(d, 100), difficulty);
      await clearLevel(page);
      await page.locator('#againBtn').click();
      assert.equal(await page.evaluate(() => __amaze.state.level), 101);
      await clearLevel(page);
      await page.locator('#roomBtn').click();
      assert.match(await page.locator('#progressText').textContent(), /^已通 101／200 關/);
      assert.equal(await page.locator('#levelGrid .lv').nth(101).isEnabled(), true);
      await page.evaluate((d) => __amaze.start(d, 199), difficulty);
      await clearLevel(page);
      await page.locator('#againBtn').click();
      assert.equal(await page.evaluate(() => __amaze.state.level), 200);
      const original = await page.evaluate(() => JSON.stringify(__amaze.state));
      await clearLevel(page);
      assert.equal(await page.locator('#againBtn').textContent(), '重玩這關');
      assert.equal(await page.locator('#replayBtn').isVisible(), false);
      await page.locator('#againBtn').click();
      assert.equal(await page.evaluate(() => JSON.stringify(__amaze.state)), original);
      await page.evaluate(() => AmazeApp.show('levels'));
      console.log('✓', difficulty, '舊紀錄、100→101、解鎖 102、199→200、末關重玩');
    }
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => AmazeApp.show('levels'));
      await page.locator('#levelGrid .lv').last().scrollIntoViewIfNeeded();
      const bad = await page.locator('#levels .topbar, #levelPanel, #levelGrid, #progressText, #levelGrid .lv').evaluateAll((nodes) => nodes.filter((n) => {
        const r = n.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
      }).map((n) => n.id || n.className));
      assert.deepEqual(bad, []);
      const last = await page.locator('#levelGrid .lv').last().boundingBox();
      assert.ok(last.y >= 0 && last.y + last.height <= height + 1);
      await page.screenshot({ path: path.join(output, `expanded-${width}x${height}.png`) });
      console.log('✓ 200 關選關、統計與末列捲動', width, height);
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
