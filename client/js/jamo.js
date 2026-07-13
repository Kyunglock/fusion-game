import { io }               from '/socket.io/socket.io.esm.min.js';
import { showError }        from './utils.js';
import { $, screens, showScreen, initScreenManager } from './shared/screenManager.js';
import { initChat, setChatVisible, showJoinNotice } from './shared/chatManager.js';
import { checkAuth }       from './shared/authCheck.js';
import { renderRoomList, renderSpectatorList, renderWaiting as renderWaitingBase } from './shared/lobbyRenderer.js';
import { nameHtml, nameText, startReturnCountdown, clearReturnCountdown, showAloneOverlay } from './shared/uiHelpers.js';

{
  const MAX_ATTEMPTS = 5;
  const RETURN_DELAY = 6;

  const KEY_ROWS = [
    ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'],
    ['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ'],
  ];

  // ── State ────────────────────────────────────────────────────────────────
  let myId        = null;
  let myName      = '';
  let roomState   = null;
  let gameState   = { players: [], myKeyboard: {} };
  let amHost      = false;
  let isSpectator = false;
  let resultShown = false;

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
  const inputAnswer         = $('input-answer');
  const inputKeyboardToggle = $('input-keyboard-toggle');

  const jamoBanner     = $('jamo-banner');
  const jamoScoreboard = $('jamo-scoreboard');
  const jamoBoards     = $('jamo-boards');
  const jamoGuessRow   = $('jamo-guess-row');
  const inputGuess     = $('input-guess');
  const btnSubmitGuess = $('btn-submit-guess');

  const resultOverlay = $('result-overlay');
  const resultEmoji   = $('result-emoji');
  const resultTitle   = $('result-title');
  const resultSub     = $('result-sub');

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
    const answerLength = state.answerLength || 0;

    if (state.state === 'playing') {
      jamoBanner.textContent = `이번 문제는 자모 ${answerLength}칸입니다.`;
    } else if (state.state === 'roundEnd') {
      jamoBanner.textContent = state.winnerName
        ? `${nameText(state.winnerName)}님 정답! 정답은 "${state.answer}" 입니다.`
        : `아무도 못 맞췄습니다. 정답은 "${state.answer}" 입니다.`;
    } else {
      jamoBanner.textContent = '';
    }

    const bySco = [...state.players].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.wins || 0) - (a.wins || 0));
    jamoScoreboard.innerHTML = bySco.map((p, i) => `
      <div class="jamo-score-row">
        <span class="jamo-score-rank">${i + 1}위</span>
        <span class="jamo-score-name">${nameHtml(p.name)}${p.isHost ? ' 👑' : ''}${p.id === myId ? ' (나)' : ''}</span>
        <span class="jamo-score-value">${p.score || 0}점 · ${p.wins || 0}승</span>
      </div>
    `).join('');

    jamoBoards.innerHTML = '';
    const ordered = [...state.players].sort((a, b) => (a.id === myId ? 0 : 1) - (b.id === myId ? 0 : 1));

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
        ${p.isHost ? '<span class="badge-host">방장</span>' : ''}
        ${isMe     ? '<span class="badge-you">나</span>' : ''}
        ${p.solved ? '<span class="jamo-solved">✅ 정답</span>' : ''}
        <span class="jamo-attempt-count">${p.attemptCount || 0}/${MAX_ATTEMPTS}회</span>
      `;
      card.appendChild(header);

      if (!isMe && attempts.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'jamo-hidden-hint';
        hint.textContent = '아직 제출한 답이 없습니다.';
        card.appendChild(hint);
      }

      attempts.forEach((a, idx) => card.appendChild(renderAttemptRow(a, idx, answerLength)));
      for (let r = attempts.length; r < MAX_ATTEMPTS; r++) card.appendChild(renderEmptyRow(answerLength));

      if (isMe && state.keyboardVisible) card.appendChild(renderKeyboard(gameState.myKeyboard || {}));

      jamoBoards.appendChild(card);
    });

    const me = state.players.find(p => p.id === myId);
    const canGuess = !isSpectator && state.state === 'playing' && me && !me.solved && (me.attemptCount || 0) < MAX_ATTEMPTS;
    jamoGuessRow.style.display = (!isSpectator && state.state === 'playing') ? 'flex' : 'none';
    inputGuess.disabled     = !canGuess;
    btnSubmitGuess.disabled = !canGuess;
  }

  // ── Result overlay ────────────────────────────────────────────────────────
  function showResult(state) {
    const won  = !!state.winnerName;
    const me   = roomState?.players.find(p => p.id === myId);
    const iWon = won && me && me.name === state.winnerName;

    resultEmoji.textContent = iWon ? '🎉' : won ? '👏' : '🤔';
    resultTitle.textContent = iWon ? '정답입니다!' : won ? `${nameText(state.winnerName)}님 정답!` : '아무도 못 맞췄어요';
    resultTitle.className   = 'result-title ' + (iWon ? 'win' : won ? 'lose' : '');
    resultSub.textContent   = `정답은 "${state.answer}" 입니다.`;

    startReturnCountdown(RETURN_DELAY);
    resultOverlay.classList.add('show');
  }

  function hideResult() { resultOverlay.classList.remove('show'); }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('jamo_rooms_update', (list) => renderRoomList(roomListEl, list, socket, myName, nameHtml));

  socket.on('room_update', (state) => {
    roomState = state;

    if (isSpectator) {
      renderSpectatorList(state.spectators ?? []);
      if (state.state !== 'lobby') renderBoards(state);
      return;
    }

    if (state.state === 'lobby') {
      clearReturnCountdown();
      hideResult();
      resultShown = false;
      showScreen('waiting');
      renderWaiting(state);
    } else if (state.state === 'playing') {
      hideResult();
      resultShown = false;
      showScreen('game');
      renderBoards(state);
      renderSpectatorList(state.spectators ?? []);
    } else if (state.state === 'roundEnd') {
      showScreen('game');
      renderBoards(state);
      renderSpectatorList(state.spectators ?? []);
      if (!resultShown) { showResult(state); resultShown = true; }
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
    showAloneOverlay(message, () => hideResult());
  });

  // ── UI event listeners ────────────────────────────────────────────────────
  btnCreate.addEventListener('click', () => {
    const name = inputName.value.trim();
    if (!name) { showError('닉네임을 입력해주세요.'); inputName.focus(); return; }
    myName = name;
    socket.emit('create_room', { playerName: name });
  });

  btnReady.addEventListener('click', () => socket.emit('toggle_ready'));

  btnStart.addEventListener('click', () => {
    socket.emit('start_game', { answer: inputAnswer.value.trim() });
  });

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
    resultShown = false;
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
