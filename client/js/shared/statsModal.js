// 전적 · 등급 모달 — 홈 화면과 게임 방 안(대기실 도크)에서 공용으로 쓴다.
// import 되는 즉시 모달 DOM을 body에 주입한다(다른 위장 위젯들과 같은 패턴).
import { escHtml } from '../utils.js';
import { tierLabel } from './myRank.js';

const OUTCOME_LABEL = { win: '승', lose: '패', draw: '무' };

async function api(url) {
  const res  = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

function renderRankCard(rank) {
  if (!rank) return '';
  const unranked = !rank.rank;
  const sub = unranked
    ? '게임을 한 판 이상 하면 등급이 매겨집니다'
    : `${rank.totalUsers}명 중 ${rank.rank}위 · 상위 ${rank.percentile}% · ${rank.points}p`;

  return `
    <div class="rank-card" data-tier="${escHtml(rank.tier.key)}">
      <div class="rank-tier">${escHtml(tierLabel(rank))}</div>
      <div class="rank-sub">${escHtml(sub)}</div>
      ${unranked ? '' : `<div class="rank-sub">${rank.plays}판 ${rank.wins}승 ${rank.losses}패 · 승률 ${rank.winRate}%</div>`}
    </div>`;
}

function renderStatsTable({ stats, totals }) {
  if (!stats.length) return '<p class="stats-empty">아직 전적이 없습니다. 게임을 한 판 해보세요!</p>';

  const rows = stats.map(s => `
    <tr>
      <td>${escHtml(s.gameName)}</td>
      <td>${s.plays}</td>
      <td class="win">${s.wins}</td>
      <td class="lose">${s.losses}</td>
      <td>${s.winRate}%</td>
    </tr>`).join('');

  // 좁은 화면에서 표가 잘리지 않도록 가로 스크롤 상자로 감싼다.
  return `
    <div class="table-scroll">
      <table class="stats-table">
        <thead><tr><th>게임</th><th>판</th><th>승</th><th>패</th><th>승률</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td>합계</td><td>${totals.plays}</td>
            <td class="win">${totals.wins}</td><td class="lose">${totals.losses}</td>
            <td>${totals.winRate}%</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

// DB 는 UTC('YYYY-MM-DD HH:MM:SS')로 저장하므로 브라우저 시간대로 바꿔 보여준다.
function formatDate(utc) {
  const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return utc;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderRecent(recent) {
  if (!recent.length) return '';
  const items = recent.slice(0, 10).map(r => `
    <li>
      <span class="recent-game">${escHtml(r.gameName)}</span>
      <span class="recent-outcome ${r.outcome}">${OUTCOME_LABEL[r.outcome] ?? r.outcome}</span>
      <span class="recent-date">${escHtml(formatDate(r.created_at))}</span>
    </li>`).join('');
  return `<p class="stats-subtitle">최근 전적</p><ul class="recent-list">${items}</ul>`;
}

function renderRanking(ranking, myId) {
  if (!ranking.length) return '';
  const rows = ranking.slice(0, 20).map(r => `
    <tr class="${r.userId === myId ? 'me' : ''}">
      <td>${r.rank}</td>
      <td>${escHtml(r.username)}</td>
      <td>${escHtml(tierLabel(r))}</td>
      <td>${r.points}p</td>
      <td>${r.wins}승 ${r.losses}패</td>
    </tr>`).join('');

  return `
    <p class="stats-subtitle">이 서버 등급표</p>
    <div class="table-scroll">
      <table class="stats-table ranking-table">
        <thead><tr><th>#</th><th>닉네임</th><th>등급</th><th>점수</th><th>전적</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── 모달 DOM (페이지에 이미 있으면 재사용, 없으면 새로 만든다) ────────────────
let modal = document.getElementById('stats-modal');
if (!modal) {
  modal = document.createElement('div');
  modal.id = 'stats-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card modal-card-wide">
      <h3 class="modal-title">내 전적</h3>
      <div id="stats-body">불러오는 중…</div>
      <button class="btn btn-secondary" id="btn-close-stats">닫기</button>
    </div>
  `;
  document.body.appendChild(modal);
}
const statsBody     = modal.querySelector('#stats-body');
const btnCloseStats = modal.querySelector('#btn-close-stats');

function closeStatsModal() { modal.classList.remove('show'); }

btnCloseStats.addEventListener('click', closeStatsModal);
modal.addEventListener('click', e => { if (e.target === modal) closeStatsModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStatsModal(); });

async function loadAndRender() {
  try {
    const [mine, ranking] = await Promise.all([api('/api/me/stats'), api('/api/ranking')]);
    // 전적·등급은 서버(채널)별로 갈리므로 어느 서버 기록인지 먼저 밝힌다.
    statsBody.innerHTML =
      (mine.serverName ? `<p class="stats-server-note">${escHtml(mine.serverName)} 기준 · 서버마다 전적이 따로 쌓입니다</p>` : '') +
      renderRankCard(mine.rank) +
      renderStatsTable(mine) +
      renderRecent(mine.recent) +
      renderRanking(ranking, mine.rank?.userId);
  } catch (e) {
    statsBody.innerHTML = `<p class="stats-empty">${escHtml(e.message)}</p>`;
  }
}

export function openStatsModal() {
  modal.classList.add('show');
  statsBody.innerHTML = '<p class="stats-empty">불러오는 중…</p>';
  loadAndRender();
}

/** 모달이 열려 있을 때만 조용히 다시 불러온다. 라운드가 끝날 때마다 호출하면 된다. */
export function refreshStatsIfOpen() {
  if (modal.classList.contains('show')) loadAndRender();
}

// ── 게임 방 안에서 쓰는 공용 도크 버튼 (홈은 자체 헤더 버튼을 쓰므로 호출하지 않는다) ──
function getDock() {
  let d = document.getElementById('pg-dock');
  if (!d) {
    d = document.createElement('div');
    d.id = 'pg-dock';
    d.style.cssText = 'position:fixed;right:calc(12px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom));z-index:999;display:flex;align-items:flex-end;justify-content:flex-end;flex-wrap:wrap;gap:8px;max-width:calc(100vw - 24px);';
    document.body.appendChild(d);
  }
  return d;
}

let dockButtonMounted = false;

export function initStatsDockButton() {
  if (dockButtonMounted) return;
  dockButtonMounted = true;

  const style = document.createElement('style');
  style.textContent = `
    #sw-pill {
      display: flex;
      align-items: center;
      gap: 7px;
      background: var(--sunken);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 7px 14px;
      cursor: pointer;
      user-select: none;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--green-pale);
      transition: border-color 0.2s;
      white-space: nowrap;
    }
    #sw-pill:hover { border-color: var(--green-light); }
    @media (max-width: 480px) { #sw-pill { padding: 6px 10px; font-size: 0.76rem; } }
  `;
  document.head.appendChild(style);

  const pill = document.createElement('div');
  pill.id = 'sw-pill';
  pill.innerHTML = '<span>📊</span><span>전적 · 등급</span>';
  pill.addEventListener('click', openStatsModal);
  getDock().appendChild(pill);
}
