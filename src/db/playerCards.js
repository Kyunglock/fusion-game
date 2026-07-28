import { getRanking, UNRANKED } from './ranking.js';
import { getGameRecord } from './stats.js';

/**
 * 방 참가자 목록에 같이 실어 보내는 "전적 카드".
 * 방에 들어온 사람들의 티어와 승패를 서로 볼 수 있게 하려고 만들었다.
 *
 * safeState 는 방 상태가 바뀔 때마다(준비 토글·시도 제출 등) 호출되므로
 * 전체 등급 계산(getRanking)을 매번 돌리지 않도록 짧게 캐시한다.
 * 한 판이 끝나 전적이 바뀌어도 TTL 안에 자연히 반영된다.
 */
const TTL = 3000;

let cachedAt   = 0;
let rankById   = new Map();
let gameRecord = new Map(); // `${game}:${userId}` → 이 게임 전적

function snapshot() {
  const now = Date.now();
  if (now - cachedAt > TTL) {
    rankById   = new Map(getRanking().map(r => [r.userId, r]));
    gameRecord = new Map();
    cachedAt   = now;
  }
  return rankById;
}

function recordOf(accountId, game) {
  const key = `${game}:${accountId}`;
  if (!gameRecord.has(key)) gameRecord.set(key, getGameRecord(accountId, game));
  return gameRecord.get(key);
}

/**
 * @param {number|null} accountId 로그인 계정 id (게스트는 null → 카드 없음)
 * @param {string}      game      GAMES 키 (해당 게임 전적을 함께 담는다)
 */
export function getPlayerCard(accountId, game) {
  if (!Number.isInteger(accountId)) return null;

  const ranks = snapshot();
  const r     = ranks.get(accountId);
  const tier  = r?.tier ?? { key: UNRANKED.key, name: UNRANKED.name, emoji: UNRANKED.emoji, division: null };

  return {
    tier,
    rank:       r?.rank       ?? null,
    totalUsers: r?.totalUsers ?? ranks.size,
    percentile: r?.percentile ?? null,
    points:     r?.points     ?? 0,
    total: {
      plays:   r?.plays   ?? 0,
      wins:    r?.wins    ?? 0,
      losses:  r?.losses  ?? 0,
      winRate: r?.winRate ?? 0,
    },
    game: recordOf(accountId, game),
  };
}
