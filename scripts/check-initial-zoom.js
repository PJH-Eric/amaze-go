/* Playwright／Chromium：逐關驗證預設全盤優先、密集盤面與手動縮放。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const R = require('../public/js/rules.js');
const { server } = require('../server.js');
const sizes = [[320, 568], [360, 640], [393, 786], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900]];
const output = process.env.ZOOM_SCREENSHOTS || path.join(os.tmpdir(), 'amaze-initial-zoom');
const randomBoards = Object.keys(R.DIFFICULTIES).flatMap((difficulty, di) => [1, 2, 3].map((seed) =>
  R.createStateFromSpec(difficulty, R.randomSpec(difficulty, R.mulberry32(di * 100 + seed))),
));

(async () => {
  let browser;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const openPage = async (width, height) => {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        localStorage.setItem('amaze.settings', JSON.stringify({ bgm: false, sfx: false, reduce: true }));
        let api;
        Object.defineProperty(window, 'AmazeBoard', {
          get: () => api,
          set(value) {
            api = value;
            const create = api.create;
            api.create = (svg, options) => {
              const board = create(svg, options);
              window.__layoutBoards = window.__layoutBoards || {};
              window.__layoutBoards[svg.id] = board;
              return board;
            };
          },
        });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      return { context, page, errors };
    };
    // 逐關檢查在頁面內執行；每個難度與對戰盤面各用獨立頁面，平行跑完所有尺寸。
    const inspect = async (page, difficulties, boards) => page.evaluate(async ({ difficulties, boards }) => {
      const frame = () => new Promise(requestAnimationFrame);
      const stats = { story: 0, fit: 0, dense: 0, versus: 0 };
      function check(id, label) {
        const svg = document.getElementById(id), wrap = svg.parentElement, vb = svg.viewBox.baseVal;
        const fitCell = 28 * Math.min(wrap.clientWidth / vb.width, wrap.clientHeight / vb.height);
        const scroll = wrap.scrollWidth > wrap.clientWidth + 1 || wrap.scrollHeight > wrap.clientHeight + 1;
        const matrix = svg.getScreenCTM(), cell = 28 * Math.hypot(matrix.a, matrix.b);
        if (fitCell >= 10 && scroll) throw new Error(label + ' 可完整顯示卻自動產生捲軸');
        if (fitCell < 10 && cell < Math.min(14, fitCell * 3.5) - 0.1) throw new Error(label + ' 密集盤面縮得過小');
        if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) throw new Error(label + ' 頁面溢出');
        if (scroll) stats.dense++; else stats.fit++;
        return scroll;
      }
      // 預設視圖只取決於盤面寬高與容器大小：相同寬高的關卡版面必相同，
      // 每種寬高只實際開局量一次，其餘沿用結果計入，避免重複繪製。
      const measured = new Map();
      for (const difficulty of difficulties) {
        for (let level = 1; level <= AmazeRules.LEVELS_PER_DIFFICULTY; level++) {
          const spec = AmazeRules.createState(difficulty, level), key = spec.w + 'x' + spec.h;
          if (measured.has(key)) {
            if (measured.get(key)) stats.dense++; else stats.fit++;
          } else {
            __amaze.start(difficulty, level);
            await frame();
            measured.set(key, check('board', difficulty + '/' + level));
          }
          stats.story++;
        }
      }
      if (boards.length) {
        AmazeApp.show('online');
        document.getElementById('roomScroll').hidden = true;
        document.getElementById('boardView').hidden = false;
        document.getElementById('otimer').hidden = false;
        document.getElementById('online').classList.add('showing-board');
        document.getElementById('olayout').dataset.panel = matchMedia('(min-width:900px) and (min-aspect-ratio:1/1)').matches ? 'open' : 'closed';
        for (const local of [true, false]) {
          document.getElementById('online').toggleAttribute('data-local', local);
          for (const state of boards) {
            __layoutBoards.oboard.draw(state);
            await frame();
            check('oboard', (local ? 'local/' : 'online/') + state.difficulty + '/' + state.seed);
            stats.versus++;
          }
        }
      }
      return stats;
    }, { difficulties, boards });
    const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    async function checkStory(width, height) {
      const { context, page, errors } = await openPage(width, height);
      // 逐關只量版面（尺寸、捲動、縮放），不需繪出畫面；visibility 不影響版面，可省下大量繪製成本。
      await page.addStyleTag({ content: '#board, #board * { visibility: hidden !important; }' });
      const stats = await inspect(page, Object.keys(R.DIFFICULTIES), []);
      assert.equal(stats.story, 1000);
      assert.deepEqual(errors, []);
      await context.close();
      return stats;
    }

    async function checkVersusAndZoom(width, height) {
      const { context, page, errors } = await openPage(width, height);
      const stats = await inspect(page, [], randomBoards);
      assert.equal(stats.versus, 30);
      for (const [difficulty, level] of [['easy', 1], ['normal', 100], ['myth', 200]]) {
        await page.evaluate(([d, l]) => __amaze.start(d, l), [difficulty, level]);
        await frames(page);
        await page.screenshot({ path: path.join(output, `${difficulty}-${width}x${height}.png`) });
      }
      // 玩家要求看全盤後，旋轉不應被自動放大；手動放大比例也應保留。
      await page.keyboard.press('0');
      assert.equal(await page.locator('#board').evaluate((n) => n.style.width), '100%', '鍵盤 0 應立即顯示全盤');
      await page.setViewportSize({ width: width < 700 ? 1024 : 393, height: width < 700 ? 768 : 786 });
      await frames(page);
      assert.equal(await page.locator('#board').evaluate((n) => n.style.width), '100%');
      assert.equal(await page.locator('#board').locator('..').evaluate((n) => n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <= n.clientHeight + 1), true);
      await page.locator('#game .zbar button').first().click();
      const manual = await page.locator('#board').evaluate((n) => n.style.width);
      await page.setViewportSize({ width, height });
      await frames(page);
      assert.equal(await page.locator('#board').evaluate((n) => n.style.width), manual);
      await page.locator('#restartBtn').click();
      await frames(page);
      const restarted = await page.locator('#board').evaluate((n) => {
        const w = n.parentElement, vb = n.viewBox.baseVal;
        const fit = 28 * Math.min(w.clientWidth / vb.width, w.clientHeight / vb.height);
        return fit < 10 || (w.scrollWidth <= w.clientWidth + 1 && w.scrollHeight <= w.clientHeight + 1);
      });
      assert.ok(restarted, '重玩應重新評估預設視圖');
      assert.deepEqual(errors, []);
      await context.close();
      return stats;
    }

    const results = sizes.map(() => ({ story: 0, fit: 0, dense: 0, versus: 0 }));
    const jobs = sizes.flatMap(([width, height], i) => [
      () => checkStory(width, height).then((s) => [i, s]),
      () => checkVersusAndZoom(width, height).then((s) => [i, s]),
    ]);
    let next = 0;
    await Promise.all(Array.from({ length: jobs.length }, async () => {
      while (next < jobs.length) {
        const [i, stats] = await jobs[next++]();
        for (const key of Object.keys(stats)) results[i][key] += stats[key];
      }
    }));
    sizes.forEach(([width, height], i) => {
      assert.equal(results[i].story, 1000);
      assert.equal(results[i].versus, 30);
      console.log('✓', `${width}x${height}`, JSON.stringify(results[i]), '手動縮放／旋轉／重玩');
    });
    console.log('✓ 8,000 次闖關初始化、240 次對戰盤面；截圖：' + output);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
