/* 需 Playwright 與 Chromium：比對不同使用者／時間／裝置設定的全部闖關盤面。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const expected = require('../tests/fixtures/levels-v1.sha256.json');
const { server } = require('../server.js');

const profiles = [
  { width: 320, height: 568, nick: '玩家甲', time: 0, random: 0.01, cpu: 1 },
  { width: 393, height: 786, nick: '玩家乙', time: 1735689600000, random: 0.99, cpu: 6 },
  { width: 768, height: 1024, nick: '玩家丙', time: 2051222400000, random: 0.25, cpu: 2 },
  { width: 1024, height: 768, nick: '玩家丁', time: 946684800000, random: 0.75, cpu: 1 },
  { width: 1440, height: 900, nick: '玩家戊', time: 4102444800000, random: 0.5, cpu: 1 },
];
const output = process.env.LEVEL_SCREENSHOTS || path.join(os.tmpdir(), 'amaze-levels');

(async () => {
  let browser;
  try {
    fs.mkdirSync(output, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    for (const profile of profiles) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: true });
      await context.addInitScript((p) => {
        localStorage.setItem('amaze.nick', p.nick);
        localStorage.setItem('amaze.settings', JSON.stringify({ bgm: false, sfx: false, reduce: true, faces: p.random > 0.5 }));
        localStorage.setItem('amaze.stars', JSON.stringify({ normal: { 1: Math.round(p.random * 5) } }));
      }, profile);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
      await page.goto('http://127.0.0.1:' + server.address().port);
      const hashes = await page.evaluate(async (p) => {
        const original = { now: Date.now, random: Math.random };
        let clock = p.time;
        Date.now = () => (clock += p.cpu * 1000);
        Math.random = () => p.random;
        const hashes = {};
        try {
          for (const difficulty of Object.keys(AmazeRules.DIFFICULTIES)) {
            for (let level = 1; level <= AmazeRules.LEVELS_PER_DIFFICULTY; level++) {
              const state = AmazeRules.createState(difficulty, level);
              if (state.boardVersion !== 'story-v1') throw new Error('關卡版本不符');
              const entry = [state.seed, state.w, state.h, state.shape, state.mask, state.arrows.map((a) => [a.dir, a.cells.flat()])];
              const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entry)));
              hashes[difficulty + '/' + level] = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
            }
          }
        } finally {
          Date.now = original.now;
          Math.random = original.random;
        }
        return hashes;
      }, profile);
      assert.deepEqual(hashes, expected, profile.nick + ' 的盤面與固定版本不同');
      await page.evaluate(() => __amaze.start('myth', 6));
      const uiHash = await page.evaluate(async () => {
        const s = __amaze.state;
        const entry = [s.seed, s.w, s.h, s.shape, s.mask, s.arrows.map((a) => [a.dir, a.cells.flat()])];
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entry)));
        return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
      });
      assert.equal(uiHash, expected['myth/6'], '實際闖關畫面與固定資料不同');
      await page.screenshot({ path: path.join(output, `story-${profile.width}x${profile.height}.png`) });
      assert.deepEqual(errors, []);
      await context.close();
      console.log('✓', profile.nick, `${profile.width}x${profile.height}`, `CPU ${profile.cpu}x`, '全部 500 關雜湊與實際開局一致');
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
