'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const test = require('node:test');
const Rules = require('../public/js/rules.js');

function client(base, old) {
  const socket = new WebSocket(new URL('/ws', base).href.replace(/^http/, 'ws'));
  const messages = [];
  const send = message => socket.send(JSON.stringify(message));
  socket.onopen = () => send({ t: 'hello', name: 'Pilot', resumeId: old?.id, resumeKey: old?.resumeKey });
  socket.onmessage = event => messages.push(JSON.parse(event.data));
  return {
    send, close: () => socket.close(),
    async wait(match, description) {
      const deadline = Date.now() + 6500;
      do {
        const result = messages.findLast(match);
        if (result) return result;
        await sleep(30);
      } while (Date.now() < deadline);
      throw new Error(`等待逾時：${description}，已收到 ${messages.map(message => message.t).join(', ')}`);
    }
  };
}

async function exercise(initial, restart) {
  const sockets = [];
  function open(base, credential) {
    const connection = client(base, credential);
    sockets.push(connection);
    return connection;
  }
  try {
    let host = open(initial);
    let guest = open(initial);
    const hostId = await host.wait(m => m.t === 'welcome' && !m.provisional, '房主身分');
    const guestId = await guest.wait(m => m.t === 'welcome' && !m.provisional, '玩家身分');
    host.send({ t: 'create', diff: 'easy' });
    const room = await host.wait(m => m.t === 'room', '開房');
    guest.send({ t: 'join', room: room.id, want: 'player' });
    await host.wait(m => m.t === 'room' && m.players.length === 2, '第二位玩家入房');
    host.send({ t: 'start' });
    const game = await host.wait(m => m.t === 'game', '開局');
    const [free] = Rules.freeArrows(game.state);
    assert.ok(free != null);
    await sleep(Math.max(0, game.startAt - game.serverNow) + 100);
    host.send({ t: 'tap', id: free });
    const move = await guest.wait(m => m.t === 'move' && m.ok, '確認箭頭已移除');
    const next = await restart();
    const unauthorized = open(next, { id: hostId.id });
    const rejected = await unauthorized.wait(m => m.t === 'welcome' && !m.provisional, '無憑證連線取得新身分');
    assert.notEqual(rejected.id, hostId.id);
    unauthorized.close();
    host = open(next, hostId);
    await host.wait(m => m.t === 'welcome' && m.resumed && m.id === hostId.id, '房主重連');
    const paused = await host.wait(m => m.t === 'room' && m.recovering, '原房間暫停');
    assert.equal(paused.id, room.id);
    assert.equal(paused.hostId, hostId.id);
    guest = open(next, guestId);
    await guest.wait(m => m.t === 'welcome' && m.resumed && m.id === guestId.id, '玩家重連');
    const restored = await guest.wait(m => m.t === 'room' && !m.recovering, '兩人回到原房');
    const board = await guest.wait(m => m.t === 'game', '還原棋盤');
    assert.equal(restored.id, room.id);
    assert.equal(restored.round, game.round);
    assert.equal(restored.remaining, move.remaining);
    assert.equal(restored.players.find(p => p.id === hostId.id).score, move.pts);
    assert.equal(board.state.arrows[free].removed, true);
    guest.send({ t: 'leave' });
    await guest.wait(m => m.t === 'left', '玩家離開');
    host.send({ t: 'leave' });
    await host.wait(m => m.t === 'left', '房主離開');
  } finally {
    for (const socket of sockets) socket.close();
  }
}

function start(file) {
  const child = spawn(process.execPath, ['-e', `
    const { server } = require('./server.js');
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, AMAZE_ROOM_DB_PATH: file },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const base = once(child.stdout, 'data').then(([data]) => `http://127.0.0.1:${String(data).trim()}`);
  return { child, base };
}

async function stop(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

if (require.main === module) test('重啟後以私密憑證回到原房間、棋盤和分數', { timeout: 22000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'amaze-go-restart-'));
  const file = path.join(directory, 'rooms.sqlite');
  let server = start(file);
  try {
    await exercise(await server.base, async () => {
      await stop(server.child);
      server = start(file);
      return server.base;
    });
  } finally {
    await stop(server.child);
    rmSync(directory, { recursive: true, force: true });
  }
});

module.exports = { exercise };
