// 箭頭解密：靜態檔 + /health + WebSocket 對戰（同一個 port，適合 Render Web Service）
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { Hub } = require('./public/js/hub.js');

const PORT = process.env.PORT || 3080;
const ALLOWED = (process.env.GAME_ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function cors(req, res) {
  const o = req.headers.origin;
  if (o && (!ALLOWED.length || ALLOWED.includes(o))) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
}
const server = http.createServer((req, res) => {
  cors(req, res);
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
  });
});

const hub = new Hub();

/* 大廳聊天室（與房間聊天分開；最近 50 則只存在記憶體）。hub.js 前端也會載入，所以接在伺服器這層 */
const chatSends = new Map();   // 連線 id → send
const lobbyChat = require('./lib/lobby-chat.js').createHub({ send: (id, msg) => { const f = chatSends.get(id); if (f) f(msg); }, key: 't' });
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 4096,
  verifyClient: ({ origin }) => !ALLOWED.length || !origin || ALLOWED.includes(origin),
});
wss.on('connection', (ws) => {
  const c = hub.connect((obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); });
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  const chatId = c.id;
  chatSends.set(chatId, (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); });
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m && m.t === 'ping') { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', ts: m.ts })); return; }
    if (m && m.t === 'lobbychat') { lobbyChat.handle(chatId, m); return; }
    const me = c.alias || c, before = me.roomId;
    hub.handle(c, m);
    const now = c.alias || c, r = now.roomId && now.roomId !== before ? hub.rooms.get(now.roomId) : null;
    if (m && m.t === 'create' && r && r.hostId === now.id) lobbyChat.roomOpened({ code: r.id, roomName: r.name, host: now.name });
  });
  ws.on('close', () => { lobbyChat.drop(chatId); chatSends.delete(chatId); hub.disconnect(c); });
  ws.on('error', () => {});
});
setInterval(() => wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 25000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log('箭頭解密已啟動：http://localhost:' + PORT));
}
module.exports = { server, hub };
