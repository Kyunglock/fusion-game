import { showError, escHtml }     from './utils.js';
import { io } from '/socket.io/socket.io.esm.min.js';

// ── 방 개수 실시간 표시 ────────────────────────────────────────────────────────
const roomCountCroc      = document.getElementById('room-count-croc');
const roomCountBomb      = document.getElementById('room-count-bomb');
const roomCountTetris    = document.getElementById('room-count-tetris');
const roomCountJamo      = document.getElementById('room-count-jamo');
const roomCountWordchain = document.getElementById('room-count-wordchain');

function updateRoomCount(el, rooms) {
  if (!el) return;
  const count = Array.isArray(rooms) ? rooms.length : 0;
  el.textContent = count > 0 ? `방 ${count}개 대기중` : '';
}

const sockBomb      = io('/bomb');
const sockTetris    = io('/tetris');
const sockJamo      = io('/jamo');
const sockWordchain = io('/wordchain');

sockBomb     .on('connect', () => sockBomb     .emit('get_rooms'));
sockTetris   .on('connect', () => sockTetris   .emit('get_rooms'));
sockJamo     .on('connect', () => sockJamo     .emit('get_rooms'));
sockWordchain.on('connect', () => sockWordchain.emit('get_rooms'));

sockBomb     .on('bomb_rooms_update',      rooms => updateRoomCount(roomCountBomb,      rooms));
sockTetris   .on('tetris_rooms_update',    rooms => updateRoomCount(roomCountTetris,    rooms));
sockJamo     .on('jamo_rooms_update',      rooms => updateRoomCount(roomCountJamo,      rooms));
sockWordchain.on('wordchain_rooms_update', rooms => updateRoomCount(roomCountWordchain, rooms));

const pageAuth    = document.getElementById('page-auth');
const pageSelect  = document.getElementById('page-select');
const displayNick = document.getElementById('display-nick');
const userAvatar  = document.getElementById('user-avatar');
const tierBadge   = document.getElementById('tier-badge');

const btnStart      = document.getElementById('btn-start');
const btnLogout     = document.getElementById('btn-logout');
const btnStats      = document.getElementById('btn-stats');
const inputUsername = document.getElementById('input-username');

const profileModal     = document.getElementById('profile-modal');
const avatarPreview    = document.getElementById('avatar-preview');
const avatarFileInput  = document.getElementById('avatar-file-input');
const inputNewUsername = document.getElementById('input-new-username');
const btnEditProfile   = document.getElementById('btn-edit-profile');
const btnSaveProfile   = document.getElementById('btn-save-profile');
const btnCancelProfile = document.getElementById('btn-cancel-profile');

const statsModal    = document.getElementById('stats-modal');
const statsBody     = document.getElementById('stats-body');
const btnCloseStats = document.getElementById('btn-close-stats');

const socket = io();
socket.on('connect', () => socket.emit('get_rooms'));
socket.on('rooms_update', rooms => updateRoomCount(roomCountCroc, rooms));

let pendingAvatar   = null;
let currentUsername = '';

// ── 아바타 표시 ───────────────────────────────────────────────────────────────
function setAvatar(el, avatar) {
  if (avatar) {
    el.innerHTML = `<img src="${avatar}" alt="avatar" style="width:100%;height:100%;object-fit:cover;" />`;
  } else {
    el.textContent = '😊';
  }
}

function tierLabel(rank) {
  if (!rank?.tier) return '';
  const { emoji, name, division } = rank.tier;
  return `${emoji} ${name}${division ? ` ${division}` : ''}`;
}

function showSelectPage(me) {
  currentUsername         = me.username;
  displayNick.textContent = me.username;
  setAvatar(userAvatar, me.avatar);

  if (me.rank) {
    tierBadge.textContent  = tierLabel(me.rank);
    tierBadge.dataset.tier = me.rank.tier.key;
    tierBadge.hidden       = false;
  } else {
    tierBadge.hidden = true;
  }

  pageAuth.classList.remove('active');
  pageSelect.classList.add('active');
}

// ── 이미지 → canvas → base64 (128×128 리사이즈) ───────────────────────────────
function resizeToBase64(file, size = 128) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width  = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // 중앙 크롭 (정사각형)
      const side   = Math.min(img.width, img.height);
      const sx     = (img.width  - side) / 2;
      const sy     = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}

function checkSaveable() {
  const nicknameChanged = inputNewUsername.value.trim() !== currentUsername;
  btnSaveProfile.disabled = !pendingAvatar && !nicknameChanged;
}

// ── JSON 요청 헬퍼 ────────────────────────────────────────────────────────────
async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body:    body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

// ── 프로필 모달 ───────────────────────────────────────────────────────────────
function openProfileModal() {
  pendingAvatar = null;
  avatarFileInput.value   = '';
  inputNewUsername.value  = currentUsername;
  btnSaveProfile.disabled = true;
  const currentAvatar = userAvatar.querySelector('img')?.src ?? null;
  setAvatar(avatarPreview, currentAvatar);
  profileModal.classList.add('show');
}

function closeProfileModal() {
  profileModal.classList.remove('show');
}

avatarFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showError('이미지 파일만 업로드할 수 있습니다.'); return; }

  try {
    const base64 = await resizeToBase64(file);
    pendingAvatar = base64;
    setAvatar(avatarPreview, base64);
    checkSaveable();
  } catch {
    showError('이미지 처리에 실패했습니다.');
  }
});

inputNewUsername.addEventListener('input', () => {
  if (inputNewUsername.value.includes(' ')) {
    inputNewUsername.value = inputNewUsername.value.replace(/ /g, '');
  }
  checkSaveable();
});

btnSaveProfile.addEventListener('click', async () => {
  const newName = inputNewUsername.value.trim();

  try {
    if (newName !== currentUsername) {
      const data = await api('/api/me/username', { method: 'PUT', body: { username: newName } });
      currentUsername = data.username;
      displayNick.textContent = data.username;
    }

    if (pendingAvatar) {
      const data = await api('/api/me/avatar', { method: 'PUT', body: { avatar: pendingAvatar } });
      setAvatar(userAvatar, data.avatar);
    }
  } catch (e) {
    showError(e.message);
    return;
  }

  socket.emit('refresh_profile');
  closeProfileModal();
});

btnEditProfile.addEventListener('click', openProfileModal);
btnCancelProfile.addEventListener('click', closeProfileModal);
profileModal.addEventListener('click', e => { if (e.target === profileModal) closeProfileModal(); });

// ── 전적 모달 ─────────────────────────────────────────────────────────────────
const OUTCOME_LABEL = { win: '승', lose: '패', draw: '무' };

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

  return `
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
    </table>`;
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
    <p class="stats-subtitle">전체 등급표</p>
    <table class="stats-table ranking-table">
      <thead><tr><th>#</th><th>닉네임</th><th>등급</th><th>점수</th><th>전적</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function openStatsModal() {
  statsModal.classList.add('show');
  statsBody.innerHTML = '<p class="stats-empty">불러오는 중…</p>';
  try {
    const [mine, ranking] = await Promise.all([api('/api/me/stats'), api('/api/ranking')]);
    statsBody.innerHTML =
      renderRankCard(mine.rank) +
      renderStatsTable(mine) +
      renderRecent(mine.recent) +
      renderRanking(ranking, mine.rank?.userId);
  } catch (e) {
    statsBody.innerHTML = `<p class="stats-empty">${escHtml(e.message)}</p>`;
  }
}

btnStats.addEventListener('click', openStatsModal);
btnCloseStats.addEventListener('click', () => statsModal.classList.remove('show'));
statsModal.addEventListener('click', e => { if (e.target === statsModal) statsModal.classList.remove('show'); });

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeProfileModal();
  statsModal.classList.remove('show');
});

// ── 로드 시: 세션 확인 ────────────────────────────────────────────────────────
const me = await fetch('/api/me').then(r => r.ok ? r.json() : null).catch(() => null);
if (me?.username) showSelectPage(me);

// ── 시작하기 (닉네임 = 계정, 비밀번호 없음) ──────────────────────────────────
btnStart.addEventListener('click', async () => {
  const username = inputUsername.value.trim();
  if (!username) { showError('닉네임을 입력해주세요.'); inputUsername.focus(); return; }

  try {
    showSelectPage(await api('/api/auth', { method: 'POST', body: { username } }));
  } catch (e) {
    showError(e.message);
  }
});

// ── 나가기 (다른 닉네임으로 접속) ────────────────────────────────────────────
btnLogout.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
});

inputUsername.addEventListener('input', () => {
  inputUsername.value = inputUsername.value.replace(/ /g, '');
});
inputUsername.addEventListener('keydown', e => { if (e.key === 'Enter') btnStart.click(); });
