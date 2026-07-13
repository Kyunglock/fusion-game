import { io }               from '/socket.io/socket.io.esm.min.js';
import { escHtml, showError } from './utils.js';
import { $, screens, showScreen, initScreenManager } from './shared/screenManager.js';
import { initChat, setChatVisible, showJoinNotice } from './shared/chatManager.js';
import { checkAuth }       from './shared/authCheck.js';
import { renderRoomList, renderSpectatorList, renderWaiting as renderWaitingBase } from './shared/lobbyRenderer.js';
import { nameHtml, nameText, triggerFlash, triggerShake, startReturnCountdown, clearReturnCountdown, showAloneOverlay } from './shared/uiHelpers.js';

{
  // ── State ────────────────────────────────────────────────────────────────
  let myId        = null;
  let myName      = '';
  let roomState   = null;
  let amHost      = false;
  let isSpectator = false;

  const playerAvatarEmojis = new Map();
  const AVATAR_ICONS = ['🐊', '🦁', '🐸', '🦊'];

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const inputName      = $('player-name');
  const btnCreate      = $('btn-create');
  const roomListEl     = $('room-list');
  const playerListEl   = $('player-list');
  const btnReady       = $('btn-ready');
  const btnStart       = $('btn-start');
  const btnLeaveLobby  = $('btn-leave-lobby');
  const waitingHint    = $('waiting-hint');
  const holderBanner   = $('holder-banner');
  const playerRow      = $('player-row');
  const bombEmoji      = $('bomb-emoji');
  const btnPass        = $('btn-pass');
  const resultOverlay  = $('result-overlay');
  const resultEmoji    = $('result-emoji');
  const resultTitle    = $('result-title');
  const resultSub      = $('result-sub');

  // ── Socket ───────────────────────────────────────────────────────────────
  const socket = io('/bomb');

  initScreenManager(setChatVisible);
  initChat(socket, () => myId, playerAvatarEmojis);

  socket.on('connect', () => {
    myId = socket.id;
    socket.emit('get_rooms');
  });

  checkAuth(inputName).then(data => {
    if (data) myName = data.username;
  });

  // ── Bomb danger ──────────────────────────────────────────────────────────
  function stopDangerInterval() { bombEmoji.classList.remove('urgent'); }

  socket.on('bomb_warning', () => { bombEmoji.classList.add('urgent'); });

  // ── Render waiting ───────────────────────────────────────────────────────
  function renderWaiting(state) {
    amHost = renderWaitingBase(state, {
      myId, socket, playerListEl, btnReady, btnStart, waitingHint,
      avatarIcons: AVATAR_ICONS, playerAvatarEmojis, nameHtml,
    });
  }

  // ── Render game ──────────────────────────────────────────────────────────
  function renderGame(state) {
    const iHaveBomb = state.bombHolder === myId;

    if (iHaveBomb) {
      holderBanner.textContent = '내가 폭탄을 들고 있다! 얼른 패스해!';
      holderBanner.className   = 'my-bomb';
    } else {
      const holder = state.players.find(p => p.id === state.bombHolder);
      holderBanner.textContent = holder ? `${nameText(holder.name)}이(가) 폭탄을 들고 있습니다!` : '...';
      holderBanner.className = '';
    }

    playerRow.innerHTML = '';
    state.players.forEach((p, i) => {
      if (!p.avatar) playerAvatarEmojis.set(p.id, AVATAR_ICONS[i % 4]);
      const hasBomb = p.id === state.bombHolder;
      const isMe    = p.id === myId;
      const avatarHtml = p.avatar
        ? `<div class="pc-avatar" style="overflow:hidden;"><img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;" /></div>`
        : `<div class="pc-avatar pc-avatar-emoji av-${i % 4}">${AVATAR_ICONS[i % 4]}</div>`;
      const card = document.createElement('div');
      card.className = `player-card${hasBomb ? ' has-bomb active-player' : ''}${isMe ? ' is-me' : ''}`;
      card.innerHTML = `
        ${avatarHtml}
        <div class="pc-name">${nameHtml(p.name)}</div>
        <div class="pc-you${isMe ? '' : ' invisible'}">나</div>
      `;
      playerRow.appendChild(card);
    });

    btnPass.classList.toggle('visible', iHaveBomb && state.state === 'playing');
  }

  // ── Result overlay ────────────────────────────────────────────────────────
  function showResult(event) {
    const isLoser = event.loserId === myId;
    resultEmoji.textContent = isLoser ? '💥' : '😮‍💨';
    resultTitle.textContent = isLoser ? '폭발!!!' : '살았다~!';
    resultTitle.className   = 'result-title ' + (isLoser ? 'lose' : 'win');
    resultSub.textContent   = isLoser
      ? '폭탄이 내 손에서 터졌습니다 😵'
      : `${nameText(event.loserName)}님의 손에서 폭탄이 터졌습니다!`;
    startReturnCountdown(4);
    resultOverlay.classList.add('show');
  }

  function hideResult() { resultOverlay.classList.remove('show'); }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('bomb_rooms_update', (list) => renderRoomList(roomListEl, list, socket, myName, nameHtml));

  socket.on('room_update', (state) => {
    roomState = state;
    if (isSpectator) {
      renderSpectatorList(state.spectators ?? []);
      if (state.state !== 'lobby') renderGame(state);
      return;
    }
    if (state.state === 'lobby') {
      stopDangerInterval();
      clearReturnCountdown();
      hideResult();
      showScreen('waiting');
      renderWaiting(state);
    } else if (state.state === 'playing') {
      hideResult();
      showScreen('game');
      renderGame(state);
      renderSpectatorList(state.spectators ?? []);
    } else if (state.state === 'roundEnd') {
      stopDangerInterval();
      showScreen('game');
      renderGame(state);
      renderSpectatorList(state.spectators ?? []);
    }
  });

  socket.on('spectate_start', (state) => {
    isSpectator = true;
    roomState   = state;
    screens.game.classList.add('is-spectating');
    $('spectator-banner').style.display = '';
    showScreen('game');
    renderGame(state);
    renderSpectatorList(state.spectators ?? []);
  });

  socket.on('member_joined', ({ name, isSpectator: isSpec }) => showJoinNotice(name, isSpec));

  socket.on('bomb_explode', (event) => {
    stopDangerInterval();
    triggerFlash();
    triggerShake();
    setTimeout(() => showResult(event), 700);
  });

  socket.on('error_msg', ({ message }) => showError(message));

  socket.on('kicked', ({ message }) => {
    showError(message);
    socket.disconnect();
    socket.connect();
    roomState = null;
    showScreen('lobby');
  });

  socket.on('alone_in_room', ({ message }) => {
    showAloneOverlay(message, () => { stopDangerInterval(); hideResult(); });
  });

  // ── UI event listeners ────────────────────────────────────────────────────
  btnCreate.addEventListener('click', () => {
    const name = inputName.value.trim();
    if (!name) { showError('닉네임을 입력해주세요.'); inputName.focus(); return; }
    myName = name;
    socket.emit('create_room', { playerName: name });
  });

  btnReady.addEventListener('click', () => socket.emit('toggle_ready'));
  btnStart.addEventListener('click', () => socket.emit('start_game'));

  $('btn-toggle-spectator').addEventListener('click', () => socket.emit('toggle_spectator_allowed'));

  btnLeaveLobby.addEventListener('click', () => {
    isSpectator = false;
    screens.game.classList.remove('is-spectating');
    socket.disconnect();
    socket.connect();
    showScreen('lobby');
    roomState = null;
  });

  function passBomb() {
    if (btnPass.classList.contains('visible')) socket.emit('pass_bomb');
  }

  btnPass.addEventListener('click', passBomb);

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      passBomb();
    }
  });
}
