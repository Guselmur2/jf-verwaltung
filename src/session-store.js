'use strict';

const { db } = require('./db');

// Minimaler Session-Store auf der bestehenden SQLite-Datei. Spart eine zweite
// native Abhaengigkeit und ueberlebt einen Neustart des Pi.
module.exports = function makeStore(session) {
  const Store = session.Store;

  const stmt = {
    get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
    set: db.prepare(
      'INSERT INTO sessions (sid, expires, data) VALUES (@sid, @expires, @data) ' +
        'ON CONFLICT(sid) DO UPDATE SET expires = @expires, data = @data'
    ),
    destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
    touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
    prune: db.prepare('DELETE FROM sessions WHERE expires < ?'),
  };

  const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

  function expiryOf(sess) {
    const ms = sess?.cookie?.maxAge ?? DEFAULT_TTL_MS;
    return Date.now() + ms;
  }

  class SqliteStore extends Store {
    constructor() {
      super();
      this.prune();
      // Alle 6 Stunden abgelaufene Sessions wegraeumen.
      this.timer = setInterval(() => this.prune(), 1000 * 60 * 60 * 6);
      this.timer.unref?.();
    }

    prune() {
      stmt.prune.run(Date.now());
    }

    get(sid, cb) {
      try {
        const row = stmt.get.get(sid);
        if (!row) return cb(null, null);
        if (row.expires < Date.now()) {
          stmt.destroy.run(sid);
          return cb(null, null);
        }
        cb(null, JSON.parse(row.data));
      } catch (err) {
        cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        stmt.set.run({ sid, expires: expiryOf(sess), data: JSON.stringify(sess) });
        cb(null);
      } catch (err) {
        cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        stmt.destroy.run(sid);
        cb(null);
      } catch (err) {
        cb(err);
      }
    }

    touch(sid, sess, cb) {
      try {
        stmt.touch.run(expiryOf(sess), sid);
        cb(null);
      } catch (err) {
        cb(err);
      }
    }
  }

  return SqliteStore;
};
