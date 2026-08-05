import { createSocket, initReconnect, leaveRoom } from './shared/connection.js';
import { escHtml, showError } from './utils.js';
import { $, screens, showScreen, initScreenManager } from './shared/screenManager.js';
import { initChat, setChatVisible, showJoinNotice, appendSystemMessage } from './shared/chatManager.js';
import { checkAuth } from './shared/authCheck.js';
import { renderRoomList, renderSpectatorList, renderWaiting as renderWaitingBase } from './shared/lobbyRenderer.js';
import { nameHtml, nameText, showAloneOverlay } from './shared/uiHelpers.js';
import { initStatsDockButton, refreshStatsIfOpen } from './shared/statsModal.js';

{
  // ── State ────────────────────────────────────────────────────────────────
  let myId        = null;
  let myName      = '';
  let roomState   = null;
  let amHost      = false;
  let isSpectator = false;
  let hintTime    = 15; // 방장이 조절 가능. state.hintTimeout으로 매번 갱신
  // 개인화 상태(liar_state): 참가자는 { me: { role, word } }, 방장·관전자는 { all: [{ id,name,role,word }] }
  let liarState = { me: null, all: null };

  const playerAvatarEmojis = new Map();
  const AVATAR_ICONS = ['🕵️', '🎭', '🃏', '🎩'];

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const inputName     = $('player-name');
  const btnCreate      = $('btn-create');
  const roomListEl     = $('room-list');
  const playerListEl   = $('player-list');
  const btnReady       = $('btn-ready');
  const btnStart       = $('btn-start');
  const btnLeaveLobby  = $('btn-leave-lobby');
  const waitingHint    = $('waiting-hint');
  const hintTimeoutWrap   = $('liar-hint-timeout-wrap');
  const hintTimeoutSelect = $('liar-hint-timeout-select');
  const hintTimeoutSelect2 = $('liar-hint-timeout-select-2');

  const resultBanner   = $('liar-result-banner');
  const hostSetup      = $('liar-host-setup');
  const inputRealWord  = $('input-real-word');
  const inputLiarWord  = $('input-liar-word');
  const btnSetWords    = $('btn-set-words');
  const waitNotice     = $('liar-wait-notice');
  const returnLobby    = $('liar-return-lobby');
  const myWordEl       = $('liar-my-word');
  const revealPanel    = $('liar-reveal-panel');
  const turnBanner     = $('liar-turn-banner');
  const timerWrap      = $('liar-timer-wrap');
  const timerBar       = $('liar-timer-bar');
  const timerNum       = $('liar-timer-num');
  const hintLog        = $('liar-hint-log');
  const hintForm       = $('liar-hint-form');
  const hintInput      = $('liar-hint-input');
  const voteContinueEl = $('liar-vote-continue');
  const voteAccuseBtn  = $('liar-vote-accuse');
  const voteMoreBtn    = $('liar-vote-more');
  const voteProgressEl = $('liar-vote-progress');
  const voteLiarEl     = $('liar-vote-liar');
  const voteTargetList = $('liar-vote-target-list');
  const voteProgress2El = $('liar-vote-progress2');
  const guessForm      = $('liar-guess-form');
  const guessInput     = $('liar-guess-input');
  const btnLiarGuess   = $('btn-liar-guess');
  const guessWait      = $('liar-guess-wait');

  // ── Socket ───────────────────────────────────────────────────────────────
  const NS     = '/liar';
  const socket = createSocket(NS);

  initScreenManager(setChatVisible);
  initChat(socket, () => myId, playerAvatarEmojis);
  initStatsDockButton();
  socket.on('room_update', refreshStatsIfOpen);

  socket.on('connect', () => { myId = socket.id; });

  // 절전·앱 전환으로 끊겼다 돌아오면 있던 방으로 복귀시킨다.
  initReconnect(socket, NS, {
    onResumed: ({ isSpectator: spec }) => {
      isSpectator = !!spec;
      screens.game.classList.toggle('is-spectating', isSpectator);
      $('spectator-banner').style.display = isSpectator ? '' : 'none';
    },
    onLost: () => {
      isSpectator = false;
      screens.game.classList.remove('is-spectating');
      roomState = null;
      stopTimer();
      showScreen('lobby');
    },
  });

  checkAuth(inputName).then(data => {
    if (data) myName = data.username;
  });

  // ── 힌트 타이머 ─────────────────────────────────────────────────────────────
  let timerInterval = null;

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerWrap.style.display = 'none';
  }

  function startTimer(deadline) {
    clearInterval(timerInterval);
    timerWrap.style.display = '';
    const tick = () => {
      const rem = Math.max(0, deadline - Date.now());
      timerNum.textContent = Math.ceil(rem / 1000);
      timerBar.style.width = `${Math.min(100, (rem / (hintTime * 1000)) * 100)}%`;
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
      avatarIcons: AVATAR_ICONS, playerAvatarEmojis, nameHtml, minPlayers: 4,
    });

    hintTimeoutWrap.style.display = amHost ? '' : 'none';
    if (document.activeElement !== hintTimeoutSelect) {
      hintTimeoutSelect.value = String(state.hintTimeout ?? 15);
    }
  }

  // ── Render game ──────────────────────────────────────────────────────────
  function renderGame(state) {
    const phase        = state.state;
    const iAmHost       = state.players.find(p => p.id === myId)?.isHost ?? false;
    const participants  = state.players.filter(p => !p.isHost);
    const iAmParticipant = participants.some(p => p.id === myId);
    const privileged     = isSpectator || iAmHost;

    // ── 지난 라운드 결과 배너 ──────────────────────────────────────────────
    if (phase === 'wordSetup' && state.lastResult) {
      const r = state.lastResult;
      const win = r.winnerRole === 'liar' ? '라이어' : '시민';
      resultBanner.innerHTML = `지난 라운드: <strong>${escHtml(win)} 승리!</strong> · 라이어는 <strong>${nameText(r.liarName)}</strong>님이었습니다 · 진짜 제시어 "${escHtml(r.realWord)}" / 라이어 제시어 "${escHtml(r.liarWord)}"`;
      resultBanner.style.display = '';
    } else {
      resultBanner.style.display = 'none';
    }

    // ── 방장: 제시어 입력 ──────────────────────────────────────────────────
    const showHostSetup = iAmHost && !isSpectator && phase === 'wordSetup';
    hostSetup.style.display = showHostSetup ? 'flex' : 'none';
    if (showHostSetup) {
      inputRealWord.value = ''; inputLiarWord.value = ''; inputRealWord.focus();
      if (document.activeElement !== hintTimeoutSelect2) {
        hintTimeoutSelect2.value = String(state.hintTimeout ?? 15);
      }
    }

    // ── 참가자: 대기 안내 ──────────────────────────────────────────────────
    waitNotice.style.display = (!iAmHost && !isSpectator && phase === 'wordSetup') ? '' : 'none';

    // ── 방장 '대기실로 나가기' ─────────────────────────────────────────────
    returnLobby.style.display = (iAmHost && !isSpectator) ? '' : 'none';

    const inRound = phase === 'hint' || phase === 'voteContinue' || phase === 'voteLiar' || phase === 'liarGuess';

    // ── 내 제시어 (참가자 전용) ────────────────────────────────────────────
    if (inRound && !isSpectator && !iAmHost && liarState.me) {
      myWordEl.innerHTML = `내 제시어 <strong>"${escHtml(liarState.me.word)}"</strong>`;
      myWordEl.style.display = '';
    } else {
      myWordEl.style.display = 'none';
    }

    // ── 방장·관전자 전용 전체 공개 패널 ────────────────────────────────────
    if (inRound && privileged && liarState.all) {
      revealPanel.innerHTML = liarState.all.map(p => `
        <div class="liar-reveal-row${p.role === 'liar' ? ' is-liar' : ''}">
          <span class="liar-reveal-name">${nameHtml(p.name)}</span>
          <span class="liar-reveal-role">${p.role === 'liar' ? '🕵️ 라이어' : '🙂 시민'}</span>
          <span class="liar-reveal-word">"${escHtml(p.word)}"</span>
        </div>`).join('');
      revealPanel.style.display = '';
    } else {
      revealPanel.style.display = 'none';
    }

    // ── 힌트 순서 배너 ─────────────────────────────────────────────────────
    const current = state.players.find(p => p.id === state.currentTurn);
    const myTurn  = phase === 'hint' && state.currentTurn === myId && !isSpectator;
    if (phase === 'hint') {
      turnBanner.textContent = myTurn
        ? '내 차례! 힌트를 입력하세요.'
        : (current ? `${nameText(current.name)}님의 차례입니다…` : '...');
      turnBanner.className = myTurn ? 'my-turn' : '';
    } else if (phase === 'voteContinue') {
      turnBanner.textContent = '한 바퀴를 다 돌았습니다. 투표해주세요!';
      turnBanner.className = '';
    } else if (phase === 'voteLiar') {
      turnBanner.textContent = '라이어라고 생각하는 사람에게 투표하세요!';
      turnBanner.className = '';
    } else if (phase === 'liarGuess') {
      turnBanner.textContent = '라이어의 정체가 밝혀졌습니다!';
      turnBanner.className = '';
    } else {
      turnBanner.textContent = '';
    }

    // ── 힌트 기록 ──────────────────────────────────────────────────────────
    const hints = state.hints ?? [];
    hintLog.innerHTML = hints.map(h => `
      <div class="liar-hint-row${h.playerId === myId ? ' mine' : ''}">
        <span class="liar-hint-name">${nameHtml(h.playerName)}</span>
        <span class="liar-hint-text${h.skipped ? ' skipped' : ''}">${h.skipped ? '(시간 초과 · 힌트 없음)' : escHtml(h.text)}</span>
      </div>`).join('');
    hintLog.scrollTop = hintLog.scrollHeight;

    // ── 힌트 입력 ──────────────────────────────────────────────────────────
    hintForm.style.display = myTurn ? 'flex' : 'none';
    if (myTurn) hintInput.focus();

    // ── 타이머 ─────────────────────────────────────────────────────────────
    if (phase === 'hint' && state.turnDeadline) startTimer(state.turnDeadline);
    else stopTimer();

    // ── 투표 1: 지목 vs 한 바퀴 더 ──────────────────────────────────────────
    const showVoteContinue = phase === 'voteContinue' && !isSpectator && iAmParticipant;
    voteContinueEl.style.display = showVoteContinue ? '' : 'none';
    if (phase === 'voteContinue') {
      voteProgressEl.textContent = `${state.votesIn ?? 0} / ${state.votesNeeded ?? 0}명 투표 완료`;
    }

    // ── 투표 2: 라이어 지목 ──────────────────────────────────────────────
    const showVoteLiar = phase === 'voteLiar' && !isSpectator && iAmParticipant;
    voteLiarEl.style.display = showVoteLiar ? '' : 'none';
    if (phase === 'voteLiar') {
      voteTargetList.innerHTML = participants.map(p => `
        <li><button class="btn btn-secondary liar-target-btn" data-id="${p.id}">${nameHtml(p.name)}</button></li>
      `).join('');
      voteTargetList.querySelectorAll('.liar-target-btn').forEach(btn => {
        btn.addEventListener('click', () => socket.emit('cast_accuse_vote', { targetId: btn.dataset.id }));
      });
      voteProgress2El.textContent = `${state.votesIn ?? 0} / ${state.votesNeeded ?? 0}명 투표 완료`;
    }

    // ── 라이어의 마지막 기회 ────────────────────────────────────────────────
    const iAmAccusedLiar = phase === 'liarGuess' && state.accusedId === myId;
    guessForm.style.display = iAmAccusedLiar ? 'flex' : 'none';
    guessWait.style.display = (phase === 'liarGuess' && !iAmAccusedLiar) ? '' : 'none';
    if (iAmAccusedLiar) guessInput.focus();

    renderSpectatorList(state.spectators ?? []);
  }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('liar_rooms_update', (list) => renderRoomList(roomListEl, list, socket, myName, nameHtml));

  socket.on('room_update', (state) => {
    roomState = state;
    if (state.hintTimeout) hintTime = state.hintTimeout;
    if (isSpectator) {
      if (state.state === 'lobby') {
        showScreen('waiting');
        renderWaiting(state);
      } else {
        showScreen('game');
        renderGame(state);
      }
      return;
    }
    if (state.state === 'lobby') {
      stopTimer();
      showScreen('waiting');
      renderWaiting(state);
    } else {
      showScreen('game');
      renderGame(state);
    }
  });

  socket.on('liar_state', (data) => {
    liarState = data;
    if (roomState && roomState.state !== 'lobby') renderGame(roomState);
  });

  socket.on('spectate_start', (state) => {
    isSpectator = true;
    roomState   = state;
    screens.game.classList.add('is-spectating');
    $('spectator-banner').style.display = '';
    showScreen('game');
    renderGame(state);
  });

  socket.on('member_joined', ({ name, isSpectator: isSpec }) => showJoinNotice(name, isSpec));

  socket.on('liar_vote_result', ({ result }) => {
    if (result === 'tie') appendSystemMessage('🤔 투표가 동률이라 다시 투표합니다.');
    else if (result === 'accuse') appendSystemMessage('👉 과반이 라이어 지목에 찬성했습니다.');
    else if (result === 'continue') appendSystemMessage('🔁 한 바퀴 더 돕니다.');
  });

  socket.on('liar_accuse_result', ({ correct, accusedName }) => {
    appendSystemMessage(correct
      ? `🎯 ${nameText(accusedName)}님이 라이어로 지목됐습니다! 정체가 들켰습니다.`
      : `❌ ${nameText(accusedName)}님은 라이어가 아니었습니다.`);
  });

  socket.on('liar_result', ({ winnerRole, liarName }) => {
    appendSystemMessage(winnerRole === 'liar'
      ? `🕵️ 라이어(${nameText(liarName)}님) 승리!`
      : `🙂 시민 승리! 라이어는 ${nameText(liarName)}님이었습니다.`);
  });

  socket.on('round_cancelled', () => appendSystemMessage('⚠️ 라이어가 나가서 이번 라운드는 무효 처리됩니다.'));

  socket.on('error_msg', ({ message }) => showError(message));

  socket.on('kicked', ({ message }) => {
    showError(message);
    roomState = null;
    showScreen('lobby');
    socket.emit('get_rooms');
  });

  socket.on('alone_in_room', ({ message }) => {
    showAloneOverlay(message, () => stopTimer());
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

  hintTimeoutSelect.addEventListener('change', () => {
    socket.emit('set_hint_timeout', { seconds: parseInt(hintTimeoutSelect.value, 10) });
  });
  hintTimeoutSelect2.addEventListener('change', () => {
    socket.emit('set_hint_timeout', { seconds: parseInt(hintTimeoutSelect2.value, 10) });
  });

  btnLeaveLobby.addEventListener('click', () => {
    isSpectator = false;
    screens.game.classList.remove('is-spectating');
    leaveRoom(socket, NS);
    showScreen('lobby');
    roomState = null;
  });

  returnLobby.addEventListener('click', () => socket.emit('return_to_lobby'));

  btnSetWords.addEventListener('click', () => {
    socket.emit('set_words', { realWord: inputRealWord.value.trim(), liarWord: inputLiarWord.value.trim() });
  });

  hintForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = hintInput.value.trim();
    if (!text) return;
    socket.emit('submit_hint', { text });
    hintInput.value = '';
  });

  voteAccuseBtn.addEventListener('click', () => socket.emit('cast_continue_vote', { choice: 'accuse' }));
  voteMoreBtn.addEventListener('click',   () => socket.emit('cast_continue_vote', { choice: 'continue' }));

  btnLiarGuess.addEventListener('click', () => {
    const guess = guessInput.value.trim();
    if (!guess) return;
    socket.emit('submit_liar_guess', { guess });
  });
}
