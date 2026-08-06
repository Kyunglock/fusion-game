import { showError, escHtml } from './utils.js';
import { io } from '/socket.io/socket.io.esm.min.js';
import { tierLabel } from './shared/myRank.js';
import { openStatsModal } from './shared/statsModal.js';

// ── 방 개수 실시간 표시 ────────────────────────────────────────────────────────
// 방 목록은 서버(채널)별로 갈리므로, 서버가 정해진 뒤에야 소켓을 연다.
// (서버를 고르기 전에 붙으면 어차피 빈 목록만 온다)
const roomCountCroc      = document.getElementById('room-count-croc');
const roomCountBomb      = document.getElementById('room-count-bomb');
const roomCountTetris    = document.getElementById('room-count-tetris');
const roomCountJamo      = document.getElementById('room-count-jamo');
const roomCountWordchain = document.getElementById('room-count-wordchain');
const roomCountLiar      = document.getElementById('room-count-liar');

function updateRoomCount(el, rooms) {
  if (!el) return;
  const count = Array.isArray(rooms) ? rooms.length : 0;
  el.textContent = count > 0 ? `방 ${count}개 대기중` : '';
}

let socket        = null; // 기본 네임스페이스(악어) — 프로필 갱신 알림에도 쓴다
let roomSocketsUp = false;

function startRoomCounts() {
  if (roomSocketsUp) return;
  roomSocketsUp = true;

  socket = io();
  socket.on('connect', () => socket.emit('get_rooms'));
  socket.on('rooms_update', rooms => updateRoomCount(roomCountCroc, rooms));

  const counters = [
    ['/bomb',      'bomb_rooms_update',      roomCountBomb],
    ['/tetris',    'tetris_rooms_update',    roomCountTetris],
    ['/jamo',      'jamo_rooms_update',      roomCountJamo],
    ['/wordchain', 'wordchain_rooms_update', roomCountWordchain],
    ['/liar',      'liar_rooms_update',      roomCountLiar],
  ];
  for (const [ns, event, el] of counters) {
    const sock = io(ns);
    sock.on('connect', () => sock.emit('get_rooms'));
    sock.on(event, rooms => updateRoomCount(el, rooms));
  }
}

const pageServer  = document.getElementById('page-server');
const pageAuth    = document.getElementById('page-auth');
const pageSelect  = document.getElementById('page-select');
const displayNick = document.getElementById('display-nick');
const userAvatar  = document.getElementById('user-avatar');
const tierBadge   = document.getElementById('tier-badge');

const btnStart      = document.getElementById('btn-start');
const btnLogout     = document.getElementById('btn-logout');
const btnStats      = document.getElementById('btn-stats');
const inputUsername = document.getElementById('input-username');

const serverGrid      = document.getElementById('server-grid');
const serverPwCard    = document.getElementById('server-pw-card');
const serverPwName    = document.getElementById('server-pw-name');
const inputServerPw   = document.getElementById('input-server-pw');
const btnServerEnter  = document.getElementById('btn-server-enter');
const btnServerBack   = document.getElementById('btn-server-back');

const profileModal     = document.getElementById('profile-modal');
const avatarPreview    = document.getElementById('avatar-preview');
const avatarFileInput  = document.getElementById('avatar-file-input');
const inputNewUsername = document.getElementById('input-new-username');
const btnEditProfile   = document.getElementById('btn-edit-profile');
const btnSaveProfile   = document.getElementById('btn-save-profile');
const btnCancelProfile = document.getElementById('btn-cancel-profile');

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

function showPage(target) {
  for (const p of [pageServer, pageAuth, pageSelect]) p.classList.toggle('active', p === target);
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

  showPage(pageSelect);
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

  socket?.emit('refresh_profile');
  closeProfileModal();
});

btnEditProfile.addEventListener('click', openProfileModal);
btnCancelProfile.addEventListener('click', closeProfileModal);
profileModal.addEventListener('click', e => { if (e.target === profileModal) closeProfileModal(); });

// ── 전적 모달 (shared/statsModal.js — 게임 방 안에서도 같은 모달을 쓴다) ─────
btnStats.addEventListener('click', openStatsModal);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeProfileModal();
});

// ── 서버(채널) 선택 ───────────────────────────────────────────────────────────
// 물리적으로 나뉜 서버가 아니라 같은 앱 안에서 방 목록·접속자만 갈라둔 관문이다.
// 비밀번호를 맞혀야 세션에 서버가 박히고 그때부터 게임 페이지가 열린다.
let serverList = [];
let pickedId   = null;

function renderServerCards() {
  serverGrid.innerHTML = serverList.map(s => `
    <button class="server-card" data-id="${escHtml(s.id)}">
      <span class="server-icon">${escHtml(s.icon)}</span>
      <span class="server-name">${escHtml(s.name)}</span>
      <span class="server-desc">${escHtml(s.desc)}</span>
      <span class="server-lock">🔒 비밀번호 필요</span>
    </button>
  `).join('');

  serverGrid.querySelectorAll('.server-card').forEach(btn => {
    btn.addEventListener('click', () => pickServer(btn.dataset.id));
  });
}

function pickServer(id) {
  const server = serverList.find(s => s.id === id);
  if (!server) return;
  pickedId = id;
  serverPwName.textContent = `${server.icon} ${server.name}`;
  serverPwCard.hidden      = false;
  serverGrid.hidden        = true;
  inputServerPw.value      = '';
  inputServerPw.focus();
}

function backToServerList() {
  pickedId          = null;
  serverPwCard.hidden = true;
  serverGrid.hidden   = false;
}

/** 서버가 정해진 뒤 — 닉네임이 있으면 게임 목록, 없으면 닉네임 입력 화면 */
async function afterServerEntered(preloadedMe) {
  startRoomCounts();
  const user = preloadedMe !== undefined
    ? preloadedMe
    : await fetch('/api/me').then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (user?.username) showSelectPage(user);
  else                showPage(pageAuth);
}

async function enterServer() {
  if (!pickedId) return;
  const password = inputServerPw.value;
  if (!password) { showError('비밀번호를 입력해주세요.'); inputServerPw.focus(); return; }

  try {
    await api('/api/servers/enter', { method: 'POST', body: { serverId: pickedId, password } });
    await afterServerEntered();
  } catch (e) {
    showError(e.message);
    inputServerPw.select();
  }
}

btnServerEnter.addEventListener('click', enterServer);
btnServerBack .addEventListener('click', backToServerList);
inputServerPw .addEventListener('keydown', e => { if (e.key === 'Enter') enterServer(); });

// ── 로드 시: 서버 · 세션 확인 ─────────────────────────────────────────────────
const [servers, me] = await Promise.all([
  api('/api/servers').catch(() => ({ servers: [], current: null })),
  fetch('/api/me').then(r => (r.ok ? r.json() : null)).catch(() => null),
]);

serverList = servers.servers ?? [];
renderServerCards();

if (servers.current) await afterServerEntered(me);
else                 showPage(pageServer);

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
