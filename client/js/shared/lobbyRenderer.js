import { escHtml } from '../utils.js';
import { $ } from './screenManager.js';

/**
 * 로비 방 목록 렌더링
 */
export function renderRoomList(roomListEl, roomList, socket, myName, nameHtml) {
  roomListEl.innerHTML = '';

  if (!roomList.length) {
    roomListEl.innerHTML = '<p class="no-rooms-hint">현재 생성된 방이 없습니다</p>';
    return;
  }

  roomList.forEach(r => {
    const item = document.createElement('div');
    item.className = 'room-item';
    const playingBadge  = r.isPlaying ? '<span class="room-badge-playing">게임 중</span>' : '';
    const spectateCount = r.isPlaying && r.spectatorCount > 0 ? ` · 관전 ${r.spectatorCount}명` : '';
    const joinBtn = r.isPlaying
      ? `<button class="btn btn-secondary room-spectate-btn">관전</button>`
      : `<button class="btn btn-secondary room-join-btn">입장</button>`;
    item.innerHTML = `
      <div class="room-item-info">
        <span class="room-host-label">방장</span>
        <div class="room-item-main">
          ${playingBadge}
          <span class="room-host-name">${nameHtml(r.hostName)}</span>
          <span class="room-count">${r.playerCount}/${r.maxPlayers}명${spectateCount}</span>
          ${joinBtn}
        </div>
      </div>
    `;
    if (r.isPlaying) {
      item.querySelector('.room-spectate-btn').addEventListener('click', () => {
        socket.emit('join_as_spectator', { roomCode: r.code, playerName: myName });
      });
    } else {
      item.querySelector('.room-join-btn').addEventListener('click', () => {
        socket.emit('join_room', { roomCode: r.code, playerName: myName });
      });
    }
    roomListEl.appendChild(item);
  });
}

/**
 * 관전자 목록 렌더링
 */
export function renderSpectatorList(spectators) {
  const section  = $('spectator-section');
  const listEl   = $('spectator-list-waiting');
  const gameList = $('spectator-list-game');
  const namesEl  = $('spectator-names-game');

  if (!spectators || spectators.length === 0) {
    if (section) section.style.display = 'none';
    if (gameList) gameList.style.display = 'none';
    return;
  }

  if (section) {
    section.style.display = '';
    listEl.innerHTML = '';
    spectators.forEach(s => {
      const li = document.createElement('li');
      li.className = 'spectator-chip';
      li.textContent = s.name;
      listEl.appendChild(li);
    });
  }

  if (gameList) {
    gameList.style.display = '';
    namesEl.innerHTML = spectators.map(s => `<span class="spectator-chip">${escHtml(s.name)}</span>`).join('');
  }
}

/**
 * 대기실 렌더링 (공통 부분)
 */
export function renderWaiting(state, { myId, socket, playerListEl, btnReady, btnStart, waitingHint, avatarIcons, playerAvatarEmojis, nameHtml, minPlayers = 2 }) {
  const iAmHost = state.players.find(p => p.id === myId)?.isHost ?? false;
  playerListEl.innerHTML = '';

  state.players.forEach((p, i) => {
    if (!p.avatar) playerAvatarEmojis.set(p.id, avatarIcons[i % avatarIcons.length]);
    const li = document.createElement('li');
    const isMe = p.id === myId;
    const avatarHtml = p.avatar
      ? `<div class="avatar av-${i % 4}" style="overflow:hidden;"><img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;" /></div>`
      : `<div class="avatar av-${i % 4}">${avatarIcons[i % avatarIcons.length]}</div>`;
    li.innerHTML = `
      ${avatarHtml}
      <span>${nameHtml(p.name)}</span>
      ${isMe       ? '<span class="badge-you">나</span>' : ''}
      ${p.isHost   ? '<span class="badge-host">방장</span>' : ''}
      ${!p.isHost  ? `<span class="badge-ready ${p.ready ? 'is-ready' : ''}">${p.ready ? '준비 완료' : '준비 중'}</span>` : ''}
      ${iAmHost && !p.isHost ? `<button class="btn btn-danger btn-sm kick-btn" data-id="${p.id}">강퇴</button>` : ''}
    `;
    playerListEl.appendChild(li);
  });

  playerListEl.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('kick_player', { targetId: btn.dataset.id }));
  });

  renderSpectatorList(state.spectators ?? []);

  // 관전 허용 토글
  const toggleWrap = $('spectator-toggle-wrap');
  const toggleBtn  = $('btn-toggle-spectator');
  if (toggleWrap && toggleBtn) {
    if (iAmHost) {
      toggleWrap.style.display = '';
      const enabled = state.allowSpectators !== false;
      toggleBtn.textContent = enabled ? 'ON' : 'OFF';
      toggleBtn.dataset.enabled = enabled ? 'true' : 'false';
      toggleBtn.className = `spectator-toggle-btn${enabled ? ' enabled' : ''}`;
    } else {
      toggleWrap.style.display = 'none';
    }
  }

  const me       = state.players.find(p => p.id === myId);
  const nonHosts = state.players.filter(p => !p.isHost);
  const allReady = nonHosts.length > 0 && nonHosts.every(p => p.ready);
  const effectiveMin = state.minPlayers ?? minPlayers;

  if (!iAmHost) {
    btnReady.style.display = '';
    btnReady.textContent   = me?.ready ? '준비 취소' : '준비 완료';
    btnReady.className     = me?.ready ? 'btn btn-ready active' : 'btn btn-ready';
  } else {
    btnReady.style.display = 'none';
  }

  btnStart.style.display = (iAmHost && state.players.length >= effectiveMin && allReady) ? '' : 'none';

  if (iAmHost) {
    waitingHint.textContent = state.players.length < effectiveMin
      ? `게임을 시작하려면 최소 ${effectiveMin}명이 필요합니다.`
      : allReady ? '모두 준비됐습니다! 게임을 시작하세요.' : '플레이어들이 준비 중입니다...';
  } else {
    waitingHint.textContent = allReady
      ? '모두 준비됐습니다! 방장이 게임을 시작할 때까지 기다려 주세요.'
      : '준비 완료를 눌러주세요.';
  }

  return iAmHost;
}
