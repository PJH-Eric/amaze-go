/* 多語系字典完整性：zh-Hant 與 en 的 key／{參數} 必須一致，且原始碼用到的 key 都要存在。
   純 Node、無需瀏覽器：node tests/i18n.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dicts = require('../public/js/locales.js');
const R = require('../public/js/rules.js');
const Shapes = require('../public/js/shapes.js');
const zh = dicts['zh-Hant'], en = dicts.en;
const root = path.join(__dirname, '..');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

t('zh-Hant 與 en 的 key 集合完全相同', () => {
  const a = Object.keys(zh), b = Object.keys(en);
  const onlyZh = a.filter((k) => !(k in en)), onlyEn = b.filter((k) => !(k in zh));
  assert.deepStrictEqual({ onlyZh, onlyEn }, { onlyZh: [], onlyEn: [] });
});

const params = (v) => (typeof v === 'string' ? [...new Set([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort() : null);
t('兩種語言的 {param} 佔位符一致（function 值另測）', () => {
  for (const k of Object.keys(zh)) {
    if (typeof zh[k] === 'function' || typeof en[k] === 'function') continue;
    assert.deepStrictEqual(params(en[k]), params(zh[k]), `佔位符不一致：${k}`);
  }
});
t('function 型字典值可呼叫並回傳字串', () => {
  const sample = { n: 1, t: 2, p: 1 };
  for (const d of [zh, en]) for (const k of Object.keys(d)) if (typeof d[k] === 'function') assert.strictEqual(typeof d[k](sample), 'string', k);
});
t('字典值皆為非空字串（或 function）', () => {
  for (const d of [zh, en]) for (const [k, v] of Object.entries(d)) assert.ok(typeof v === 'function' || (typeof v === 'string' && (v.length > 0 || k === 'unit.times')), `空值：${k}`);
});
t('en 字典不含中日文字元（除了語言切換提示以外都應是英文）', () => {
  for (const [k, v] of Object.entries(en)) if (typeof v === 'string') assert.ok(!/[\u3040-\u30ff\u3400-\u9fff]/.test(v), `en 含中文：${k}`);
});

// ---- 掃描原始碼用到的 key ----
const files = ['public/index.html', ...fs.readdirSync(path.join(root, 'public/js')).filter((f) => /\.js$/.test(f) && !/^(locales|i18n|levels)/.test(f)).map((f) => 'public/js/' + f)];
const used = new Set(), prefixes = new Set();
for (const f of files) {
  const s = read(f);
  for (const m of s.matchAll(/\b(?:I18N\.t|T)\(\s*'([\w.]+)'\s*([,)+])/g)) (m[2] === '+' ? prefixes : used).add(m[1]);
  for (const m of s.matchAll(/\b(?:I18N\.t|T)\([^()'`]*?\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of s.matchAll(/\bstKey\(\s*'([\w.]+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/\bi18n:\s*'([\w.]+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/data-i18n(?:-html|-title|-content)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach((p) => { const k = p.split('=')[1]; if (k) used.add(k.trim()); });
}
t('原始碼（T／I18N.t／data-i18n）用到的 key 都存在字典（共 ' + used.size + ' 個）', () => {
  const missing = [...used].filter((k) => !(k in zh) || !(k in en));
  assert.deepStrictEqual(missing, []);
});
t('動態組合的 key 前綴都有對應字典項', () => {
  for (const p of prefixes) assert.ok(Object.keys(zh).some((k) => k.startsWith(p)), '找不到前綴 ' + p);
});

const has = (k) => assert.ok(k in zh && k in en, '缺字典：' + k);
t('難度、盤型、方向、電腦名稱、暱稱組件、快捷語都有翻譯', () => {
  for (const d of Object.keys(R.DIFFICULTIES)) { has('diff.' + d); has('diffShort.' + d); }
  for (const s of Shapes.SHAPES || Shapes.list || []) has('shape.' + s.id);
  for (const d of ['U', 'D', 'L', 'R']) has('board.dir.' + d);
  for (let i = 1; i <= 3; i++) has('ai.' + i);
  for (let i = 0; i < 8; i++) { has('adj.' + i); has('ani.' + i); }
  for (let i = 1; i <= 5; i++) has('chat.q' + i);
});

// ---- 伺服器（hub.js）只送代碼：錯誤碼、通知碼、系統訊息、關房原因都要有字典 ----
const hub = read('public/js/hub.js');
t('hub.js 送出的錯誤碼／通知碼／系統訊息／關房原因皆有字典', () => {
  for (const m of hub.matchAll(/this\.err\(c,\s*(?:[^'()]*\?\s*)?'([A-Z_]+)'(?:\s*:\s*'([A-Z_]+)')?/g)) { has('err.' + m[1]); if (m[2]) has('err.' + m[2]); }
  for (const m of hub.matchAll(/'((?:NOTE)_[A-Z]+)'/g)) has('notice.' + m[1]);
  for (const m of hub.matchAll(/this\.sys\(r,\s*(?:[^'()]*\?\s*)?'(\w+)'(?:\s*:\s*'(\w+)')?/g)) { has('sys.' + m[1]); if (m[2]) has('sys.' + m[2]); }
  for (const m of hub.matchAll(/closeRoom\(r,\s*'(\w+)'/g)) has('closed.' + m[1]);
});
t('hub.js 沒有寫死的中文訊息（暱稱隨機字庫除外）', () => {
  const code = hub.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((l) => !/^\s*(const (ADJ|ANI) =)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/[\u3400-\u9fff]/.test(code), '伺服器程式含中文字串');
});
t('檔案皆為無 BOM 的 UTF-8', () => {
  for (const f of [...files, 'public/js/locales.js', 'public/css/style.css', 'tests/i18n.js']) assert.ok(!read(f).startsWith('\ufeff') && !read(f).includes('\ufffd'), f);
});

console.log(`\n${n} 項多語系檢查通過`);
