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
 */

export const CATCHMIND_GAME = 'catchmind';

const SQL = {
  insert: db.prepare(`INSERT INTO catchmind_drawings (user_id, word, strokes)
                      VALUES (@userId, @word, @strokes)`),

  // 제시어 쏠림을 막기 위한 '제시어별 그림 수'
  wordCounts: db.prepare(`SELECT word, COUNT(*) AS n FROM catchmind_drawings
                          WHERE hidden = 0 GROUP BY word`),

  // 출제: 숨김 아님 + 내 그림 아님 + 내가 아직 '끝내지' 않은 것.
  // 기준이 '풀이 기록이 없을 것'이 아니라 finished 인 이유 — 열어만 보고 나가버린
  // 그림까지 빼버리면 다시는 안 나온다.
  pickFresh: db.prepare(`
    SELECT d.*, u.username AS author, u.avatar AS author_avatar
    FROM catchmind_drawings d
    JOIN users u ON u.id = d.user_id
    WHERE d.hidden = 0 AND d.user_id != @userId
      AND NOT EXISTS (SELECT 1 FROM catchmind_plays p
                      WHERE p.drawing_id = d.id AND p.user_id = @userId AND p.finished = 1)
    ORDER BY RANDOM() LIMIT 1`),

  // 새 그림이 다 떨어졌을 때의 복습용 (전적은 이미 기록됐으므로 다시 쌓지 않는다)
  pickReplay: db.prepare(`
    SELECT d.*, u.username AS author, u.avatar AS author_avatar
    FROM catchmind_drawings d
    JOIN users u ON u.id = d.user_id
    WHERE d.hidden = 0 AND d.user_id != @userId
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

  mine: db.prepare(`SELECT id, word, strokes, seen_count, solved_count, reports, hidden,
                           likes, dislikes, created_at
                    FROM catchmind_drawings
                    WHERE user_id = ? ORDER BY id DESC LIMIT ?`),
  hideMine: db.prepare('UPDATE catchmind_drawings SET hidden = 1 WHERE id = ? AND user_id = ?'),

  summary: db.prepare(`
    SELECT COUNT(*) AS drawn,
           COALESCE(SUM(seen_count), 0)   AS seen,
           COALESCE(SUM(solved_count), 0) AS solved,
           COALESCE(SUM(likes), 0)        AS likes,
           COALESCE(SUM(dislikes), 0)     AS dislikes
    FROM catchmind_drawings WHERE user_id = ? AND hidden = 0`),
  remaining: db.prepare(`
    SELECT COUNT(*) AS n FROM catchmind_drawings d
    WHERE d.hidden = 0 AND d.user_id != @userId
      AND NOT EXISTS (SELECT 1 FROM catchmind_plays p
                      WHERE p.drawing_id = d.id AND p.user_id = @userId AND p.finished = 1)`),
};

// ── 그리기 ────────────────────────────────────────────────────────────────────

/** 제시어별로 지금까지 그려진 그림 수 (제시어 배정 시 덜 그려진 쪽을 고르기 위함) */
export function drawingCounts() {
  const map = new Map();
  for (const row of SQL.wordCounts.all()) map.set(row.word, row.n);
  return map;
}

/** 그림 한 장 저장 → 새 id */
export function saveDrawing({ accountId, word, strokesJson }) {
  return SQL.insert.run({ userId: accountId, word, strokes: strokesJson }).lastInsertRowid;
}

// ── 맞히기 ────────────────────────────────────────────────────────────────────

/**
 * 맞힐 그림을 한 장 꺼낸다.
 * 아직 안 푼 그림이 우선이고, 다 풀었으면 복습용으로 아무 그림이나 준다
 * (복습은 전적에 반영하지 않는다 → replay 플래그).
 */
export function pickQuiz(accountId) {
  const fresh = SQL.pickFresh.get({ userId: accountId });
  if (fresh) return { drawing: fresh, replay: false };

  const replay = SQL.pickReplay.get({ userId: accountId });
  return replay ? { drawing: replay, replay: true } : null;
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

/** 아직 안 푼 그림이 몇 장 남았는지 */
export function remainingCount(accountId) {
  return SQL.remaining.get({ userId: accountId })?.n ?? 0;
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
    recordRound(CATCHMIND_GAME, [{
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
  recordRound(CATCHMIND_GAME, [{ accountId, outcome: 'lose', score: 0 }]);
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

// ── 내 그림 ───────────────────────────────────────────────────────────────────

export function myDrawings(accountId, limit = 60) {
  return SQL.mine.all(accountId, limit);
}

/** 내 그림 내리기 (기록은 남기고 출제에서만 뺀다 — 이미 푼 사람의 전적과 어긋나지 않게) */
export function hideMyDrawing(id, accountId) {
  return SQL.hideMine.run(id, accountId).changes > 0;
}

export function mySummary(accountId) {
  return SQL.summary.get(accountId) ?? { drawn: 0, seen: 0, solved: 0 };
}
