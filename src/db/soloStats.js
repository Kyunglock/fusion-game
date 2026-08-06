import { db } from './index.js';
import { recordRound } from './stats.js';
import { JAMO_SOLO_MAX_ATTEMPTS } from '../config.js';

/**
 * 자모 워들 솔플 전적.
 *
 * 솔플은 서버/소켓 없이 브라우저 안에서만 돌기 때문에 결과를 그대로 받을 수밖에
 * 없다. 그래서 **난이도별 하루 첫 판 하나만** 전적에 반영한다(jamo_solo_daily 가
 * (유저, 날짜, 난이도)당 한 줄만 허용). 실패 후 '다시 도전'으로 맞힌 판은 클리어
 * 잠금만 갱신하고 전적은 건드리지 않는다.
 */

/** 솔플 전적의 게임 키 (멀티 '자모 워들'과 분리해서 쌓는다) */
export const JAMO_SOLO_GAME = 'jamoSolo';

const SQL = {
  // 그날 그 난이도의 첫 판만 들어간다. changes === 0 이면 이미 오늘 기록한 것.
  claimDay: db.prepare(`
    INSERT INTO jamo_solo_daily (user_id, server_id, play_date, difficulty, solved, attempts, cleared_at)
    VALUES (@userId, @serverId, @date, @difficulty, @solved, @attempts,
            CASE WHEN @solved = 1 THEN datetime('now') END)
    ON CONFLICT(user_id, play_date, difficulty) DO NOTHING`),
  markCleared: db.prepare(`
    UPDATE jamo_solo_daily SET solved = 1, cleared_at = datetime('now')
    WHERE user_id = ? AND play_date = ? AND difficulty = ? AND solved = 0`),
  ofDay: db.prepare(`SELECT difficulty, solved, attempts FROM jamo_solo_daily
                     WHERE user_id = ? AND play_date = ?`),
};

/** 솔플 점수: 적은 시도로 맞힐수록 높다 (1회 만에 = 6점 … 6회 = 1점) */
export function soloScore(attempts) {
  return Math.max(1, JAMO_SOLO_MAX_ATTEMPTS + 1 - attempts);
}

/** 그날의 난이도별 진행 상태 → { cleared: {easy:true,…}, played: {…} } */
export function getJamoSoloDay(accountId, date) {
  const cleared = {};
  const played  = {};
  for (const row of SQL.ofDay.all(accountId, date)) {
    played[row.difficulty] = { solved: !!row.solved, attempts: row.attempts };
    if (row.solved) cleared[row.difficulty] = true;
  }
  return { cleared, played };
}

/**
 * 솔플 한 판의 결과를 기록한다.
 * @param {object} r
 * @param {number} r.accountId
 * @param {string} r.serverId    친 서버(채널) — 전적이 이 서버에 쌓인다.
 *                               단 '난이도별 하루 한 판' 잠금은 서버와 무관하게 하나다
 *                               (서버를 오가며 하루에 두 배로 기록하지 못하도록).
 * @param {string} r.date        '오늘의 낱말' 기준일 (YYYY-MM-DD)
 * @param {string} r.difficulty  easy | medium | hard
 * @param {boolean} r.solved     맞혔는지
 * @param {number} r.attempts    시도 횟수
 * @returns {{ recorded: boolean, cleared: object, played: object }} recorded=false 면
 *          오늘 이미 기록한 난이도라 전적에는 반영하지 않았다는 뜻.
 */
export function recordJamoSolo({ accountId, serverId, date, difficulty, solved, attempts }) {
  const first = SQL.claimDay.run({
    userId:     accountId,
    serverId,
    date,
    difficulty,
    solved:     solved ? 1 : 0,
    attempts,
  }).changes > 0;

  if (first) {
    recordRound(serverId, JAMO_SOLO_GAME, [{
      accountId,
      outcome: solved ? 'win' : 'lose',
      score:   solved ? soloScore(attempts) : 0,
    }]);
  } else if (solved) {
    // 오늘 첫 판은 실패였고 재도전으로 맞힌 경우 — 잠금만 걸고 전적은 그대로 둔다.
    SQL.markCleared.run(accountId, date, difficulty);
  }

  return { recorded: first, ...getJamoSoloDay(accountId, date) };
}
