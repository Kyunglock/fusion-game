import { db } from './index.js';

/**
 * 계정 = 닉네임.
 * 비밀번호가 없고, 닉네임을 입력하면 그 닉네임의 계정으로 바로 접속된다.
 * (처음 보는 닉네임이면 새 계정을 만든다)
 */

const SQL = {
  insert:      db.prepare('INSERT INTO users (username) VALUES (?)'),
  byUsername:  db.prepare('SELECT * FROM users WHERE username = ?'),
  byId:        db.prepare('SELECT * FROM users WHERE id = ?'),
  setUsername: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
  setAvatar:   db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
  touchLogin:  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?"),
};

/** 라우터가 그대로 응답으로 바꿀 수 있는 검증/충돌 에러 */
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── 입력 검증 ────────────────────────────────────────────────────────────────
export function validateUsername(raw) {
  const username = String(raw ?? '').trim().slice(0, 16);
  if (!username)           throw new UserError('닉네임을 입력해주세요.');
  if (/\s/.test(username)) throw new UserError('닉네임에 띄어쓰기를 사용할 수 없습니다.');
  if (username.length < 2) throw new UserError('닉네임은 2자 이상이어야 합니다.');
  return username;
}

// ── 조회 ─────────────────────────────────────────────────────────────────────
export function findById(id)             { return SQL.byId.get(id) ?? null; }
export function findByUsername(username) { return SQL.byUsername.get(username) ?? null; }

/** 닉네임으로 접속. 없으면 새로 만든다 (대소문자 구분 없이 같은 닉네임 = 같은 계정) */
export function loginOrCreate(username) {
  let user = findByUsername(username);
  if (!user) {
    try {
      const { lastInsertRowid } = SQL.insert.run(username);
      user = findById(Number(lastInsertRowid));
    } catch (e) {
      // 동시 접속으로 같은 닉네임이 먼저 들어갔다면 그 계정을 쓴다.
      if (e.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw e;
      user = findByUsername(username);
    }
  }
  SQL.touchLogin.run(user.id);
  return user;
}

// ── 프로필 수정 ──────────────────────────────────────────────────────────────
export function updateUsername(id, username) {
  const owner = findByUsername(username);
  if (owner && owner.id !== id) throw new UserError('이미 사용 중인 닉네임입니다.', 409);
  SQL.setUsername.run(username, id);
  return username;
}

export function updateAvatar(id, avatar) {
  SQL.setAvatar.run(avatar, id);
  return avatar;
}
