import session from 'express-session';
import { db } from './index.js';

const Store = session.Store;

const SQL = {
  get:     db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?'),
  set:     db.prepare(`INSERT INTO sessions (sid, data, expires) VALUES (@sid, @data, @expires)
                       ON CONFLICT(sid) DO UPDATE SET data = @data, expires = @expires`),
  touch:   db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
  destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  all:     db.prepare('SELECT data FROM sessions WHERE expires > ?'),
  length:  db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires > ?'),
  clear:   db.prepare('DELETE FROM sessions'),
  reap:    db.prepare('DELETE FROM sessions WHERE expires <= ?'),
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REAP_INTERVAL  = 60 * 60 * 1000;

function expiryOf(sess) {
  const cookieExpires = sess?.cookie?.expires;
  if (cookieExpires) return new Date(cookieExpires).getTime();
  const maxAge = sess?.cookie?.maxAge;
  return Date.now() + (typeof maxAge === 'number' ? maxAge : DEFAULT_TTL_MS);
}

/**
 * SQLite(better-sqlite3) 기반 express-session 저장소.
 * 기본 MemoryStore 와 달리 서버 재시작·배포 후에도 로그인 세션이 유지된다.
 */
export class SqliteSessionStore extends Store {
  constructor() {
    super();
    // 만료 세션 주기적 청소 (프로세스 종료를 막지 않도록 unref)
    this.timer = setInterval(() => {
      try { SQL.reap.run(Date.now()); } catch (e) { console.error('[session] 청소 실패', e); }
    }, REAP_INTERVAL);
    this.timer.unref?.();
    try { SQL.reap.run(Date.now()); } catch { /* 기동 시 청소 실패는 무시 */ }
  }

  get(sid, cb) {
    try {
      const row = SQL.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      SQL.set.run({ sid, data: JSON.stringify(sess), expires: expiryOf(sess) });
      cb?.(null);
    } catch (e) { cb?.(e); }
  }

  touch(sid, sess, cb) {
    try {
      SQL.touch.run(expiryOf(sess), sid);
      cb?.(null);
    } catch (e) { cb?.(e); }
  }

  destroy(sid, cb) {
    try {
      SQL.destroy.run(sid);
      cb?.(null);
    } catch (e) { cb?.(e); }
  }

  all(cb) {
    try {
      cb(null, SQL.all.all(Date.now()).map(r => JSON.parse(r.data)));
    } catch (e) { cb(e); }
  }

  length(cb) {
    try { cb(null, SQL.length.get(Date.now()).n); } catch (e) { cb(e); }
  }

  clear(cb) {
    try { SQL.clear.run(); cb?.(null); } catch (e) { cb?.(e); }
  }
}
