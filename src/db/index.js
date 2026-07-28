import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

// DB 파일 경로. 도커에서는 볼륨으로 마운트한 /app/data 를 쓰도록 DB_PATH 를 준다.
const DB_PATH = resolve(process.env.DB_PATH ?? 'data/app.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// WAL: 읽기와 쓰기가 서로를 막지 않는다(소켓 이벤트 중 통계 기록이 끼어들어도 안전).
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── 마이그레이션 ──────────────────────────────────────────────────────────────
// user_version 에 적용된 마이그레이션 개수를 저장한다. 배열 끝에 추가만 할 것
// (이미 배포된 항목을 수정하면 기존 DB에는 반영되지 않는다).
const MIGRATIONS = [
  `
  -- 비밀번호 없이 닉네임 자체가 계정이다. 같은 닉네임으로 접속하면 같은 계정으로
  -- 이어지고, 처음 보는 닉네임이면 그 자리에서 계정이 만들어진다.
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    avatar        TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  -- 게임별 누적 전적
  CREATE TABLE game_stats (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game       TEXT    NOT NULL,
    plays      INTEGER NOT NULL DEFAULT 0,
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    score      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game)
  );

  -- 판별 기록 (최근 전적 목록용)
  CREATE TABLE game_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game       TEXT    NOT NULL,
    outcome    TEXT    NOT NULL CHECK (outcome IN ('win', 'lose', 'draw')),
    score      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_game_results_user ON game_results(user_id, id DESC);

  -- express-session 저장소 (서버를 재시작해도 로그인이 유지된다)
  CREATE TABLE sessions (
    sid     TEXT    PRIMARY KEY,
    data    TEXT    NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_expires ON sessions(expires);
  `,
  `
  -- 자모 워들 솔플의 '난이도별 하루 한 판' 기록.
  -- 솔플은 브라우저 안에서만 돌기 때문에 결과를 그대로 믿을 수밖에 없다. 대신
  -- 이 표가 (유저, 날짜, 난이도)당 한 줄만 허용해 반복 제출로 전적을 부풀리는 것을
  -- 막고, 하루 1회 클리어 잠금도 기기와 무관하게 유지시킨다.
  CREATE TABLE jamo_solo_daily (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    play_date  TEXT    NOT NULL,  -- '오늘의 낱말' 기준일 (YYYY-MM-DD)
    difficulty TEXT    NOT NULL,  -- easy | medium | hard
    solved     INTEGER NOT NULL DEFAULT 0,
    attempts   INTEGER NOT NULL DEFAULT 0,
    cleared_at TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, play_date, difficulty)
  );
  `,
];

function migrate() {
  const applied = db.pragma('user_version', { simple: true });
  for (let v = applied; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
      db.exec('COMMIT');
      console.log(`[db] 마이그레이션 ${v + 1} 적용`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

migrate();

console.log(`[db] SQLite 준비 완료 → ${DB_PATH}`);
