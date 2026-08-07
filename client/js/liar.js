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
  let defenseTime = 60; // 〃 state.defenseTimeout으로 매번 갱신
  let guessTime   = 30; // 〃 state.guessTimeout으로 매번 갱신
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
  const timeoutSettingsWrap = $('liar-timeout-settings');
  const hintTimeoutSelect     = $('liar-hint-timeout-select');
  const defenseTimeoutSelect  = $('liar-defense-timeout-select');
  const guessTimeoutSelect    = $('liar-guess-timeout-select');

  const resultBannerLobby = $('liar-result-banner-lobby');
  const hintLogLobby      = $('liar-hint-log-lobby');
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
  const voteStatusContinueEl = $('liar-vote-status-continue');
  const voteLiarEl     = $('liar-vote-liar');
  const voteTargetList = $('liar-vote-target-list');
  const voteProgress2El = $('liar-vote-progress2');
  const voteStatusLiarEl = $('liar-vote-status-liar');
  const defenseEl        = $('liar-defense');
  const defenseNameEl    = $('liar-defense-name');
  const defenseTimerWrap = $('liar-defense-timer-wrap');
  const defenseTimerBar  = $('liar-defense-timer-bar');
  const defenseTimerNum  = $('liar-defense-timer-num');
  const defenseLogEl     = $('liar-defense-log');
  const defenseToast     = $('liar-defense-toast');
  const defenseForm      = $('liar-defense-form');
  const defenseInput     = $('liar-defense-input');
  const confirmVoteEl     = $('liar-confirm-vote');
  const confirmProceedBtn = $('liar-confirm-proceed');
  const confirmWithdrawBtn = $('liar-confirm-withdraw');
  const voteProgress3El    = $('liar-vote-progress3');
  const voteStatusConfirmEl = $('liar-vote-status-confirm');
  const btnEndDefense   = $('btn-end-defense');
  const tieBanner       = $('liar-tie-banner');
  const caughtOverlay   = $('liar-caught-overlay');
  const caughtNameEl    = $('liar-caught-name');
  const guessForm      = $('liar-guess-form');
  const guessInput     = $('liar-guess-input');
  const btnLiarGuess   = $('btn-liar-guess');
  const guessWait      = $('liar-guess-wait');
  const guessLiveEl    = $('liar-guess-live');
  const guessTimerWrap = $('liar-guess-timer-wrap');
  const guessTimerBar  = $('liar-guess-timer-bar');
  const guessTimerNum  = $('liar-guess-timer-num');
  const startedToast   = $('liar-started-toast');

  // 버튼(투표/입력) 묶음 — 참가자에게만 보이고 방장·관전자에게는 진행 현황만 보인다
  const voteContinueButtons = voteContinueEl.querySelector('.liar-vote-buttons');
  const voteConfirmButtons  = confirmVoteEl.querySelector('.liar-vote-buttons');

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
      stopDefenseTimer();
      stopGuessTimer();
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

  // ── 최후 반론 타이머 (방장이 조절 가능. state.defenseTimeout으로 매번 갱신) ──
  let defenseInterval = null;

  function stopDefenseTimer() {
    clearInterval(defenseInterval);
    defenseInterval = null;
  }

  function startDefenseTimer(deadline) {
    clearInterval(defenseInterval);
    const tick = () => {
      const rem = Math.max(0, deadline - Date.now());
      defenseTimerNum.textContent = Math.ceil(rem / 1000);
      defenseTimerBar.style.width = `${Math.min(100, (rem / (defenseTime * 1000)) * 100)}%`;
      if (rem <= 0) clearInterval(defenseInterval);
    };
    tick();
    defenseInterval = setInterval(tick, 100);
  }

  // ── 라이어 정답 제한시간 타이머 (방장이 조절 가능. state.guessTimeout으로 매번 갱신) ──
  let guessInterval = null;

  function stopGuessTimer() {
    clearInterval(guessInterval);
    guessInterval = null;
    guessTimerWrap.style.display = 'none';
  }

  function startGuessTimer(deadline) {
    clearInterval(guessInterval);
    guessTimerWrap.style.display = '';
    const tick = () => {
      const rem = Math.max(0, deadline - Date.now());
      guessTimerNum.textContent = Math.ceil(rem / 1000);
      guessTimerBar.style.width = `${Math.min(100, (rem / (guessTime * 1000)) * 100)}%`;
      guessTimerBar.classList.toggle('urgent', rem <= 5000);
      if (rem <= 0) clearInterval(guessInterval);
    };
    tick();
    guessInterval = setInterval(tick, 100);
  }

  // ── 투표 참여 현황(누가 투표했는지) ──────────────────────────────────────────
  function renderVoterStatus(container, participants, votedIds) {
    const voted = new Set(votedIds ?? []);
    container.innerHTML = participants.map(p => `
      <li class="${voted.has(p.id) ? 'voted' : ''}${p.disconnected ? ' is-offline' : ''}">
        <span class="liar-voter-dot"></span>
        <span>${nameHtml(p.name)}</span>
      </li>`).join('');
  }

  // ── 힌트 기록 렌더 (대기실·게임 화면 공용) ──────────────────────────────────
  function renderHintLog(container, hints) {
    container.innerHTML = hints.map(h => `
      <div class="liar-hint-row${h.playerId === myId ? ' mine' : ''}">
        <span class="liar-hint-name">${nameHtml(h.playerName)}</span>
        <span class="liar-hint-text${h.skipped ? ' skipped' : ''}">${h.skipped ? '(시간 초과 · 힌트 없음)' : escHtml(h.text)}</span>
      </div>`).join('');
  }

  function resultBannerHtml(r) {
    const win = r.winnerRole === 'liar' ? '라이어' : '시민';
    return [
      `지난 라운드: <strong>${escHtml(win)} 승리!</strong> · 라이어는 <strong>${nameText(r.liarName)}</strong>님이었습니다`,
      `진짜 제시어 "${escHtml(r.realWord)}"`,
      r.liarGuess ? `라이어가 작성한 답 "${escHtml(r.liarGuess)}"` : null,
    ].filter(Boolean).join('<br>');
  }

  // ── Render waiting ───────────────────────────────────────────────────────
  function renderWaiting(state) {
    amHost = renderWaitingBase(state, {
      myId, socket, playerListEl, btnReady, btnStart, waitingHint,
      avatarIcons: AVATAR_ICONS, playerAvatarEmojis, nameHtml, minPlayers: 3,
    });

    timeoutSettingsWrap.style.display = amHost ? '' : 'none';
    if (document.activeElement !== hintTimeoutSelect) {
      hintTimeoutSelect.value = String(state.hintTimeout ?? 15);
    }
    if (document.activeElement !== defenseTimeoutSelect) {
      defenseTimeoutSelect.value = String(state.defenseTimeout ?? 60);
    }
    if (document.activeElement !== guessTimeoutSelect) {
      guessTimeoutSelect.value = String(state.guessTimeout ?? 30);
    }

    // ── 직전 라운드 결과 + 힌트 기록 (다음 라운드가 시작되면 서버가 비운다) ──
    if (state.lastResult) {
      resultBannerLobby.innerHTML = resultBannerHtml(state.lastResult);
      resultBannerLobby.style.display = '';
    } else {
      resultBannerLobby.style.display = 'none';
    }
    renderHintLog(hintLogLobby, state.hints ?? []);
  }

  // ── Render game ──────────────────────────────────────────────────────────
  function renderGame(state) {
    const phase        = state.state;
    const iAmHost       = state.players.find(p => p.id === myId)?.isHost ?? false;
    const participants  = state.players;
    const iAmParticipant = participants.some(p => p.id === myId);

    // ── 방장 '대기실로 나가기' ─────────────────────────────────────────────
    returnLobby.style.display = (iAmHost && !isSpectator) ? '' : 'none';

    const inRound = phase === 'hint' || phase === 'voteContinue' || phase === 'voteLiar' ||
                    phase === 'defense' || phase === 'confirmAccuse' || phase === 'liarGuess';

    // ── 내 역할·제시어 (참가자 전용 — 방장도 이제 참가자다) ─────────────────
    if (inRound && !isSpectator && liarState.me) {
      myWordEl.innerHTML = liarState.me.role === 'liar'
        ? `당신은 <strong>라이어</strong>입니다! 제시어를 모릅니다 — 힌트를 듣고 눈치껏 넘어가세요`
        : `내 제시어 <strong>"${escHtml(liarState.me.word)}"</strong>`;
      myWordEl.style.display = '';
    } else {
      myWordEl.style.display = 'none';
    }

    // ── 관전자 전용 전체 공개 패널 (방장도 이제 참가자이므로 역할을 모른다) ──
    if (inRound && isSpectator && liarState.all) {
      revealPanel.innerHTML = liarState.all.map(p => `
        <div class="liar-reveal-row${p.role === 'liar' ? ' is-liar' : ''}">
          <span class="liar-reveal-name">${nameHtml(p.name)}</span>
          <span class="liar-reveal-role">${p.role === 'liar' ? '🕵️ 라이어' : '🙂 시민'}</span>
          <span class="liar-reveal-word">${p.word ? `"${escHtml(p.word)}"` : '(제시어 모름)'}</span>
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
    } else if (phase === 'defense') {
      turnBanner.textContent = '지목된 사람의 최후 반론 시간입니다…';
      turnBanner.className = '';
    } else if (phase === 'confirmAccuse') {
      turnBanner.textContent = '반론을 들었습니다. 그대로 진행할지 투표하세요!';
      turnBanner.className = '';
    } else if (phase === 'liarGuess') {
      turnBanner.textContent = '라이어의 정체가 밝혀졌습니다!';
      turnBanner.className = '';
    } else {
      turnBanner.textContent = '';
    }

    // ── 힌트 기록 ──────────────────────────────────────────────────────────
    renderHintLog(hintLog, state.hints ?? []);
    hintLog.scrollTop = hintLog.scrollHeight;

    // ── 힌트 입력 ──────────────────────────────────────────────────────────
    hintForm.style.display = myTurn ? 'flex' : 'none';
    if (myTurn) hintInput.focus();

    // ── 타이머 ─────────────────────────────────────────────────────────────
    if (phase === 'hint' && state.turnDeadline) startTimer(state.turnDeadline);
    else stopTimer();

    // ── 투표 1: 지목 vs 한 바퀴 더 (현황은 방장·관전자도, 버튼은 참가자만) ──────
    voteContinueEl.style.display = (phase === 'voteContinue' && !isSpectator) ? '' : 'none';
    voteContinueButtons.style.display = (phase === 'voteContinue' && iAmParticipant) ? 'flex' : 'none';
    if (phase === 'voteContinue') {
      voteProgressEl.textContent = `${state.votesIn ?? 0} / ${state.votesNeeded ?? 0}명 투표 완료`;
      renderVoterStatus(voteStatusContinueEl, participants, state.votedIds);
    }

    // ── 투표 2: 라이어 지목 (현황은 방장·관전자도, 선택 목록은 참가자만) ──────
    voteLiarEl.style.display = (phase === 'voteLiar' && !isSpectator) ? '' : 'none';
    voteTargetList.style.display = (phase === 'voteLiar' && iAmParticipant) ? '' : 'none';
    if (phase === 'voteLiar') {
      voteTargetList.innerHTML = participants.map(p => `
        <li><button class="btn btn-secondary liar-target-btn" data-id="${p.id}">${nameHtml(p.name)}</button></li>
      `).join('');
      voteTargetList.querySelectorAll('.liar-target-btn').forEach(btn => {
        btn.addEventListener('click', () => socket.emit('cast_accuse_vote', { targetId: btn.dataset.id }));
      });
      voteProgress2El.textContent = `${state.votesIn ?? 0} / ${state.votesNeeded ?? 0}명 투표 완료`;
      renderVoterStatus(voteStatusLiarEl, participants, state.votedIds);
    }

    // ── 최후 반론 (카운트다운 + 지목당한 사람 전용 입력/종료 토스트) ────────
    defenseEl.style.display = phase === 'defense' ? '' : 'none';
    if (phase === 'defense') {
      const accused = state.players.find(p => p.id === state.accusedId);
      defenseNameEl.textContent = accused ? nameText(accused.name) : '';
      if (state.defenseDeadline) startDefenseTimer(state.defenseDeadline);
    } else {
      stopDefenseTimer();
    }

    const lines = (phase === 'defense' || phase === 'confirmAccuse') ? (state.defenseLines ?? []) : [];
    defenseLogEl.innerHTML = lines.map(l => `<li>${escHtml(l.text)}</li>`).join('');
    defenseLogEl.scrollTop = defenseLogEl.scrollHeight;

    const iAmAccused = phase === 'defense' && !isSpectator && state.accusedId === myId;
    defenseToast.style.display = iAmAccused ? '' : 'none';
    if (iAmAccused && document.activeElement !== defenseInput) defenseInput.focus();

    // ── 투표 3: 반론 이후 그대로 진행 vs 철회 (현황은 방장·관전자도, 버튼은 참가자만) ──
    confirmVoteEl.style.display = (phase === 'confirmAccuse' && !isSpectator) ? '' : 'none';
    voteConfirmButtons.style.display = (phase === 'confirmAccuse' && iAmParticipant) ? 'flex' : 'none';
    if (phase === 'confirmAccuse') {
      voteProgress3El.textContent = `${state.votesIn ?? 0} / ${state.votesNeeded ?? 0}명 투표 완료`;
      renderVoterStatus(voteStatusConfirmEl, participants, state.votedIds);
    }

    // ── 라이어의 마지막 기회 (본인은 입력, 나머지는 실시간 타이핑 미리보기) ──
    const iAmAccusedLiar = phase === 'liarGuess' && state.accusedId === myId;
    guessForm.style.display = iAmAccusedLiar ? 'flex' : 'none';
    guessWait.style.display = (phase === 'liarGuess' && !iAmAccusedLiar) ? '' : 'none';
    if (iAmAccusedLiar) guessInput.focus();
    if (phase !== 'liarGuess') { guessInput.value = ''; guessLiveEl.textContent = ''; }

    if (phase === 'liarGuess' && state.guessDeadline) startGuessTimer(state.guessDeadline);
    else stopGuessTimer();

    renderSpectatorList(state.spectators ?? []);
  }

  // ── Socket events ─────────────────────────────────────────────────────────
  socket.on('liar_rooms_update', (list) => renderRoomList(roomListEl, list, socket, myName, nameHtml));

  socket.on('room_update', (state) => {
    roomState = state;
    if (state.hintTimeout)    hintTime    = state.hintTimeout;
    if (state.defenseTimeout) defenseTime = state.defenseTimeout;
    if (state.guessTimeout)   guessTime   = state.guessTimeout;
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

  let startedToastTimer = null;
  socket.on('game_started', () => {
    startedToast.style.display = '';
    startedToast.classList.remove('flash'); void startedToast.offsetWidth; startedToast.classList.add('flash');
    clearTimeout(startedToastTimer);
    startedToastTimer = setTimeout(() => { startedToast.style.display = 'none'; }, 2500);
  });

  let tieBannerTimer = null;
  function flashTieBanner() {
    tieBanner.style.display = '';
    tieBanner.classList.remove('flash'); void tieBanner.offsetWidth; tieBanner.classList.add('flash');
    clearTimeout(tieBannerTimer);
    tieBannerTimer = setTimeout(() => { tieBanner.style.display = 'none'; }, 3000);
  }

  socket.on('liar_vote_result', ({ result }) => {
    if (result === 'tie') { appendSystemMessage('🤔 투표가 동률이라 다시 투표합니다.'); flashTieBanner(); }
    else if (result === 'accuse') appendSystemMessage('👉 과반이 라이어 지목에 찬성했습니다.');
    else if (result === 'continue') appendSystemMessage('🔁 한 바퀴 더 돕니다.');
    else if (result === 'proceed') appendSystemMessage('👉 지목을 그대로 진행합니다.');
    else if (result === 'withdraw') appendSystemMessage('🔁 지목을 철회하고 한 바퀴 더 돕니다.');
  });

  socket.on('liar_accused', ({ accusedName }) => {
    appendSystemMessage(`⚠️ ${nameText(accusedName)}님이 라이어로 지목됐습니다! 최후 반론 시간(최대 1분)을 드립니다.`);
  });

  let caughtOverlayTimer = null;
  function flashCaughtOverlay(name) {
    caughtNameEl.textContent = nameText(name);
    caughtOverlay.style.display = '';
    caughtOverlay.classList.remove('show'); void caughtOverlay.offsetWidth; caughtOverlay.classList.add('show');
    clearTimeout(caughtOverlayTimer);
    caughtOverlayTimer = setTimeout(() => { caughtOverlay.style.display = 'none'; }, 2200);
  }

  socket.on('liar_accuse_result', ({ correct, accusedName }) => {
    if (correct) {
      flashCaughtOverlay(accusedName);
      appendSystemMessage(`🎯 ${nameText(accusedName)}님이 라이어로 지목됐습니다! 정체가 들켰습니다.`);
    } else {
      appendSystemMessage(`❌ ${nameText(accusedName)}님은 라이어가 아니었습니다.`);
    }
  });

  socket.on('liar_guess_typing', ({ text }) => {
    guessLiveEl.textContent = text ? `"${text}"` : '';
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
    showAloneOverlay(message, () => { stopTimer(); stopDefenseTimer(); stopGuessTimer(); });
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
  defenseTimeoutSelect.addEventListener('change', () => {
    socket.emit('set_defense_timeout', { seconds: parseInt(defenseTimeoutSelect.value, 10) });
  });
  guessTimeoutSelect.addEventListener('change', () => {
    socket.emit('set_guess_timeout', { seconds: parseInt(guessTimeoutSelect.value, 10) });
  });

  btnLeaveLobby.addEventListener('click', () => {
    isSpectator = false;
    screens.game.classList.remove('is-spectating');
    leaveRoom(socket, NS);
    showScreen('lobby');
    roomState = null;
  });

  returnLobby.addEventListener('click', () => socket.emit('return_to_lobby'));

  hintForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = hintInput.value.trim();
    if (!text) return;
    socket.emit('submit_hint', { text });
    hintInput.value = '';
  });

  defenseForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = defenseInput.value.trim();
    if (!text) return;
    socket.emit('submit_defense_line', { text });
    defenseInput.value = '';
    defenseInput.focus();
  });

  btnEndDefense.addEventListener('click', () => socket.emit('end_defense'));

  voteAccuseBtn.addEventListener('click', () => socket.emit('cast_continue_vote', { choice: 'accuse' }));
  voteMoreBtn.addEventListener('click',   () => socket.emit('cast_continue_vote', { choice: 'continue' }));

  confirmProceedBtn.addEventListener('click',  () => socket.emit('cast_confirm_vote', { choice: 'proceed' }));
  confirmWithdrawBtn.addEventListener('click', () => socket.emit('cast_confirm_vote', { choice: 'withdraw' }));

  // 라이어 본인이 입력하는 동안, 그 내용을 실시간으로 다른 사람들에게도 보여준다.
  guessInput.addEventListener('input', () => {
    socket.emit('submit_guess_typing', { text: guessInput.value });
  });

  btnLiarGuess.addEventListener('click', () => {
    const guess = guessInput.value.trim();
    if (!guess) return;
    socket.emit('submit_liar_guess', { guess });
  });
}
