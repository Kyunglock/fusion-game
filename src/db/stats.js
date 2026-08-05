import { db } from './index.js';

/** 전적을 남기는 게임 목록 (키 → 표시 이름) */
export const GAMES = {
  crocodile: '악어 이빨 뽑기',
  bomb:      '폭탄 돌리기',
  tetris:    '테트리스 배틀',
  jamo:      '자모 워들',
  wordchain: '끝말잇기',
  liar:      '라이어 게임',
  jamoSolo:  '자모 워들 솔로',
  catchmind: '캐치마인드',
};

const SQL = {
  upsert: db.prepare(`
    INSERT INTO game_stats (user_id, game, plays, wins, losses, score)
    VALUES (@userId, @game, 1, @win, @lose, @score)
    ON CONFLICT(user_id, game) DO UPDATE SET
      plays      = plays  + 1,
      wins       = wins   + @win,
      losses     = losses + @lose,
      score      = score  + @score,
      updated_at = datetime('now')`),
  insertResult: db.prepare(`INSERT INTO game_results (user_id, game, outcome, score)
                            VALUES (@userId, @game, @outcome, @score)`),
  statsOf:  db.prepare('SELECT game, plays, wins, losses, score FROM game_stats WHERE user_id = ? ORDER BY plays DESC'),
  gameOf:   db.prepare('SELECT plays, wins, losses, score FROM game_stats WHERE user_id = ? AND game = ?'),
  recentOf: db.prepare(`SELECT game, outcome, score, created_at FROM game_results
                        WHERE user_id = ? ORDER BY id DESC LIMIT ?`),
  trimOld: db.prepare(`DELETE FROM game_results
                       WHERE user_id = ? AND id NOT IN (
                         SELECT id FROM game_results WHERE user_id = ? ORDER BY id DESC LIMIT ?)`),
};

/** 유저당 보관하는 최근 전적 개수 (오래된 기록은 잘라내 DB가 무한정 커지지 않게 한다) */
const KEEP_RESULTS = 100;

const writeRound = db.transaction((game, entries) => {
  for (const { accountId, outcome, score } of entries) {
    const row = {
      userId:  accountId,
      game,
      outcome,
      score:   Number.isFinite(score) ? score : 0,
      win:     outcome === 'win'  ? 1 : 0,
      lose:    outcome === 'lose' ? 1 : 0,
    };
    SQL.upsert.run(row);
    SQL.insertResult.run(row);
    SQL.trimOld.run(accountId, accountId, KEEP_RESULTS);
  }
});

/**
 * 한 판의 결과를 기록한다.
 * @param {string} game     GAMES 의 키
 * @param {Array}  entries  [{ accountId, outcome: 'win'|'lose'|'draw', score }]
 *                          accountId 가 없는 게스트는 자동으로 걸러진다.
 */
export function recordRound(game, entries) {
  const rows = (entries ?? []).filter(e => Number.isInteger(e?.accountId));
  if (!GAMES[game] || rows.length === 0) return;
  try {
    writeRound(game, rows);
  } catch (e) {
    // 전적 기록 실패가 게임 진행을 막아서는 안 된다.
    console.error(`[stats] ${game} 전적 기록 실패`, e);
  }
}

/**
 * 방 플레이어 배열에서 승자/패자를 갈라 한 번에 기록한다.
 * @param {string}   game
 * @param {Array}    players    room.players
 * @param {function} outcomeOf  (player) => 'win'|'lose'|'draw'|null (null이면 기록 제외)
 * @param {function} [scoreOf]  (player) => number
 */
export function recordPlayers(game, players, outcomeOf, scoreOf = () => 0) {
  const entries = [];
  for (const p of players ?? []) {
    const outcome = outcomeOf(p);
    if (!outcome) continue;
    entries.push({ accountId: p.accountId ?? null, outcome, score: scoreOf(p) });
  }
  recordRound(game, entries);
}

/** 한 게임의 누적 전적 한 줄 (기록이 없으면 0) */
export function getGameRecord(userId, game) {
  const row = SQL.gameOf.get(userId, game) ?? { plays: 0, wins: 0, losses: 0, score: 0 };
  return { ...row, winRate: row.plays > 0 ? Math.round((row.wins / row.plays) * 100) : 0 };
}

/** 프로필용: 게임별 누적 전적 + 최근 기록 */
export function getUserStats(userId, recentLimit = 20) {
  const stats = SQL.statsOf.all(userId).map(s => ({
    ...s,
    gameName: GAMES[s.game] ?? s.game,
    winRate:  s.plays > 0 ? Math.round((s.wins / s.plays) * 100) : 0,
  }));

  const totals = stats.reduce((acc, s) => ({
    plays:  acc.plays  + s.plays,
    wins:   acc.wins   + s.wins,
    losses: acc.losses + s.losses,
  }), { plays: 0, wins: 0, losses: 0 });

  const recent = SQL.recentOf.all(userId, recentLimit).map(r => ({
    ...r,
    gameName: GAMES[r.game] ?? r.game,
  }));

  return {
    stats,
    recent,
    totals: { ...totals, winRate: totals.plays > 0 ? Math.round((totals.wins / totals.plays) * 100) : 0 },
  };
}
