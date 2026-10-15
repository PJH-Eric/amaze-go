/* 需 Playwright 與 Chromium；實際操作本機／線上模式，檢查倒數前後布局。 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { server } = require('../server.js');

const output = process.env.COUNTDOWN_SCREENSHOTS || path.join(os.tmpdir(), 'amaze-countdown');
const sizes = [[320, 568], [360, 640], [393, 786], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900]];

async function layout(page) {
  return page.evaluate(() => {
    const bounds = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n)); };
    return {
      board: bounds('#oboard'), area: bounds('#boardView'), header: bounds('#online .topbar'),
      viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    };
  });
}

async function checkCountdown(page, name, width, height) {
  const samples = [];
  for (const digit of ['3', '2', '1', '開始！']) {
    await page.waitForFunction((n) => document.querySelector('#count').textContent === n, digit);
    await page.waitForTimeout(150);
    samples.push(await layout(page));
    assert.equal(await page.locator('#count').evaluate((n) => getComputedStyle(n).transform), 'none', '覆蓋層不可跟著數字縮放');
    if (digit !== '開始！') {
      assert.equal(await page.locator('#otimerText').textContent(), '0:00.00');
      const removed = await page.evaluate(() => __countdownState.arrows.filter((a) => a.removed).length);
      await page.locator('#oboard .arrow').first().press('Enter');
      assert.equal(await page.evaluate(() => __countdownState.arrows.filter((a) => a.removed).length), removed, '倒數期間不可操作棋盤');
    }
    await page.screenshot({ path: path.join(output, `${name}-${width}x${height}-${digit === '開始！' ? 'start' : digit}.png`) });
  }
  await page.locator('#count').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#otimerText').textContent(), /^\d+:\d{2}\.\d{2}$/);
  const playing = await layout(page);
  for (const sample of samples) {
    assert.deepEqual(sample.board, playing.board, '倒數時棋盤布局改變');
    assert.deepEqual(sample.area, playing.area, '倒數時遊戲區布局改變');
    assert.deepEqual(sample.header, playing.header, '倒數時頂欄布局改變');
    assert.ok(sample.document[0] <= width && sample.document[1] <= height, '倒數造成頁面溢出：' + JSON.stringify(sample));
  }
  console.log('✓', name, `${width}x${height}`, '倒數／開始無溢出、背景布局固定、倒數期間禁止操作');
}

async function finishRound(page) {
  while (await page.locator('#oresult').isHidden()) {
    const id = await page.evaluate(() => AmazeRules.freeArrows(__countdownState)[0]);
    if (id == null) break;
    await page.locator('#oboard .arrow[data-id="' + id + '"]').press('Enter');
    await page.waitForFunction((n) => __countdownState.arrows[n].removed, id);
  }
  await page.locator('#oresult').waitFor({ state: 'visible' });
}

(async () => {
  let browser;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // 僅在測試中觀察真實繪圖狀態，仍由按鈕／鍵盤觸發全部遊戲操作。
    await page.addInitScript(() => {
      let api;
      Object.defineProperty(window, 'AmazeBoard', {
        get: () => api,
        set(value) {
          api = value;
          const create = api.create;
          api.create = (svg, options) => {
            const board = create(svg, options), draw = board.draw;
            board.draw = (state) => { if (svg.id === 'oboard') window.__countdownState = state; return draw(state); };
            return board;
          };
        },
      });
    });
    for (const mode of ['local', 'online']) {
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.goto('http://127.0.0.1:' + server.address().port);
        if (mode === 'local') await page.locator('#vsAiBtn').click();
        else {
          await page.locator('#onlineBtn').click();
          await page.waitForFunction(() => __online.ws && __online.ws.readyState === 1);
          await page.locator('#createBtn').click();
          await page.locator('#cmName').fill('倒數版面測試');
          await page.locator('#cmGo').click();
          await page.locator('#roomView .seat.empty .seg button[data-v="easy"]').first().click();
        }
        await page.locator('#roomView .row .btn.primary').click();
        await checkCountdown(page, mode, width, height);
        if (width === 393) {
          await finishRound(page);
          await page.locator('#orAgain').click();
          await checkCountdown(page, mode + '-next', width, height);
        }
        await page.locator('#leaveBtn').click();
      }
    }
    assert.deepEqual(errors, []);
    console.log('截圖：' + output);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
