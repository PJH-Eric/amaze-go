/* 需可載入 Playwright 與已安裝的 Chromium：node scripts/check-replay.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { server } = require('../server.js');

const sizes = [[320, 568], [360, 640], [393, 786], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900]];
const output = process.env.REPLAY_SCREENSHOTS || path.join(os.tmpdir(), 'amaze-replay');
const errors = [];

async function clearLevel(page) {
  while (await page.evaluate(() => __amaze.state.status === 'playing')) {
    const id = await page.evaluate(() => AmazeRules.freeArrows(__amaze.state)[0]);
    await page.locator('#board .arrow[data-id="' + id + '"]').press('Enter');
  }
  await page.locator('#result').waitFor({ state: 'visible' });
}

async function checkBounds(page, selector) {
  const bad = await page.locator(selector).evaluateAll((nodes) => nodes.filter((n) => n.getClientRects().length).filter((n) => {
    const r = n.getBoundingClientRect();
    return r.left < -1 || r.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
  }).map((n) => ({ id: n.id || n.className, width: n.clientWidth, scroll: n.scrollWidth, left: n.getBoundingClientRect().left, viewport: innerWidth })));
  assert.deepEqual(bad, [], '水平溢出：' + selector);
}

(async () => {
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const url = 'http://127.0.0.1:' + server.address().port;
    await page.goto(url);
    const formats = [[-1, '0:00.00'], [0, '0:00.00'], [9.99, '0:00.00'], [10, '0:00.01'], [99, '0:00.09'], [1234, '0:01.23'], [59999.99, '0:59.99'], [60000, '1:00.00'], [3599999, '59:59.99'], [3600000, '60:00.00']];
    for (const [ms, expected] of formats) assert.equal(await page.evaluate((value) => AmazeApp.fmtTime(value), ms), expected);
    await page.evaluate(() => __amaze.start('normal', 2));
    const original = await page.evaluate(() => JSON.stringify(__amaze.state));
    const blocked = await page.evaluate(() => __amaze.state.arrows.find((a) => AmazeRules.blockersOf(__amaze.state, a.id).length).id);
    await page.locator('#board .arrow[data-id="' + blocked + '"]').press('Enter');
    await page.locator('#hintBtn').tap();
    await clearLevel(page);
    const firstBest = await page.evaluate(() => JSON.parse(localStorage.getItem('amaze.times')).normal[2]);
    assert.equal(await page.locator('#resultTime').textContent(), await page.evaluate((ms) => AmazeApp.fmtTime(ms), firstBest));
    const saved = await page.evaluate(() => [localStorage.getItem('amaze.stars'), localStorage.getItem('amaze.times')]);
    await page.locator('#againBtn').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'replayBtn');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#result').isVisible(), false);
    assert.equal(await page.evaluate(() => JSON.stringify(__amaze.state)), original);
    assert.match(await page.locator('#timerText').textContent(), /^0:00\.\d{2}$/);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('amaze.stars'), localStorage.getItem('amaze.times')]), saved);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'restartBtn');
    await clearLevel(page);
    assert.equal(await page.locator('#resultHints').textContent(), '0');
    assert.match(await page.locator('#resultTime').textContent(), /^\d+:\d{2}\.\d{2}$/);
    assert.match(await page.locator('#resultTarget').textContent(), /^\d+:\d{2}\.\d{2}$/);
    const bestMs = await page.evaluate(() => JSON.parse(localStorage.getItem('amaze.times')).normal[2]);
    const bestText = await page.evaluate((ms) => AmazeApp.fmtTime(ms), bestMs);
    assert.ok((await page.locator('#resultBest').textContent()).endsWith(bestText));
    assert.equal(await page.locator('#resultMistakes').textContent(), '0');
    assert.equal(await page.locator('#resultTargetStatus').textContent(), '已達標');
    assert.match(await page.locator('#resultLevel').textContent(), /第 2 關/);
    fs.mkdirSync(output, { recursive: true });
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await checkBounds(page, '#result .card, #result .btn, #resultText, .result-stat, .result-stat dd, #resultBest');
      const card = await page.locator('#result .card').boundingBox();
      assert.ok(card.y >= 0 && card.y + card.height <= height + 1);
      for (const id of ['againBtn', 'replayBtn', 'roomBtn', 'homeBtn']) {
        await page.locator('#' + id).scrollIntoViewIfNeeded();
        const r = await page.locator('#' + id).boundingBox();
        assert.ok(r.height >= 48 && r.y >= 0 && r.y + r.height <= height + 1, id + ' 無法觸及');
      }
      await page.locator('#result .card').evaluate((n) => { n.scrollTop = 0; n._cs.update(); });
      await page.screenshot({ path: path.join(output, `result-${width}x${height}.png`) });
      console.log('✓ 過關視窗、四個操作與捲動', width, height);
    }
    await page.locator('#againBtn').tap();
    assert.match(await page.locator('#gameTitle').textContent(), /第 3 關/);
    await page.evaluate(() => __amaze.start('toddler', 100));
    await clearLevel(page);
    assert.equal(await page.locator('#againBtn').textContent(), '重玩這關');
    assert.equal(await page.locator('#replayBtn').isVisible(), false);
    await page.locator('#homeBtn').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'againBtn');
    await page.locator('#againBtn').tap();
    assert.match(await page.locator('#gameTitle').textContent(), /第 100 關/);
    await page.evaluate(() => __amaze.start('normal', 1));
    const failure = await page.evaluate(() => ({ id: __amaze.state.arrows.find((a) => AmazeRules.blockersOf(__amaze.state, a.id).length).id, lives: __amaze.state.lives }));
    for (let i = 0; i < failure.lives; i++) await page.locator('#board .arrow[data-id="' + failure.id + '"]').press('Enter');
    await page.locator('#result').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#againBtn').textContent(), '再試一次');
    assert.equal(await page.locator('#replayBtn').isVisible(), false);
    assert.equal(await page.locator('#resultTargetStatus').textContent(), '未完成');
    await page.screenshot({ path: path.join(output, 'result-failure.png') });
    await page.locator('#againBtn').tap();
    assert.equal(await page.evaluate(() => __amaze.state.status), 'playing');
    await clearLevel(page);
    await page.locator('#roomBtn').tap();
    assert.equal(await page.locator('#levels').isVisible(), true);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => AmazeApp.show('home'));
      await checkBounds(page, '#home .menu, #home .btn');
      await page.screenshot({ path: path.join(output, `home-${width}x${height}.png`) });
      for (const id of ['howBtn', 'gearBtn']) {
        await page.locator('#' + id).click();
        await checkBounds(page, '.modal:not([hidden]) .card');
        await page.screenshot({ path: path.join(output, `${id}-${width}x${height}.png`) });
        await page.keyboard.press('Escape');
      }
      await page.locator('#storyBtn').click();
      await checkBounds(page, '#levels .topbar, #levelPanel, #levelGrid');
      await page.screenshot({ path: path.join(output, `levels-${width}x${height}.png`) });
      await page.evaluate(() => __amaze.start('easy', 1));
      await checkBounds(page, '#game .topbar, #game .bottombar');
      await page.screenshot({ path: path.join(output, `game-${width}x${height}.png`) });
      await page.evaluate(() => AmazeApp.show('home'));
      await page.locator('#vsAiBtn').click();
      await checkBounds(page, '#online .topbar, #roomScroll');
      await page.screenshot({ path: path.join(output, `local-room-${width}x${height}.png`) });
      await page.locator('#leaveBtn').click();
      await page.locator('#onlineBtn').click();
      await page.locator('#createBtn').waitFor({ state: 'visible' });
      await checkBounds(page, '#lobby .topbar, #lobbyScroll');
      await page.screenshot({ path: path.join(output, `lobby-${width}x${height}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log('✓ 重玩重設、保留成績、再次通關、下一關、末關、失敗重試、焦點與畫面巡檢');
    console.log('截圖：' + output);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
