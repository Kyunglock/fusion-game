import { db } from './index.js';
import { recordRound } from './stats.js';
import {
  CATCHMIND_MAX_ATTEMPTS,
  CATCHMIND_REPORTS_TO_HIDE,
  CATCHMIND_SCORE_SOLVE,
} from '../config.js';

/**
 * 캐치마인드 저장소.
 *
 * 이 게임만 소켓을 쓰지 않는다 — 그림을 그려 DB에 넣어두면, 다른 사람이 아무 때나
 * 들어와 그 그림을 맞힌다. 그래서 방·턴 대신 '누가 어떤 그림을 이미 풀었는가'를
 * 표로 관리한다.
 *
 * 그림은 **서버(채널)별로 갈린다**(`catchmind_drawings.server_id`). 퓨전 서버에서
 * 그린 그림은 퓨전 사람들끼리, 친구방 그림은 친구들끼리만 출제·랭킹에 나온다.
 * 풀이·추천·신고는 drawing_id 를 타고 달리므로 그림만 가르면 따라서 갈린다.
 */

export const CATCHMIND_GAME = 'catchmind';

const SQL = {
  insert: db.prepare(`INSERT INTO catchmind_drawings (user_id, server_id, word, strokes)
                      VALUES (@userId, @serverId, @word, @strokes)`),

  // 제시어 쏠림을 막기 위한 '제시어별 그림 수' (쏠림도 서버 안에서만 따진다)
  wordCounts: db.prepare(`SELECT word, COUNT(*) AS n FROM catchmind_drawings
                          WHERE hidden = 0 AND server_id = @serverId GROUP BY word`),

  // 출제: 같은 서버 + 숨김 아님 + 내 그림 아님 + 내가 아직 '끝내지' 않은 것.
  // 기준이 '풀이 기록이 없을 것'이 아니라 finished 인 이유 — 열어만 보고 나가버린
  // 그림까지 빼버리면 다시는 안 나온다.
  // @skip 은 '다음에 풀기'로 넘긴 id 들(JSON 배열). 빈 배열이면 아무것도 빼지 않는다.
  pickFresh: db.prepare(`
    SELECT d.*, u.username AS author, u.avatar AS author_avatar
    FROM catchmind_drawings d
    JOIN users u ON u.id = d.user_id
    WHERE d.hidden = 0 AND d.server_id = @serverId AND d.user_id != @userId
      AND d.id NOT IN (SELECT value FROM json_each(@skip))
      AND NOT EXISTS (SELECT 1 FROM catchmind_plays p
                      WHERE p.drawing_id = d.id AND p.user_id = @userId AND p.finished = 1)
    ORDER BY RANDOM() LIMIT 1`),

  // 새 그림이 다 떨어졌을 때의 복습용 (전적은 이미 기록됐으므로 다시 쌓지 않는다)
  pickReplay: db.prepare(`
    SELECT d.*, u.username AS author, u.avatar AS author_avatar
    FROM catchmind_drawings d
    JOIN users u ON u.id = d.user_id
    WHERE d.hidden = 0 AND d.server_id = @serverId AND d.user_id != @userId
      AND d.id NOT IN (SELECT value FROM json_each(@skip))
    ORDER BY RANDOM() LIMIT 1`),

  byId: db.prepare(`SELECT d.*, u.username AS author, u.avatar AS author_avatar
                    FROM catchmind_drawings d
                    JOIN users u ON u.id = d.user_id
                    WHERE d.id = ?`),

  bumpSeen: db.prepare('UPDATE catchmind_drawings SET seen_count = seen_count + 1 WHERE id = ?'),
  bumpSolved: db.prepare('UPDATE catchmind_drawings SET solved_count = solved_count + 1 WHERE id = ?'),

  playOf: db.prepare('SELECT * FROM catchmind_plays WHERE drawing_id = ? AND user_id = ?'),
  startPlay: db.prepare(`INSERT INTO catchmind_plays (drawing_id, user_id)
                         VALUES (?, ?) ON CONFLICT DO NOTHING`),
  bumpAttempt: db.prepare(`UPDATE catchmind_plays SET attempts = attempts + 1
                           WHERE drawing_id = ? AND user_id = ?`),
  finishPlay: db.prepare(`UPDATE catchmind_plays SET solved = @solved, finished = 1
                          WHERE drawing_id = @drawingId AND user_id = @userId`),

  myVote: db.prepare('SELECT value FROM catchmind_votes WHERE drawing_id = ? AND user_id = ?'),
  castVote: db.prepare(`INSERT INTO catchmind_votes (drawing_id, user_id, value)
                        VALUES (@drawingId, @userId, @value)
                        ON CONFLICT(drawing_id, user_id) DO UPDATE SET value = @value`),
  clearVote: db.prepare('DELETE FROM catchmind_votes WHERE drawing_id = ? AND user_id = ?'),
  tallyVotes: db.prepare(`
    SELECT COALESCE(SUM(value =  1), 0) AS likes,
           COALESCE(SUM(value = -1), 0) AS dislikes
    FROM catchmind_votes WHERE drawing_id = ?`),
  setVotes: db.prepare(`UPDATE catchmind_drawings SET likes = @likes, dislikes = @dislikes
                        WHERE id = @id`),

  addReport: db.prepare(`INSERT INTO catchmind_reports (drawing_id, user_id)
                         VALUES (?, ?) ON CONFLICT DO NOTHING`),
  countReports: db.prepare('SELECT COUNT(*) AS n FROM catchmind_reports WHERE drawing_id = ?'),
  setReports: db.prepare(`UPDATE catchmind_drawings SET reports = @reports, hidden = @hidden
                          WHERE id = @id`),

  // '내 그림'도 지금 들어와 있는 서버의 것만 보여준다 — 목록에 뜨는 조회·정답 수가
  // 그 서버에서 실제로 일어난 일과 어긋나지 않도록.
  mine: db.prepare(`SELECT id, word, strokes, seen_count, solved_count, reports, hidden,
                           likes, dislikes, created_at
                    FROM catchmind_drawings
                    WHERE user_id = @userId AND server_id = @serverId
                    ORDER BY id DESC LIMIT @limit`),
  hideMine: db.prepare(`UPDATE catchmind_drawings SET hidden = 1
                        WHERE id = @id AND user_id = @userId AND server_id = @serverId`),

  summary: db.prepare(`
    SELECT COUNT(*) AS drawn,
           COALESCE(SUM(seen_count), 0)   AS seen,
           COALESCE(SUM(solved_count), 0) AS solved,
           COALESCE(SUM(likes), 0)        AS likes,
           COALESCE(SUM(dislikes), 0)     AS dislikes
    FROM catchmind_drawings
    WHERE user_id = @userId AND server_id = @serverId AND hidden = 0`),
  remaining: db.prepare(`
    SELECT COUNT(*) AS n FROM catchmind_drawings d
    WHERE d.hidden = 0 AND d.server_id = @serverId AND d.user_id != @userId
      AND NOT EXISTS (SELECT 1 FROM catchmind_plays p
                      WHERE p.drawing_id = d.id AND p.user_id = @userId AND p.finished = 1)`),

  // 그림 평가 — 내가 **끝낸**(맞혔든 틀렸든) 그림만 대상이다. 아직 손대지 않은
  // 그림을 여기 끼우면 목록에 정답이 그대로 새어 나가므로 제외한다.
  // 내가 그린 그림도 뺀다(자기 그림에는 표를 던질 수 없다 — 라우터의 loadQuiz 와 같은 규칙).
  rated: (cond) => db.prepare(`
    SELECT d.id, d.word, d.strokes, d.likes, d.dislikes,
           d.seen_count, d.solved_count, d.created_at,
           u.username AS author, u.avatar AS author_avatar,
           p.solved AS solved_by_me, p.attempts AS my_attempts,
           COALESCE(v.value, 0) AS my_vote
    FROM catchmind_plays p
    JOIN catchmind_drawings d ON d.id = p.drawing_id
    JOIN users u ON u.id = d.user_id
    LEFT JOIN catchmind_votes v ON v.drawing_id = d.id AND v.user_id = @userId
    WHERE p.user_id = @userId AND p.finished = 1
      AND d.hidden = 0 AND d.server_id = @serverId AND d.user_id != @userId
      ${cond}
    ORDER BY p.created_at DESC, d.id DESC
    LIMIT @limit`),

  // 홈 안내문용 — 평가할 수 있는 그림이 몇 장이고 그중 아직 표를 안 던진 것이 몇 장인지
  playedCounts: db.prepare(`
    SELECT COUNT(*) AS played,
           COALESCE(SUM(v.value IS NULL), 0) AS unrated
    FROM catchmind_plays p
    JOIN catchmind_drawings d ON d.id = p.drawing_id
    LEFT JOIN catchmind_votes v ON v.drawing_id = d.id AND v.user_id = @userId
    WHERE p.user_id = @userId AND p.finished = 1
      AND d.hidden = 0 AND d.server_id = @serverId AND d.user_id != @userId`),

  // 랭킹. 오답 수는 따로 세어두지 않고 풀이 기록에서 그때그때 합산한다
  // (한 판에서 틀린 횟수 = 시도 횟수 - 맞힌 여부. 맞힌 판의 마지막 한 번은 정답이므로).
  // 목록이 수십 줄이라 매번 세도 부담이 없고, 컬럼을 늘려 어긋날 여지를 만들지 않는다.
  board: (order) => db.prepare(`
    SELECT d.id, d.word, d.strokes, d.likes, d.dislikes,
           d.seen_count, d.solved_count, d.created_at,
           u.username AS author, u.avatar AS author_avatar,
           d.user_id AS author_id,
           COALESCE(SUM(p.attempts - p.solved), 0) AS misses,
           MAX(CASE WHEN p.user_id = @userId AND p.solved   = 1 THEN 1 ELSE 0 END) AS solved_by_me,
           -- 맞혔든 틀렸든 '끝낸' 그림은 그때 정답을 이미 봤으므로 목록에서도 보여준다.
           MAX(CASE WHEN p.user_id = @userId AND p.finished = 1 THEN 1 ELSE 0 END) AS finished_by_me
    FROM catchmind_drawings d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN catchmind_plays p ON p.drawing_id = d.id
    WHERE d.hidden = 0 AND d.server_id = @serverId
    GROUP BY d.id
    ORDER BY ${order}
    LIMIT @limit`),
};

/**
 * 정렬 기준별 ORDER BY. 사용자 입력을 SQL 에 그대로 끼워 넣지 않으려고
 * 허용된 것만 여기 미리 만들어 두고 키로만 고른다.
 */
const BOARD_SORTS = {
  likes:    'd.likes DESC, misses DESC, d.id DESC',
  dislikes: 'd.dislikes DESC, misses DESC, d.id DESC',
  misses:   'misses DESC, d.likes DESC, d.id DESC',
};

const BOARD_SQL = Object.fromEntries(
  Object.entries(BOARD_SORTS).map(([key, order]) => [key, SQL.board(order)]),
);

/**
 * 그림 평가 목록의 필터. 랭킹의 정렬과 같은 이유로 조건절을 미리 만들어 두고
 * 키로만 고른다(사용자 입력이 SQL 에 끼어들 여지를 없앤다).
 */
const RATE_FILTERS = {
  all:     '',
  solved:  'AND p.solved = 1',
  missed:  'AND p.solved = 0',
  // 아직 표를 안 던진 것만. 목록 쿼리가 이미 내 표를 LEFT JOIN 해 두었으므로
  // 조건 한 줄로 갈린다.
  unrated: 'AND v.value IS NULL',
};

const RATE_SQL = Object.fromEntries(
  Object.entries(RATE_FILTERS).map(([key, cond]) => [key, SQL.rated(cond)]),
);

// ── 그리기 ────────────────────────────────────────────────────────────────────

/** 제시어별로 지금까지 그려진 그림 수 (제시어 배정 시 덜 그려진 쪽을 고르기 위함) */
export function drawingCounts(serverId) {
  const map = new Map();
  for (const row of SQL.wordCounts.all({ serverId })) map.set(row.word, row.n);
  return map;
}

/** 그림 한 장 저장 → 새 id. 그린 서버(채널)를 함께 박아둔다. */
export function saveDrawing({ accountId, serverId, word, strokesJson }) {
  return SQL.insert.run({ userId: accountId, serverId, word, strokes: strokesJson }).lastInsertRowid;
}

// ── 맞히기 ────────────────────────────────────────────────────────────────────

/**
 * 맞힐 그림을 한 장 꺼낸다.
 * 아직 안 푼 그림이 우선이고, 다 풀었으면 복습용으로 아무 그림이나 준다
 * (복습은 전적에 반영하지 않는다 → replay 플래그).
 *
 * `skipIds` 는 '다음에 풀기'로 넘긴 그림들이다. 넘긴 그림은 **버리는 것이 아니라
 * 뒤로 미루는 것**이라 조건에서만 빼고 풀이 기록은 건드리지 않는다. 넘긴 것밖에
 * 남지 않았다면 한 바퀴 다 돈 것이므로 그 기록을 접고 처음부터 다시 준다
 * (`exhausted` → 라우터가 세션의 넘김 목록을 비운다).
 */
export function pickQuiz(accountId, serverId, skipIds = []) {
  const pick = (stmt, skip) => stmt.get({ userId: accountId, serverId, skip }) ?? null;
  const skip = JSON.stringify(skipIds);

  const fresh = pick(SQL.pickFresh, skip);
  if (fresh) return { drawing: fresh, replay: false, exhausted: false };

  const freshAgain = skipIds.length ? pick(SQL.pickFresh, '[]') : null;
  if (freshAgain) return { drawing: freshAgain, replay: false, exhausted: true };

  // 새 그림이 아예 없으면 복습. 이때도 방금 넘긴 것은 되도록 피해준다.
  const replay = pick(SQL.pickReplay, skip) ?? (skipIds.length ? pick(SQL.pickReplay, '[]') : null);
  return replay ? { drawing: replay, replay: true, exhausted: skipIds.length > 0 } : null;
}

export function getDrawing(id) {
  return SQL.byId.get(id) ?? null;
}

/**
 * 그 사람이 이 그림을 푼 기록 (없으면 null).
 * 이미 끝낸 그림이면 다시 풀어도 전적에 반영하지 않는다 — 즉 이 한 줄이
 * '복습인가 아닌가'의 판단 근거라서 굳이 세션에 상태를 들고 있을 필요가 없다.
 */
export function getPlay(drawingId, accountId) {
  return SQL.playOf.get(drawingId, accountId) ?? null;
}

/** 아직 안 푼 그림이 몇 장 남았는지 (지금 서버의 그림만) */
export function remainingCount(accountId, serverId) {
  return SQL.remaining.get({ userId: accountId, serverId })?.n ?? 0;
}

/** 그림을 열어볼 때 — 조회수 +1, 풀이 기록 시작 */
export function openQuiz(drawingId, accountId, { replay }) {
  if (replay) return SQL.playOf.get(drawingId, accountId) ?? null;

  const isFirstOpen = SQL.startPlay.run(drawingId, accountId).changes > 0;
  if (isFirstOpen) SQL.bumpSeen.run(drawingId);
  return SQL.playOf.get(drawingId, accountId) ?? null;
}

/** 맞혔을 때 점수. 초성은 모두에게 처음부터 보이므로 조건 없이 한 값이다. */
export function guessScore() {
  return CATCHMIND_SCORE_SOLVE;
}

/**
 * 정답 시도 한 번을 처리한다.
 *
 * 전적은 **그 그림을 처음 풀 때 한 번만** 남긴다(catchmind_plays.finished). 복습이나
 * 재도전으로 같은 그림을 다시 맞혀도 승수가 늘지 않는다.
 *
 * @returns {{ correct, attempts, remainingAttempts, finished, recorded, score }}
 */
export const submitGuess = db.transaction((drawing, accountId, correct, { replay }) => {
  const alreadyFinished = replay || (SQL.playOf.get(drawing.id, accountId)?.finished === 1);

  if (!replay) SQL.bumpAttempt.run(drawing.id, accountId);
  const play     = SQL.playOf.get(drawing.id, accountId);
  const attempts = play?.attempts ?? 1;

  const outOfTries = attempts >= CATCHMIND_MAX_ATTEMPTS;
  const finished   = correct || outOfTries;
  let recorded = false;
  let score    = 0;

  if (finished && !alreadyFinished) {
    SQL.finishPlay.run({ drawingId: drawing.id, userId: accountId, solved: correct ? 1 : 0 });
    if (correct) SQL.bumpSolved.run(drawing.id);
    score    = correct ? guessScore() : 0;
    recorded = true;
    // 전적은 그 그림이 속한 서버(채널)에 쌓인다.
    recordRound(drawing.server_id, CATCHMIND_GAME, [{
      accountId,
      outcome: correct ? 'win' : 'lose',
      score,
    }]);
  } else if (finished && correct && replay) {
    // 복습으로 맞힌 것 — 그림의 정답 수는 올려주되 전적은 건드리지 않는다.
    SQL.bumpSolved.run(drawing.id);
  }

  return {
    correct,
    attempts,
    remainingAttempts: Math.max(0, CATCHMIND_MAX_ATTEMPTS - attempts),
    finished,
    recorded,
    score,
  };
});

/** 포기 — 정답을 보는 대신 패로 기록한다 (처음 푸는 그림일 때만) */
export const giveUp = db.transaction((drawing, accountId, { replay }) => {
  const play = SQL.playOf.get(drawing.id, accountId);
  if (replay || play?.finished === 1) return { recorded: false };

  SQL.finishPlay.run({ drawingId: drawing.id, userId: accountId, solved: 0 });
  recordRound(drawing.server_id, CATCHMIND_GAME, [{ accountId, outcome: 'lose', score: 0 }]);
  return { recorded: true };
});

// ── 추천 · 비추천 ─────────────────────────────────────────────────────────────

/** 내가 이 그림에 던진 표 (1 추천 / -1 비추천 / 0 없음) */
export function myVote(drawingId, accountId) {
  return SQL.myVote.get(drawingId, accountId)?.value ?? 0;
}

/**
 * 한 사람이 한 그림에 한 표. 같은 걸 다시 누르면 취소되고, 반대쪽을 누르면 바뀐다.
 * 합계는 그림 행에 함께 적어둔다(목록에서 매번 세지 않도록).
 * @param {number} value 1 추천 / -1 비추천 / 0 취소
 */
export const castVote = db.transaction((drawingId, accountId, value) => {
  const before = myVote(drawingId, accountId);
  const next   = before === value ? 0 : value; // 같은 버튼을 또 누르면 취소

  if (next === 0) SQL.clearVote.run(drawingId, accountId);
  else            SQL.castVote.run({ drawingId, userId: accountId, value: next });

  const tally = SQL.tallyVotes.get(drawingId) ?? { likes: 0, dislikes: 0 };
  SQL.setVotes.run({ id: drawingId, ...tally });
  return { ...tally, mine: next };
});

// ── 신고 (쌓이면 자동으로 출제에서 제외) ──────────────────────────────────────

export const reportDrawing = db.transaction((drawingId, accountId) => {
  SQL.addReport.run(drawingId, accountId);
  const reports = SQL.countReports.get(drawingId)?.n ?? 0;
  const hidden  = reports >= CATCHMIND_REPORTS_TO_HIDE;
  SQL.setReports.run({ id: drawingId, reports, hidden: hidden ? 1 : 0 });
  return { reports, needed: CATCHMIND_REPORTS_TO_HIDE, hidden };
});

// ── 랭킹 ──────────────────────────────────────────────────────────────────────

export const BOARD_SORT_KEYS = Object.keys(BOARD_SORTS);

/**
 * 그림 랭킹. 추천 많은 순 / 비추천 많은 순 / 사람들이 많이 틀린 순으로 준다.
 *
 * **정답은 여기서 걸러내지 않는다** — 라우터가 `finished_by_me` 를 보고 내가 이미
 * 끝낸 그림(과 내 그림)만 제시어를 실어 보낸다. 아직 손대지 않은 그림의 답이
 * 목록으로 새어 나가면 맞히기 자체가 무의미해진다.
 *
 * @param {number} accountId
 * @param {string} serverId 지금 들어와 있는 서버 — 이 서버의 그림만 줄 세운다
 * @param {'likes'|'dislikes'|'misses'} sort
 */
export function leaderboard(accountId, serverId, sort = 'likes', limit = 30) {
  const stmt = BOARD_SQL[sort] ?? BOARD_SQL.likes;
  return stmt.all({ userId: accountId, serverId, limit });
}

// ── 그림 평가 ─────────────────────────────────────────────────────────────────

export const RATE_FILTER_KEYS = Object.keys(RATE_FILTERS);

/**
 * 평가할 수 있는 그림 목록 — **내가 이미 끝낸 그림**(맞혔거나 틀렸거나 포기한 것)만.
 *
 * 맞히기 화면에서는 지금 풀고 있는 한 장에만 표를 던질 수 있어서, 지나간 그림을
 * 다시 찾아 평가할 방법이 없었다. 이 목록이 그 자리를 메운다. 대상이 '끝낸 그림'인
 * 이유는 두 가지다 — 그 자리에서 정답을 이미 봤으니 제시어를 그대로 보여줄 수 있고,
 * 그림이 어땠는지 판단할 근거(맞혔는지·몇 번 틀렸는지)가 그 사람에게 있다.
 *
 * @param {'all'|'solved'|'missed'|'unrated'} filter 전체 / 맞힌 것 / 틀린 것 / 아직 평가 안 한 것
 */
export function ratedDrawings(accountId, serverId, filter = 'all', limit = 60) {
  const stmt = RATE_SQL[filter] ?? RATE_SQL.all;
  return stmt.all({ userId: accountId, serverId, limit });
}

/** 평가 대상(끝낸 그림) 수와 그중 아직 표를 안 던진 수 */
export function playedSummary(accountId, serverId) {
  return SQL.playedCounts.get({ userId: accountId, serverId }) ?? { played: 0, unrated: 0 };
}

// ── 내 그림 ───────────────────────────────────────────────────────────────────

export function myDrawings(accountId, serverId, limit = 60) {
  return SQL.mine.all({ userId: accountId, serverId, limit });
}

/** 내 그림 내리기 (기록은 남기고 출제에서만 뺀다 — 이미 푼 사람의 전적과 어긋나지 않게) */
export function hideMyDrawing(id, accountId, serverId) {
  return SQL.hideMine.run({ id, userId: accountId, serverId }).changes > 0;
}

export function mySummary(accountId, serverId) {
  return SQL.summary.get({ userId: accountId, serverId }) ?? { drawn: 0, seen: 0, solved: 0 };
}
