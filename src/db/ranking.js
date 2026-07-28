import { db } from './index.js';

/**
 * 리그 오브 레전드식 등급 시스템.
 *
 * 절대 점수 구간이 아니라 **전체 유저 중 상위 몇 %인지**로 티어를 나눈다.
 * (인원이 적을 때도 위아래가 골고루 갈리도록 — 5명이면 5명이 서로 다른 티어가 된다)
 */

// 상위 누적 백분위 상한. LoL 실제 분포와 비슷한 비율로 잡았다.
export const TIERS = [
  { key: 'challenger',  name: '챌린저',     emoji: '👑', topPercent:   0.05, divisions: false },
  { key: 'grandmaster', name: '그랜드마스터', emoji: '🔥', topPercent:   0.2,  divisions: false },
  { key: 'master',      name: '마스터',     emoji: '🟣', topPercent:   1,    divisions: false },
  { key: 'diamond',     name: '다이아몬드',  emoji: '💎', topPercent:   4,    divisions: true  },
  { key: 'emerald',     name: '에메랄드',    emoji: '🟩', topPercent:  12,    divisions: true  },
  { key: 'platinum',    name: '플래티넘',    emoji: '🟦', topPercent:  25,    divisions: true  },
  { key: 'gold',        name: '골드',       emoji: '🥇', topPercent:  45,    divisions: true  },
  { key: 'silver',      name: '실버',       emoji: '🥈', topPercent:  65,    divisions: true  },
  { key: 'bronze',      name: '브론즈',     emoji: '🥉', topPercent:  85,    divisions: true  },
  { key: 'iron',        name: '아이언',     emoji: '⬛', topPercent: 100,    divisions: true  },
];

export const UNRANKED = { key: 'unranked', name: '언랭크', emoji: '⬜', division: null };

/** 판을 한 번도 안 한 유저는 순위에서 빼고 언랭크로 둔다 */
const MIN_PLAYS = 1;

// 승 +25, 패 -10 (LP 감각). 무승부는 0점. 점수는 0 아래로 내려가지 않는다.
const WIN_POINTS  = 25;
const LOSE_POINTS = 10;

const SQL = {
  aggregate: db.prepare(`
    SELECT u.id, u.username, u.avatar,
           SUM(s.plays)  AS plays,
           SUM(s.wins)   AS wins,
           SUM(s.losses) AS losses
    FROM users u
    JOIN game_stats s ON s.user_id = u.id
    GROUP BY u.id
    HAVING plays >= ${MIN_PLAYS}`),
};

export function pointsOf({ wins, losses }) {
  return Math.max(0, wins * WIN_POINTS - losses * LOSE_POINTS);
}

/**
 * 상위 백분위(0~100) → 티어/디비전.
 * 디비전은 티어 구간 안에서의 위치로 IV~I 를 매긴다 (위로 갈수록 I).
 */
export function tierByPercentile(percentile) {
  let bottom = 0;
  for (const tier of TIERS) {
    if (percentile <= tier.topPercent || tier === TIERS[TIERS.length - 1]) {
      if (!tier.divisions) return { ...tier, division: null };
      const span  = tier.topPercent - bottom;
      // 구간 위쪽(=백분위가 작음)일수록 1에 가깝다
      const ratio = span > 0 ? (tier.topPercent - percentile) / span : 1;
      const idx   = Math.min(3, Math.max(0, Math.floor(ratio * 4)));
      return { ...tier, division: ['IV', 'III', 'II', 'I'][idx] };
    }
    bottom = tier.topPercent;
  }
  return { ...TIERS[TIERS.length - 1], division: 'IV' };
}

/**
 * 전체 유저를 점수순으로 정렬하고 백분위에 맞는 티어를 붙여 돌려준다.
 * 동점자는 승 → 판수 → 가입순으로 순서를 갈라, 같은 점수라도 등급이 겹치지 않게 한다.
 */
export function getRanking() {
  const rows = SQL.aggregate.all()
    .map(r => ({ ...r, points: pointsOf(r) }))
    .sort((a, b) =>
      b.points - a.points ||
      b.wins   - a.wins   ||
      b.plays  - a.plays  ||
      a.id     - b.id);

  const total = rows.length;

  return rows.map((r, i) => {
    // 구간의 가운데 값을 쓰면 인원이 적어도 최상·최하위로 쏠리지 않는다.
    const percentile = ((i + 0.5) / total) * 100;
    const tier = tierByPercentile(percentile);
    return {
      userId:     r.id,
      username:   r.username,
      avatar:     r.avatar,
      plays:      r.plays,
      wins:       r.wins,
      losses:     r.losses,
      winRate:    r.plays > 0 ? Math.round((r.wins / r.plays) * 100) : 0,
      points:     r.points,
      rank:       i + 1,
      totalUsers: total,
      percentile: Math.round(percentile * 10) / 10,
      tier:       { key: tier.key, name: tier.name, emoji: tier.emoji, division: tier.division },
    };
  });
}

/** 특정 유저의 등급. 전적이 없으면 언랭크 */
export function getUserRank(userId) {
  const ranking = getRanking();
  const entry   = ranking.find(r => r.userId === userId);
  if (entry) return entry;
  return {
    userId, rank: null, totalUsers: ranking.length, percentile: null,
    points: 0, plays: 0, wins: 0, losses: 0, winRate: 0,
    tier: { key: UNRANKED.key, name: UNRANKED.name, emoji: UNRANKED.emoji, division: null },
  };
}
