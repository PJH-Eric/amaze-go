/* 闖關擴充驗收：舊紀錄、解鎖邊界、末關及選關 RWD。需 Playwright／Chromium。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { server } = require('../server.js');
const sizes = [[320, 568], [360, 640], [393, 786], [399, 786], [400, 786], [568, 320], [759, 900], [760, 900], [844, 390], [768, 1024], [1024, 768], [1440, 900]];
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
    const errors = [];
    // 每個難度／尺寸各用獨立 context 平行執行，進度存於各自的 localStorage。
    const openPage = async (viewport) => {
      const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' });
      await context.addInitScript(seedProgress);
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      return { context, page };
    };
    const seedProgress = () => {
      const stars = {}, times = {};
      for (const d of ['toddler', 'easy', 'normal', 'hard', 'myth']) {
        stars[d] = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i + 1, 5]));
        times[d] = { 100: 12345 };
      }
      localStorage.setItem('amaze.stars', JSON.stringify(stars));
      localStorage.setItem('amaze.times', JSON.stringify(times));
      localStorage.setItem('amaze.settings', JSON.stringify({ bgm: false, sfx: false, reduce: true }));
    };
    const first = await openPage(undefined);
    assert.match(await first.page.locator('#storyBtn').textContent(), /200 關・共 1,000 關/);
    await first.context.close();
    await Promise.all(['toddler', 'easy', 'normal', 'hard', 'myth'].map(async (difficulty) => {
      const { context, page } = await openPage(undefined);
      await page.locator('#storyBtn').click();
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
      await context.close();
    }));
    await Promise.all(sizes.map(async ([width, height]) => {
      const { context, page } = await openPage({ width, height });
      await page.evaluate(() => AmazeApp.show('levels'));
      const columns = width >= 760 ? 10 : width >= 400 ? 5 : 4;
      assert.equal(await page.locator('#levelGrid').evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(' ').length), columns);
      const cells = page.locator('#levelGrid .lv');
      const first = await cells.nth(0).boundingBox();
      const nextRow = await cells.nth(columns).boundingBox();
      assert.ok(nextRow.y > first.y && Math.abs(nextRow.x - first.x) < 1, '每列關卡數不符');
      assert.ok(first.width >= 48 && first.height >= 48, '觸控按鈕過小');
      await page.locator('#levelGrid .lv').last().scrollIntoViewIfNeeded();
      const bad = await page.locator('#levels .topbar, .levelsPanel, #levelGrid, #progressText, #levelGrid .lv').evaluateAll((nodes) => nodes.filter((n) => {
        const r = n.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
      }).map((n) => n.id || n.className));
      assert.deepEqual(bad, []);
      const last = await page.locator('#levelGrid .lv').last().boundingBox();
      assert.ok(last.y >= 0 && last.y + last.height <= height + 1);
      await page.screenshot({ path: path.join(output, `expanded-${width}x${height}.png`) });
      console.log('✓ 200 關選關、統計與末列捲動', width, height);
      await context.close();
    }));
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
