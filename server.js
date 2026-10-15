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
  if (url === '/api/presence') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ gameId: 'amaze-go', ...hub.presence(), updatedAt: new Date().toISOString() }));
  }
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
  });
});

const hub = new Hub();
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 4096,
  verifyClient: ({ origin }) => !ALLOWED.length || !origin || ALLOWED.includes(origin),
});
wss.on('connection', (ws) => {
  const c = hub.connect((obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); });
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => { let m; try { m = JSON.parse(data); } catch (e) { return; } hub.handle(c, m); });
  ws.on('close', () => hub.disconnect(c));
  ws.on('error', () => {});
});
setInterval(() => wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 25000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log('箭頭解密已啟動：http://localhost:' + PORT));
}
module.exports = { server, hub };
