'use strict';

const { DatabaseSync } = require('node:sqlite');
const { deserialize, serialize } = require('node:v8');

function openCheckpoints(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, checkpoint BLOB NOT NULL);
  `);
  const rows = db.prepare('SELECT checkpoint FROM rooms');
  const put = db.prepare('INSERT INTO rooms VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET checkpoint = excluded.checkpoint');
  const remove = db.prepare('DELETE FROM rooms WHERE id = ?');
  return {
    load() { return rows.all().map(row => deserialize(row.checkpoint)); },
    save(id, value) { put.run(id, serialize(value)); },
    remove(id) { remove.run(id); },
    close() { db.close(); }
  };
}

module.exports = { openCheckpoints };
