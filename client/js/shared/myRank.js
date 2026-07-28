import { escHtml } from '../utils.js';

/**
 * 대기실 '내 등급 · 전적' 패널.
 *
 * `GET /api/me/stats` 로 등급(티어)과 게임별 누적 전적을 받아
 * 대기실 카드 위쪽(`#my-rank-panel`)에 뿌린다. 게임 시작 전에 자기 티어와
 * 승패를 확인하고 싶다는 요청 때문에 붙였다.
 */

/** 등급 표시 문자열 (예: '🥇 골드 II'). 홈 유저바와 같은 형식 */
export function tierLabel(rank) {
  if (!rank?.tier) return '';
  const { emoji, name, division } = rank.tier;
  return `${emoji} ${name}${division ? ` ${division}` : ''}`;
}

/** 티어 배지 한 조각 (등급이 없으면 언랭크 배지) */
export function tierBadgeHtml(rank) {
  const key = rank?.tier?.key ?? 'unranked';
  return `<span class="tier-badge" data-tier="${escHtml(key)}">${escHtml(tierLabel(rank) || '⬜ 언랭크')}</span>`;
}

/**
 * 방 참가자 목록에 붙는 한 줄짜리 전적 (티어 배지 + 이 게임 전적 + 전체 전적).
 * 서버가 `safePlayer` 에 실어 보내는 `card` 를 그대로 받는다.
 * @param {object|null} card
 * @param {string} gameLabel 이 게임 전적 앞에 붙일 짧은 이름 (예: '자모')
 */
export function playerCardHtml(card, gameLabel = '이 게임') {
  if (!card) return ''; // 게스트(로그인 계정 없음)

  const badge = tierBadgeHtml(card);
  const rec   = (label, r) => (r && r.plays > 0)
    ? `<span class="player-rank-rec"><span class="label">${escHtml(label)}</span><b class="win">${r.wins}승</b><b class="lose">${r.losses}패</b></span>`
    : '';

  const recs = `${rec(gameLabel, card.game)}${rec('전체', card.total)}`;
  return `<div class="player-rank">${badge}${recs || '<span class="player-rank-rec">전적 없음</span>'}</div>`;
}

function statChip(label, { wins = 0, losses = 0, winRate = 0 }) {
  return `
    <span class="my-rank-stat">
      <span class="label">${escHtml(label)}</span>
      <span class="win">${wins}승</span>
      <span class="lose">${losses}패</span>
      <span class="rate">${winRate}%</span>
    </span>`;
}

/**
 * @param {HTMLElement|null} el       패널 컨테이너 (`#my-rank-panel`)
 * @param {object}   opts
 * @param {string[]} opts.games      먼저 보여줄 게임 키 (`stats.js` 의 GAMES 키)
 * @param {number}   opts.minInterval 같은 화면에서 반복 렌더될 때의 최소 재조회 간격(ms)
 * @returns {{ refresh: (force?: boolean) => void }}
 */
export function createMyRankPanel(el, { games = [], minInterval = 5000 } = {}) {
  if (!el) return { refresh() {} };

  let lastAt   = 0;
  let inflight = false;

  function render(data) {
    const rank     = data.rank ?? null;
    const tierKey  = rank?.tier?.key ?? 'unranked';
    const totals   = data.totals ?? { plays: 0, wins: 0, losses: 0, winRate: 0 };
    const byGame   = new Map((data.stats ?? []).map(s => [s.game, s]));

    const meta = rank?.rank
      ? `${rank.rank}위 / ${rank.totalUsers}명 · 상위 ${rank.percentile}% · ${rank.points}점`
      : '아직 판이 없어 순위가 없어요';

    const chips = games
      .map(key => byGame.get(key))
      .filter(Boolean)
      .map(s => statChip(s.gameName, s));

    if (totals.plays > 0) chips.push(statChip('전체', totals));

    el.dataset.tier = tierKey;
    el.innerHTML = `
      <div class="my-rank-head">
        <span class="my-rank-title">내 등급</span>
        ${tierBadgeHtml(rank)}
        <span class="my-rank-meta">${escHtml(meta)}</span>
      </div>
      ${chips.length
        ? `<div class="my-rank-stats">${chips.join('')}</div>`
        : '<p class="my-rank-empty">아직 전적이 없어요. 한 판 이기고 티어를 올려보세요!</p>'}
    `;
    el.hidden = false;
  }

  function refresh(force = false) {
    const now = Date.now();
    if (inflight) return;
    if (!force && now - lastAt < minInterval) return;
    inflight = true;
    lastAt   = now;

    fetch('/api/me/stats')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data) render(data); })
      .catch(() => { /* 전적 조회 실패는 게임 진행과 무관하므로 조용히 무시 */ })
      .finally(() => { inflight = false; });
  }

  return { refresh };
}
