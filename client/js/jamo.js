import { io }               from '/socket.io/socket.io.esm.min.js';
import { showError }        from './utils.js';
import { $, screens, showScreen, initScreenManager } from './shared/screenManager.js';
import { initChat, setChatVisible, showJoinNotice } from './shared/chatManager.js';
import { checkAuth }       from './shared/authCheck.js';
import { renderRoomList, renderSpectatorList, renderWaiting as renderWaitingBase } from './shared/lobbyRenderer.js';
import { nameHtml, nameText, showAloneOverlay } from './shared/uiHelpers.js';

{
  const MAX_ATTEMPTS = 5;

  // 쌍자음(ㄲㄸㅃㅆㅉ)은 별도 키 없이 기본 자음을 두 번 눌러 표현한다 (ㄱㄱ = ㄲ).
  // 배열은 표준 두벌식 키보드 순서.
  const KEY_ROWS = [
    ['ㅂ','ㅈ','ㄷ','ㄱ','ㅅ','ㅛ','ㅕ','ㅑ'],
    ['ㅁ','ㄴ','ㅇ','ㄹ','ㅎ','ㅗ','ㅓ','ㅏ','ㅣ'],
    ['ㅋ','ㅌ','ㅊ','ㅍ','ㅠ','ㅜ','ㅡ'],
  ];

  // ── State ────────────────────────────────────────────────────────────────
  let myId        = null;
  let myName      = '';
  let roomState   = null;
  let gameState   = { players: [], myKeyboard: {} };
  let amHost      = false;
  let isSpectator = false;

  const playerAvatarEmojis = new Map();
  const AVATAR_ICONS = ['🔤', '🔡', '🔠', '📝'];

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const inputName      = $('player-name');
  const btnCreate       = $('btn-create');
  const roomListEl      = $('room-list');
  const playerListEl    = $('player-list');
  const btnReady        = $('btn-ready');
  const btnStart        = $('btn-start');
  const btnLeaveLobby   = $('btn-leave-lobby');
  const waitingHint     = $('waiting-hint');

  const jamoHostSetup       = $('jamo-host-setup');
  const inputKeyboardToggle = $('input-keyboard-toggle');

  const jamoBanner     = $('jamo-banner');
  const jamoScoreboard = $('jamo-scoreboard');
  const jamoHostRound  = $('jamo-host-round');
  const inputAnswer    = $('input-answer');
  const btnSetAnswer   = $('btn-set-answer');
  const jamoWaitNotice = $('jamo-wait-notice');
  const jamoSpectateJoin = $('jamo-spectate-join');
  const jamoReturnLobby = $('jamo-return-lobby');
  const jamoBoards     = $('jamo-boards');
  const jamoMyKeyboard = $('jamo-my-keyboard');
  const jamoGuessRow   = $('jamo-guess-row');
  const inputGuess     = $('input-guess');
  const btnSubmitGuess = $('btn-submit-guess');
  const jamoSpectatorJoin = $('jamo-spectator-join');

  // ── Socket ───────────────────────────────────────────────────────────────
  const socket = io('/jamo');

  initScreenManager(setChatVisible);
  initChat(socket, () => myId, playerAvatarEmojis);

  socket.on('connect', () => {
    myId = socket.id;
    socket.emit('get_rooms');
  });

  checkAuth(inputName).then(data => {
    if (data) myName = data.username;
  });

  // ── Render waiting ───────────────────────────────────────────────────────
  function renderWaiting(state) {
    amHost = renderWaitingBase(state, {
      myId, socket, playerListEl, btnReady, btnStart, waitingHint,
      avatarIcons: AVATAR_ICONS, playerAvatarEmojis, nameHtml,
    });
    jamoHostSetup.style.display = amHost ? '' : 'none';
    if (amHost) inputKeyboardToggle.checked = state.keyboardVisible !== false;

    // 관전자가 대기실을 볼 때: 준비/시작 대신 '참여자로 이동' 버튼을 노출
    if (isSpectator) {
      btnReady.style.display = 'none';
      btnStart.style.display = 'none';
      jamoHostSetup.style.display = 'none';
      jamoSpectatorJoin.style.display = '';
      waitingHint.textContent = '관전 중입니다. 참여하려면 참여자로 이동하세요.';
    } else {
      jamoSpectatorJoin.style.display = 'none';
    }
  }

  // ── Render game board ────────────────────────────────────────────────────
  function attemptsFor(playerId) {
    return gameState.players.find(p => p.id === playerId)?.attempts ?? [];
  }

  function renderAttemptRow(attempt, idx, answerLength) {
    const masked = !attempt.word;
    const row = document.createElement('div');
    row.className = 'jamo-row';

    const label = document.createElement('div');
    label.className = `jamo-word-label${masked ? ' masked' : ''}`;
    label.textContent = masked ? `${idx + 1}회차` : attempt.word;
    row.appendChild(label);

    for (let i = 0; i < answerLength; i++) {
      const cell = document.createElement('div');
      cell.className = `jamo-cell ${attempt.result[i]}${masked ? ' masked' : ''}`;
      cell.textContent = masked ? '' : (attempt.jamo[i] ?? '');
      row.appendChild(cell);
    }
    return row;
  }

  function renderEmptyRow(answerLength) {
    const row = document.createElement('div');
    row.className = 'jamo-row jamo-row-empty';
    row.appendChild(document.createElement('div')).className = 'jamo-word-label';
    for (let i = 0; i < answerLength; i++) {
      row.appendChild(document.createElement('div')).className = 'jamo-cell';
    }
    return row;
  }

  function renderKeyboard(myKeyboard) {
    const wrap = document.createElement('div');
    wrap.className = 'jamo-keyboard';
    const title = document.createElement('div');
    title.className = 'jamo-keyboard-title';
    title.textContent = '내 키보드';
    wrap.appendChild(title);

    KEY_ROWS.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'jamo-key-row';
      row.forEach(k => {
        const key = document.createElement('div');
        key.className = `jamo-key ${myKeyboard[k] || ''}`;
        key.textContent = k;
        rowEl.appendChild(key);
      });
      wrap.appendChild(rowEl);
    });
    return wrap;
  }

  function renderBoards(state) {
    const answerLength  = state.answerLength || 0;
    const iAmHost       = state.players.find(p => p.id === myId)?.isHost ?? false;
    const participants  = state.players.filter(p => !p.isHost);
    const isIntermission = state.state === 'intermission';

    // ── 배너 ──────────────────────────────────────────────────────────────
    if (state.state === 'playing') {
      // 방장·관전자에게만 정답이 내려오므로(gameState.answer), 있으면 노출한다.
      jamoBanner.textContent = gameState.answer
        ? `정답: "${gameState.answer}" · 자모 ${answerLength}칸`
        : `이번 문제는 자모 ${answerLength}칸입니다.`;
    } else if (isIntermission && state.hasResult) {
      jamoBanner.textContent = state.winnerName
        ? `${nameText(state.winnerName)}님 정답! 정답은 "${state.answer}" 입니다.`
        : `아무도 못 맞췄습니다. 정답은 "${state.answer}" 입니다.`;
    } else if (isIntermission) {
      jamoBanner.textContent = iAmHost
        ? '제시어를 입력해 라운드를 시작하세요.'
        : '방장이 제시어를 준비하고 있습니다…';
    } else {
      jamoBanner.textContent = '';
    }

    // ── 스코어보드 (방장 제외, 참가자만 경쟁) ─────────────────────────────
    const bySco = [...participants].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.wins || 0) - (a.wins || 0));
    jamoScoreboard.innerHTML = bySco.map((p, i) => `
      <div class="jamo-score-row">
        <span class="jamo-score-rank">${i + 1}위</span>
        <span class="jamo-score-name">${nameHtml(p.name)}${p.id === myId ? ' (나)' : ''}</span>
        <span class="jamo-score-value">${p.score || 0}점 · ${p.wins || 0}승</span>
      </div>
    `).join('');

    // ── 방장 제시어 출제 / 참가자 대기 안내 ───────────────────────────────
    const showHostRound = !isSpectator && iAmHost && isIntermission;
    jamoHostRound.style.display = showHostRound ? 'flex' : 'none';
    if (showHostRound) { inputAnswer.value = ''; inputAnswer.focus(); }

    // 방장 '대기실로 나가기' — 게임 중(대기 상태 포함) 상시 노출
    jamoReturnLobby.style.display = (!isSpectator && iAmHost) ? '' : 'none';

    // 관전자 '참여자로 이동' — 방장이 제시어를 내기 전(intermission)에만 노출
    jamoSpectateJoin.style.display = (isSpectator && isIntermission) ? '' : 'none';

    const showWaitNotice = isIntermission && !iAmHost;
    jamoWaitNotice.style.display = showWaitNotice ? '' : 'none';
    if (showWaitNotice) {
      jamoWaitNotice.textContent = state.hasResult
        ? '방장이 다음 제시어를 준비하고 있습니다…'
        : '방장이 제시어를 준비하고 있습니다…';
    }

    // ── 참가자별 보드 (방장은 보드 없음) ──────────────────────────────────
    jamoBoards.innerHTML = '';
    const ordered = [...participants].sort((a, b) => (a.id === myId ? 0 : 1) - (b.id === myId ? 0 : 1));

    ordered.forEach((p, i) => {
      if (!p.avatar) playerAvatarEmojis.set(p.id, AVATAR_ICONS[i % AVATAR_ICONS.length]);
      const isMe     = p.id === myId;
      const attempts = attemptsFor(p.id);

      const card = document.createElement('div');
      card.className = `jamo-board-card${isMe ? ' is-me' : ''}`;

      const avatarHtml = p.avatar
        ? `<div class="jamo-avatar" style="overflow:hidden;"><img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;" /></div>`
        : `<div class="jamo-avatar av-${i % 4}">${AVATAR_ICONS[i % AVATAR_ICONS.length]}</div>`;

      const header = document.createElement('div');
      header.className = 'jamo-board-header';
      header.innerHTML = `
        ${avatarHtml}
        <span class="jamo-board-name">${nameHtml(p.name)}</span>
        ${isMe     ? '<span class="badge-you">나</span>' : ''}
        ${p.solved ? '<span class="jamo-solved">✅ 정답</span>' : ''}
        <span class="jamo-attempt-count">${p.attemptCount || 0}/${MAX_ATTEMPTS}회</span>
      `;
      card.appendChild(header);

      attempts.forEach((a, idx) => card.appendChild(renderAttemptRow(a, idx, answerLength)));
      for (let r = attempts.length; r < MAX_ATTEMPTS; r++) card.appendChild(renderEmptyRow(answerLength));

      jamoBoards.appendChild(card);
    });

    // ── 내 키보드 (보드 카드 밖에 별도로 렌더 → 카드 크기 통일) ────────────
    const showKeyboard = !isSpectator && !iAmHost && state.keyboardVisible && participants.some(p => p.id === myId);
    jamoMyKeyboard.style.display = showKeyboard ? 'flex' : 'none';
    jamoMyKeyboard.innerHTML = '';
    if (showKeyboard) jamoMyKeyboard.appendChild(renderKeyboard(gameState.myKeyboard || {}));

    const me = participants.find(p => p.id === myId);
    const canGuess = !isSpectator && !iAmHost && state.state === 'playing' && me && !me.solved && (me.attemptCount || 0) < MAX_ATTEMPTS;
    jamoGuessRow.style.display = (!isSpectator && !iAmHost && state.state === 'playing') ? 'flex' : 'none';
    inputGuess.disabled     = !canGuess;
    btnSubmitGuess.disabled = !canGuess;
  }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('jamo_rooms_update', (list) => renderRoomList(roomListEl, list, socket, myName, nameHtml));

  socket.on('room_update', (state) => {
    roomState = state;

    // 관전자였다가 참여자로 승격되면 관전 모드 해제
    if (isSpectator && state.players?.some(p => p.id === myId)) {
      isSpectator = false;
      screens.game.classList.remove('is-spectating');
      $('spectator-banner').style.display = 'none';
    }

    if (isSpectator) {
      if (state.state === 'lobby') {
        // 게임이 끝나 대기실로 돌아옴 → 관전자도 대기실을 보고 참여할 수 있게
        showScreen('waiting');
        renderWaiting(state);
      } else {
        renderSpectatorList(state.spectators ?? []);
        renderBoards(state);
        showScreen('game');
      }
      return;
    }

    if (state.state === 'lobby') {
      showScreen('waiting');
      renderWaiting(state);
    } else {
      // intermission(라운드 대기) / playing(라운드 진행) 모두 게임 화면 유지
      showScreen('game');
      renderBoards(state);
      renderSpectatorList(state.spectators ?? []);
    }
  });

  socket.on('jamo_state', (data) => {
    gameState = data;
    if (roomState && roomState.state !== 'lobby') renderBoards(roomState);
  });

  socket.on('spectate_start', (state) => {
    isSpectator = true;
    roomState   = state;
    screens.game.classList.add('is-spectating');
    $('spectator-banner').style.display = '';
    showScreen('game');
    renderBoards(state);
    renderSpectatorList(state.spectators ?? []);
  });

  socket.on('member_joined', ({ name, isSpectator: isSpec }) => showJoinNotice(name, isSpec));

  socket.on('error_msg', ({ message }) => showError(message));

  socket.on('kicked', ({ message }) => {
    showError(message);
    socket.disconnect();
    socket.connect();
    roomState = null;
    isSpectator = false;
    screens.game.classList.remove('is-spectating');
    showScreen('lobby');
  });

  socket.on('alone_in_room', ({ message }) => {
    showAloneOverlay(message);
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

  function setAnswer() {
    const val = inputAnswer.value.trim();
    if (!val) { showError('제시어를 입력해주세요.'); inputAnswer.focus(); return; }
    socket.emit('set_answer', { answer: val });
    inputAnswer.value = '';
  }

  btnSetAnswer.addEventListener('click', setAnswer);
  inputAnswer.addEventListener('keydown', e => { if (e.key === 'Enter') setAnswer(); });

  jamoReturnLobby.addEventListener('click', () => socket.emit('return_to_lobby'));
  jamoSpectatorJoin.addEventListener('click', () => socket.emit('spectator_to_player'));
  jamoSpectateJoin.addEventListener('click', () => socket.emit('spectator_to_player'));

  inputKeyboardToggle.addEventListener('change', () => {
    socket.emit('toggle_keyboard_visible', { visible: inputKeyboardToggle.checked });
  });

  $('btn-toggle-spectator').addEventListener('click', () => socket.emit('toggle_spectator_allowed'));

  btnLeaveLobby.addEventListener('click', () => {
    isSpectator = false;
    screens.game.classList.remove('is-spectating');
    socket.disconnect();
    socket.connect();
    showScreen('lobby');
    roomState   = null;
    gameState   = { players: [], myKeyboard: {} };
  });

  function submitGuess() {
    const val = inputGuess.value.trim();
    if (!val || btnSubmitGuess.disabled) return;
    socket.emit('submit_guess', { guess: val });
    inputGuess.value = '';
  }

  btnSubmitGuess.addEventListener('click', submitGuess);
  inputGuess.addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });
}
