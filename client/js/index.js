import { showError }              from './utils.js';
import { io } from '/socket.io/socket.io.esm.min.js';

// ── 방 개수 실시간 표시 ────────────────────────────────────────────────────────
const roomCountCroc   = document.getElementById('room-count-croc');
const roomCountBomb   = document.getElementById('room-count-bomb');
const roomCountTetris = document.getElementById('room-count-tetris');
const roomCountJamo   = document.getElementById('room-count-jamo');

function updateRoomCount(el, rooms) {
  if (!el) return;
  const count = Array.isArray(rooms) ? rooms.length : 0;
  el.textContent = count > 0 ? `방 ${count}개 대기중` : '';
}

const sockBomb   = io('/bomb');
const sockTetris = io('/tetris');
const sockJamo   = io('/jamo');

sockBomb  .on('connect', () => sockBomb  .emit('get_rooms'));
sockTetris.on('connect', () => sockTetris.emit('get_rooms'));
sockJamo  .on('connect', () => sockJamo  .emit('get_rooms'));

sockBomb  .on('bomb_rooms_update',   rooms => updateRoomCount(roomCountBomb,   rooms));
sockTetris.on('tetris_rooms_update', rooms => updateRoomCount(roomCountTetris, rooms));
sockJamo  .on('jamo_rooms_update',   rooms => updateRoomCount(roomCountJamo,   rooms));

const pageAuth    = document.getElementById('page-auth');
const pageSelect  = document.getElementById('page-select');
const displayNick = document.getElementById('display-nick');
const userAvatar  = document.getElementById('user-avatar');

const btnStart      = document.getElementById('btn-start');
const inputUsername = document.getElementById('input-username');

const profileModal     = document.getElementById('profile-modal');
const avatarPreview    = document.getElementById('avatar-preview');
const avatarFileInput  = document.getElementById('avatar-file-input');
const inputNewUsername = document.getElementById('input-new-username');
const btnEditProfile   = document.getElementById('btn-edit-profile');
const btnSaveProfile   = document.getElementById('btn-save-profile');
const btnCancelProfile = document.getElementById('btn-cancel-profile');

const socket = io();
socket.on('connect', () => socket.emit('get_rooms'));
socket.on('rooms_update', rooms => updateRoomCount(roomCountCroc, rooms));

let pendingAvatar  = null;
let currentUsername = '';

// ── 아바타 표시 ───────────────────────────────────────────────────────────────
function setAvatar(el, avatar) {
  if (avatar) {
    el.innerHTML = `<img src="${avatar}" alt="avatar" style="width:100%;height:100%;object-fit:cover;" />`;
  } else {
    el.textContent = '😊';
  }
}

function showSelectPage(username, avatar = null) {
  currentUsername         = username;
  displayNick.textContent = username;
  setAvatar(userAvatar, avatar);
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

// ── 모달 ─────────────────────────────────────────────────────────────────────
function openProfileModal() {
  pendingAvatar = null;
  avatarFileInput.value      = '';
  inputNewUsername.value     = currentUsername;
  btnSaveProfile.disabled    = true;
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

  if (newName !== currentUsername) {
    const res  = await fetch('/api/me/username', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newName }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error); return; }
    currentUsername = data.username;
    displayNick.textContent = data.username;
  }

  if (pendingAvatar) {
    const res  = await fetch('/api/me/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: pendingAvatar }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error); return; }
    setAvatar(userAvatar, data.avatar);
  }

  socket.emit('refresh_profile');
  closeProfileModal();
});

btnEditProfile.addEventListener('click', openProfileModal);
btnCancelProfile.addEventListener('click', closeProfileModal);
profileModal.addEventListener('click', e => { if (e.target === profileModal) closeProfileModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfileModal(); });

// ── 로드 시: 세션 확인 ────────────────────────────────────────────────────────
const me = await fetch('/api/me').then(r => r.ok ? r.json() : null).catch(() => null);
if (me?.username) {
  showSelectPage(me.username, me.avatar);
}

// ── 시작하기 ─────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  const username = inputUsername.value.trim();

  if (!username) { showError('닉네임을 입력해주세요.'); inputUsername.focus(); return; }

  const res  = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  if (!res.ok) { showError(data.error); return; }
  showSelectPage(data.username, data.avatar);
});

inputUsername.addEventListener('input', () => {
  inputUsername.value = inputUsername.value.replace(/ /g, '');
});
inputUsername.addEventListener('keydown', e => { if (e.key === 'Enter') btnStart.click(); });

