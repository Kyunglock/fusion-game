import { io }                 from '/socket.io/socket.io.esm.min.js';
import { escHtml, showError } from './utils.js';
import { $, screens, showScreen, initScreenManager } from './shared/screenManager.js';
import { initChat, setChatVisible, showJoinNotice } from './shared/chatManager.js';
import { checkAuth }          from './shared/authCheck.js';
import { renderRoomList, renderSpectatorList, renderWaiting as renderWaitingBase } from './shared/lobbyRenderer.js';
import { nameHtml, nameText, triggerFlash, triggerShake, startReturnCountdown, clearReturnCountdown, showAloneOverlay } from './shared/uiHelpers.js';

{
  // ── State ────────────────────────────────────────────────────────────────
  let myId        = null;
  let myName      = '';
  let roomState   = null;
  let amHost      = false;
  let isSpectator = false;
  let lastChainLength = 0;

  const TURN_TIME = 15; // 서버 WORDCHAIN_TURN_TIMEOUT과 동일하게 유지
  const RETURN_DELAY = 6;

  const playerAvatarEmojis = new Map();
  const AVATAR_ICONS = ['🔗', '🗣️', '💬', '📣'];

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const inputName      = $('player-name');
  const btnCreate      = $('btn-create');
  const roomListEl     = $('room-list');
  const playerListEl   = $('player-list');
  const btnReady       = $('btn-ready');
  const btnStart       = $('btn-start');
  const btnLeaveLobby  = $('btn-leave-lobby');
  const waitingHint    = $('waiting-hint');
  const turnBanner     = $('turn-banner');
  const playerRow      = $('player-row');
  const chainPanel     = $('chain-panel');
  const chainList      = $('chain-list');
  const chainEmpty     = $('chain-empty');
  const requiredChar   = $('required-char');
  const timerBar       = $('timer-bar');
  const timerNum       = $('timer-num');
  const wordForm       = $('word-form');
  const wordInput      = $('word-input');
  const btnSubmit      = $('btn-submit');
  const resultOverlay  = $('result-overlay');
  const resultEmoji    = $('result-emoji');
  const resultTitle    = $('result-title');
  const resultSub      = $('result-sub');

  // ── Socket ───────────────────────────────────────────────────────────────
  const socket = io('/wordchain');

  initScreenManager(setChatVisible);
  initChat(socket, () => myId, playerAvatarEmojis);

  socket.on('connect', () => {
    myId = socket.id;
    socket.emit('get_rooms');
  });

  checkAuth(inputName).then(data => {
    if (data) myName = data.username;
  });

  // ── Turn timer (클라이언트 표시용) ────────────────────────────────────────
  let timerInterval = null;

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerBar.style.width = '0%';
    timerBar.classList.remove('urgent');
    timerNum.textContent = '-';
  }

  function startTimer(deadline) {
    clearInterval(timerInterval);
    const tick = () => {
      const rem = Math.max(0, deadline - Date.now());
      timerNum.textContent = Math.ceil(rem / 1000);
      timerBar.style.width = `${Math.min(100, (rem / (TURN_TIME * 1000)) * 100)}%`;
      timerBar.classList.toggle('urgent', rem <= 5000);
      if (rem <= 0) clearInterval(timerInterval);
    };
    tick();
    timerInterval = setInterval(tick, 100);
  }

  // ── Render waiting ───────────────────────────────────────────────────────
  function renderWaiting(state) {
    amHost = renderWaitingBase(state, {
      myId, socket, playerListEl, btnReady, btnStart, waitingHint,
      avatarIcons: AVATAR_ICONS, playerAvatarEmojis, nameHtml,
    });
  }

  // ── Render game ──────────────────────────────────────────────────────────
  function renderGame(state) {
    const me       = state.players.find(p => p.id === myId);
    const current  = state.players.find(p => p.id === state.currentTurn);
    const myTurn   = state.state === 'playing' && state.currentTurn === myId && !isSpectator;
    const starts   = state.allowedStarts ?? [];

    // 배너
    if (state.state === 'playing') {
      if (myTurn) {
        turnBanner.innerHTML = starts.length
          ? `내 차례! <strong>'${starts.map(escHtml).join("' / '")}'</strong>(으)로 시작하는 단어를 입력하세요!`
          : '내 차례! 첫 단어를 자유롭게 입력하세요!';
        turnBanner.className = 'my-turn';
      } else {
        turnBanner.textContent = current ? `${nameText(current.name)}님이 단어를 생각 중입니다...` : '...';
        turnBanner.className   = '';
      }
    } else if (state.state === 'roundEnd') {
      turnBanner.textContent = state.winner ? `🏆 ${nameText(state.winner.name)}님 우승!` : '라운드 종료!';
      turnBanner.className   = 'round-end';
    }

    // 플레이어 카드
    playerRow.innerHTML = '';
    state.players.forEach((p, i) => {
      if (!p.avatar) playerAvatarEmojis.set(p.id, AVATAR_ICONS[i % 4]);
      const isTurn = p.id === state.currentTurn && state.state === 'playing';
      const isMe   = p.id === myId;
      const avatarHtml = p.avatar
        ? `<div class="pc-avatar" style="overflow:hidden;"><img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;" /></div>`
        : `<div class="pc-avatar pc-avatar-emoji av-${i % 4}">${AVATAR_ICONS[i % 4]}</div>`;
      const card = document.createElement('div');
      card.className = `player-card${isTurn ? ' has-turn active-player' : ''}${isMe ? ' is-me' : ''}${p.alive ? '' : ' is-out'}`;
      card.innerHTML = `
        ${avatarHtml}
        <div class="pc-name">${nameHtml(p.name)}</div>
        <div class="pc-you${isMe ? '' : ' invisible'}">나</div>
        ${p.wins > 0 ? `<div class="pc-wins">🏆 ${p.wins}</div>` : ''}
        ${p.alive ? '' : '<div class="pc-out-badge">탈락</div>'}
      `;
      playerRow.appendChild(card);
    });

    // 단어 체인
    const chain = state.chain ?? [];
    chainEmpty.style.display = chain.length ? 'none' : '';
    const grew = chain.length > lastChainLength;
    lastChainLength = chain.length;
    chainList.innerHTML = chain.map((c, i) => {
      const latest = i === chain.length - 1;
      const word   = latest
        ? `${escHtml(c.word.slice(0, -1))}<em>${escHtml(c.word.slice(-1))}</em>`
        : escHtml(c.word);
      return `
        <div class="chain-chip${latest ? ' latest' : ''}${latest && grew ? ' pop' : ''}${c.playerId === myId ? ' mine' : ''}">
          <span class="chip-word">${word}</span>
          <span class="chip-by">${nameHtml(c.playerName)}</span>
        </div>`;
    }).join('');
    chainPanel.scrollTop = chainPanel.scrollHeight;

    // 시작 글자 / 입력창
    requiredChar.textContent = starts.length ? starts.join(' · ') : '자유';
    const canType = myTurn && !!me?.alive;
    wordInput.disabled = !canType;
    btnSubmit.disabled = !canType;
    if (canType) wordInput.focus();

    // 타이머
    if (state.state === 'playing' && state.turnDeadline) startTimer(state.turnDeadline);
    else stopTimer();
  }

  // ── Result overlay ────────────────────────────────────────────────────────
  function showResult(event) {
    const iWon = event.winnerId === myId;
    resultEmoji.textContent = iWon ? '🏆' : (isSpectator ? '👀' : '😵');
    resultTitle.textContent = iWon ? '우승!!!' : (event.winnerName ? `${nameText(event.winnerName)}님 우승!` : '무승부!');
    resultTitle.className   = 'result-title ' + (iWon ? 'win' : 'lose');
    resultSub.textContent   = `총 ${event.chainLength}개의 단어가 이어졌습니다`;
    startReturnCountdown(RETURN_DELAY);
    resultOverlay.classList.add('show');
  }

  function hideResult() { resultOverlay.classList.remove('show'); }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('wordchain_rooms_update', (list) => renderRoomList(roomListEl, list, socket, myName, nameHtml));

  socket.on('room_update', (state) => {
    roomState = state;
    if (isSpectator) {
      renderSpectatorList(state.spectators ?? []);
      if (state.state !== 'lobby') renderGame(state);
      return;
    }
    if (state.state === 'lobby') {
      stopTimer();
      clearReturnCountdown();
      hideResult();
      lastChainLength = 0;
      showScreen('waiting');
      renderWaiting(state);
    } else {
      hideResult();
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

  socket.on('wordchain_word', ({ playerId }) => {
    if (playerId === myId) wordInput.value = '';
  });

  socket.on('wordchain_out', ({ playerId, playerName }) => {
    if (playerId === myId) {
      triggerFlash();
      triggerShake();
      showError('⏰ 시간 초과! 탈락했습니다.');
    } else {
      showError(`⏰ ${nameText(playerName)}님 탈락!`);
    }
  });

  socket.on('wordchain_result', (event) => {
    stopTimer();
    setTimeout(() => showResult(event), 600);
  });

  socket.on('error_msg', ({ message }) => {
    showError(message);
    if (roomState?.state === 'playing' && roomState.currentTurn === myId) {
      wordInput.classList.remove('shake');
      void wordInput.offsetWidth;
      wordInput.classList.add('shake');
      wordInput.focus();
      wordInput.select();
    }
  });

  socket.on('kicked', ({ message }) => {
    showError(message);
    socket.disconnect();
    socket.connect();
    roomState = null;
    showScreen('lobby');
  });

  socket.on('alone_in_room', ({ message }) => {
    showAloneOverlay(message, () => { stopTimer(); hideResult(); });
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

  wordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (wordInput.disabled) return;
    const word = wordInput.value.trim();
    if (!word) return;
    socket.emit('submit_word', { word });
  });
}
