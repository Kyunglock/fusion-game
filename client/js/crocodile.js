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
  const AVATAR_ICONS = ['🐊','🦁','🐸','🦊'];

  let turnCountdownInterval = null;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const inputName          = $('player-name');
  const btnCreate          = $('btn-create');
  const roomListEl         = $('room-list');
  const playerListEl       = $('player-list');
  const btnReady           = $('btn-ready');
  const btnStart           = $('btn-start');
  const btnLeaveLobby      = $('btn-leave-lobby');
  const waitingHint        = $('waiting-hint');
  const turnBanner         = $('turn-banner');
  const turnTimerEl        = $('turn-timer');
  const scoreboardEl       = $('player-row');
  const teethGrid          = $('teeth-grid');
  const disconnectedNotice = $('disconnected-notice');
  const disconnectedMsg    = $('disconnected-msg');
  const btnReturnLobby     = $('btn-return-lobby');
  const resultOverlay      = $('result-overlay');
  const resultEmoji        = $('result-emoji');
  const resultTitle        = $('result-title');
  const resultSub          = $('result-sub');

  // ── Socket ───────────────────────────────────────────────────────────────
  const socket = io();

  // ── Init shared modules ──────────────────────────────────────────────────
  initScreenManager(setChatVisible);
  initChat(socket, () => myId, playerAvatarEmojis);

  socket.on('connect', () => {
    myId = socket.id;
    socket.emit('get_rooms');
  });

  checkAuth(inputName).then(data => {
    if (data) myName = data.username;
  });

  // ── Turn countdown ───────────────────────────────────────────────────────
  function startTurnCountdown(deadline, isMyTurn) {
    clearInterval(turnCountdownInterval);
    turnTimerEl.className = 'turn-timer';
    turnCountdownInterval = setInterval(() => {
      const rem = Math.ceil((deadline - Date.now()) / 1000);
      if (rem <= 0) { clearInterval(turnCountdownInterval); turnTimerEl.textContent = ''; return; }
      turnTimerEl.textContent = rem;
      turnTimerEl.className   = `turn-timer${rem <= 5 ? ' urgent' : ''}`;
      if (isMyTurn && rem <= 5) screens.game.classList.add('wiggle-active');
      else screens.game.classList.remove('wiggle-active');
    }, 200);
  }

  function stopTurnCountdown() {
    clearInterval(turnCountdownInterval);
    turnTimerEl.textContent = '';
    turnTimerEl.className   = 'turn-timer';
    screens.game.classList.remove('wiggle-active');
  }

  // ── Render waiting ───────────────────────────────────────────────────────
  function renderWaiting(state) {
    amHost = renderWaitingBase(state, {
      myId, socket, playerListEl, btnReady, btnStart, waitingHint,
      avatarIcons: AVATAR_ICONS, playerAvatarEmojis, nameHtml,
    });
  }

  // ── Render game screen ────────────────────────────────────────────────────
  function renderGame(state) {
    scoreboardEl.innerHTML = '';
    state.players.forEach((p, i) => {
      if (!p.avatar) playerAvatarEmojis.set(p.id, AVATAR_ICONS[i % 4]);
      const isActive = state.players[state.currentTurnIndex]?.id === p.id;
      const isMe = p.id === myId;
      const div = document.createElement('div');
      div.className = `player-card${isActive ? ' active-player' : ''}${isMe ? ' is-me' : ''}`;
      const scAvatar = p.avatar
        ? `<div class="pc-avatar"><img src="${p.avatar}" /></div>`
        : `<div class="pc-avatar pc-avatar-emoji">${AVATAR_ICONS[i % 4]}</div>`;
      div.innerHTML = `
        ${scAvatar}
        <div class="pc-name">${nameHtml(p.name)}</div>
        <div class="pc-you${isMe ? '' : ' invisible'}">나</div>
      `;
      scoreboardEl.appendChild(div);
    });

    const currentPlayer = state.players[state.currentTurnIndex];
    if (currentPlayer) {
      const isMyTurn = currentPlayer.id === myId;
      turnBanner.textContent = isMyTurn ? '내 차례입니다! 이빨을 눌러보세요 👆' : `${nameText(currentPlayer.name)}의 차례...`;
      turnBanner.className = isMyTurn ? 'my-turn' : '';
    }

    if (state.state === 'playing' && state.turnDeadline) {
      startTurnCountdown(state.turnDeadline, state.players[state.currentTurnIndex]?.id === myId);
    } else {
      stopTurnCountdown();
    }

    positionTeethGrid();
    renderTeeth(state);
  }

  function positionTeethGrid() {
    const svg     = $('croc-svg');
    const wrapper = $('croc-wrapper');
    const wRect   = wrapper.getBoundingClientRect();
    const sRect   = svg.getBoundingClientRect();
    const scaleX  = sRect.width  / 250;
    const scaleY  = sRect.height / 250;
    const offsetX = sRect.left - wRect.left;
    const offsetY = sRect.top  - wRect.top;
    teethGrid.style.left   = (15  * scaleX + offsetX) + 'px';
    teethGrid.style.top    = (160 * scaleY + offsetY) + 'px';
    teethGrid.style.width  = (220 * scaleX)           + 'px';
    teethGrid.style.height = (50  * scaleY)           + 'px';
    teethGrid.style.gap    = '3px';
  }

  function renderTeeth(state) {
    teethGrid.innerHTML = '';
    const isMyTurn   = state.players[state.currentTurnIndex]?.id === myId;
    const isPlaying  = state.state === 'playing';
    const upperCount = Math.ceil(state.totalTeeth / 2);

    teethGrid.style.gridTemplateColumns = `repeat(${upperCount}, 1fr)`;
    teethGrid.style.gridTemplateRows    = '1fr 1fr';
    teethGrid.style.alignItems          = 'end';

    for (let i = 0; i < state.totalTeeth; i++) {
      const isUpper = i < upperCount;
      const btn = document.createElement('button');
      btn.className = `tooth-btn ${isUpper ? 'tooth-upper' : 'tooth-lower'}`;
      btn.setAttribute('data-tooth', i);
      btn.setAttribute('aria-label', `${isUpper ? '위' : '아래'} 이빨 ${i + 1}`);

      const wasPressed = state.pressedTeeth.includes(i);
      const isTrap     = state.trapTooth === i;

      if (wasPressed) {
        btn.classList.add('pressed');
        btn.disabled = true;
        if (isTrap) btn.classList.add('trap-reveal');
      } else {
        btn.disabled = !(isPlaying && isMyTurn);
        if (isPlaying && isMyTurn) {
          btn.addEventListener('click', () => socket.emit('press_tooth', { toothIndex: i }));
        }
      }
      teethGrid.appendChild(btn);
    }

    teethGrid.style.alignItems = 'stretch';
    Array.from(teethGrid.children).forEach((btn, i) => {
      btn.style.alignSelf = i < upperCount ? 'end' : 'start';
    });
  }

  // ── Result overlay ────────────────────────────────────────────────────────
  function showResult(biteEvent) {
    const isLoser = biteEvent.loserId === myId;
    resultEmoji.textContent = isLoser ? '😱' : '🎉';
    resultTitle.textContent = isLoser ? '물렸다!!!' : '살았다~!';
    resultTitle.className   = 'result-title ' + (isLoser ? 'lose' : 'win');
    resultSub.textContent   = isLoser
      ? `${biteEvent.trapTooth + 1}번 이빨이 함정이었습니다 😵`
      : `${nameText(biteEvent.loserName)}님이 ${biteEvent.trapTooth + 1}번 함정 이빨을 눌렀습니다!`;
    startReturnCountdown(3);
    resultOverlay.classList.add('show');
  }

  function hideResult() { resultOverlay.classList.remove('show'); }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('rooms_update', (list) => renderRoomList(roomListEl, list, socket, myName, nameHtml));

  socket.on('room_update', (state) => {
    roomState = state;
    if (isSpectator) {
      renderSpectatorList(state.spectators ?? []);
      if (state.state !== 'lobby') renderGame(state);
      return;
    }
    if (state.state === 'lobby') {
      stopTurnCountdown();
      clearReturnCountdown();
      hideResult();
      showScreen('waiting');
      renderWaiting(state);
    } else if (state.state === 'playing') {
      hideResult();
      disconnectedNotice.style.display = 'none';
      showScreen('game');
      renderGame(state);
      renderSpectatorList(state.spectators ?? []);
    } else if (state.state === 'roundEnd') {
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

  socket.on('bite_event', (event) => {
    stopTurnCountdown();
    triggerFlash();
    triggerShake();
    if (roomState) {
      renderGame(roomState);
      setTimeout(() => showResult(event), 700);
    }
  });

  socket.on('player_disconnected', ({ message }) => {
    disconnectedMsg.textContent = message;
    disconnectedNotice.style.display = '';
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
    showAloneOverlay(message, () => { stopTurnCountdown(); hideResult(); });
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

  btnReturnLobby.addEventListener('click', () => {
    disconnectedNotice.style.display = 'none';
    socket.emit('reset_game');
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (roomState && (roomState.state === 'playing' || roomState.state === 'roundEnd')) {
        positionTeethGrid();
      }
    }, 100);
  });
}
