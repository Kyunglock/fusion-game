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

  // 물리 키보드 → 자모 매핑. e.code(물리 위치) 기준이라 한글 IME/언어 설정과 무관하게 동작한다.
  const CODE_JAMO = {
    KeyQ:'ㅂ', KeyW:'ㅈ', KeyE:'ㄷ', KeyR:'ㄱ', KeyT:'ㅅ', KeyY:'ㅛ', KeyU:'ㅕ', KeyI:'ㅑ', KeyO:'ㅐ', KeyP:'ㅔ',
    KeyA:'ㅁ', KeyS:'ㄴ', KeyD:'ㅇ', KeyF:'ㄹ', KeyG:'ㅎ', KeyH:'ㅗ', KeyJ:'ㅓ', KeyK:'ㅏ', KeyL:'ㅣ',
    KeyZ:'ㅋ', KeyX:'ㅌ', KeyC:'ㅊ', KeyV:'ㅍ', KeyB:'ㅠ', KeyN:'ㅜ', KeyM:'ㅡ',
  };

  // 겹자모/겹모음은 원자 자모 여러 개로 분해해 채점 규칙(서버 decompose)과 항상 일치시킨다.
  // (IME로 ㅐ·ㄲ 등이 통째로 들어오는 경우 대비)
  const ATOMIZE = {
    'ㅐ':['ㅏ','ㅣ'], 'ㅒ':['ㅑ','ㅣ'], 'ㅔ':['ㅓ','ㅣ'], 'ㅖ':['ㅕ','ㅣ'],
    'ㅘ':['ㅗ','ㅏ'], 'ㅙ':['ㅗ','ㅏ','ㅣ'], 'ㅚ':['ㅗ','ㅣ'],
    'ㅝ':['ㅜ','ㅓ'], 'ㅞ':['ㅜ','ㅓ','ㅣ'], 'ㅟ':['ㅜ','ㅣ'], 'ㅢ':['ㅡ','ㅣ'],
    'ㄲ':['ㄱ','ㄱ'], 'ㄸ':['ㄷ','ㄷ'], 'ㅃ':['ㅂ','ㅂ'], 'ㅆ':['ㅅ','ㅅ'], 'ㅉ':['ㅈ','ㅈ'],
  };
  const atomize = (j) => ATOMIZE[j] || [j];

  // ── 자모 → 한글 음절 조합 (서버 decompose 의 역함수) ─────────────────────────
  // 입력한 원자 자모를 음절로 합쳐 "자연"처럼 보이게 한다. 조합 결과를 서버로 보내도
  // decompose 가 다시 같은 자모로 쪼개므로 채점은 동일하다.
  const C_CHO  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const C_JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const C_JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  const CONS_DOUBLE  = { 'ㄱ|ㄱ':'ㄲ','ㄷ|ㄷ':'ㄸ','ㅂ|ㅂ':'ㅃ','ㅅ|ㅅ':'ㅆ','ㅈ|ㅈ':'ㅉ' };
  const VOWEL_COMBINE = {
    'ㅏ|ㅣ':'ㅐ','ㅑ|ㅣ':'ㅒ','ㅓ|ㅣ':'ㅔ','ㅕ|ㅣ':'ㅖ',
    'ㅗ|ㅏ':'ㅘ','ㅘ|ㅣ':'ㅙ','ㅗ|ㅐ':'ㅙ','ㅗ|ㅣ':'ㅚ',
    'ㅜ|ㅓ':'ㅝ','ㅝ|ㅣ':'ㅞ','ㅜ|ㅔ':'ㅞ','ㅜ|ㅣ':'ㅟ','ㅡ|ㅣ':'ㅢ',
  };
  const JONG_COMBINE = {
    'ㄱ|ㄱ':'ㄲ','ㄱ|ㅅ':'ㄳ','ㄴ|ㅈ':'ㄵ','ㄴ|ㅎ':'ㄶ','ㄹ|ㄱ':'ㄺ','ㄹ|ㅁ':'ㄻ',
    'ㄹ|ㅂ':'ㄼ','ㄹ|ㅅ':'ㄽ','ㄹ|ㅌ':'ㄾ','ㄹ|ㅍ':'ㄿ','ㄹ|ㅎ':'ㅀ','ㅂ|ㅅ':'ㅄ','ㅅ|ㅅ':'ㅆ',
  };
  const JONG_SPLIT_LOCAL = {
    'ㄲ':['ㄱ','ㄱ'],'ㅆ':['ㅅ','ㅅ'],'ㄳ':['ㄱ','ㅅ'],'ㄵ':['ㄴ','ㅈ'],'ㄶ':['ㄴ','ㅎ'],
    'ㄺ':['ㄹ','ㄱ'],'ㄻ':['ㄹ','ㅁ'],'ㄼ':['ㄹ','ㅂ'],'ㄽ':['ㄹ','ㅅ'],'ㄾ':['ㄹ','ㅌ'],
    'ㄿ':['ㄹ','ㅍ'],'ㅀ':['ㄹ','ㅎ'],'ㅄ':['ㅂ','ㅅ'],
  };

  function toSyllable(cho, jung, jong) {
    const ci = C_CHO.indexOf(cho);
    const ji = C_JUNG.indexOf(jung);
    const ki = jong ? C_JONG.indexOf(jong) : 0;
    if (ci >= 0 && ji >= 0 && ki >= 0) {
      return String.fromCharCode(0xAC00 + (ci * 21 + ji) * 28 + ki);
    }
    return (cho || '') + (jung || '') + (jong || ''); // 불완전하면 낱자 그대로
  }

  function composeJamo(jamos) {
    let out = '', cho = '', jung = '', jong = '';
    const key = (a, b) => `${a}|${b}`;
    const flush = () => {
      if (cho || jung || jong) out += toSyllable(cho, jung, jong);
      cho = jung = jong = '';
    };

    for (const c of jamos) {
      if (!C_JUNG.includes(c)) {
        // 자음
        if (!jung) {
          if (!cho) cho = c;
          else if (CONS_DOUBLE[key(cho, c)]) cho = CONS_DOUBLE[key(cho, c)];
          else { flush(); cho = c; }
        } else if (!jong) {
          jong = c;
        } else if (JONG_COMBINE[key(jong, c)]) {
          jong = JONG_COMBINE[key(jong, c)];
        } else {
          flush(); cho = c;
        }
      } else {
        // 모음
        if (jong) {
          // 종성이 있으면 다음 음절 초성으로 넘긴다 (겹받침은 뒤 자음만)
          const split = JONG_SPLIT_LOCAL[jong];
          let stolen;
          if (split) { jong = split[0]; stolen = split[1]; }
          else { stolen = jong; jong = ''; }
          flush(); cho = stolen; jung = c;
        } else if (!jung) {
          jung = c;
        } else if (VOWEL_COMBINE[key(jung, c)]) {
          jung = VOWEL_COMBINE[key(jung, c)];
        } else {
          flush(); jung = c;
        }
      }
    }
    flush();
    return out;
  }

  // ── State ────────────────────────────────────────────────────────────────
  let myId        = null;
  let myName      = '';
  let roomState   = null;
  let gameState   = { players: [], myKeyboard: {} };
  let amHost      = false;
  let isSpectator = false;

  // 답 입력: 화면/물리 키보드로 조합 중인 자모(원자 단위)
  let composing        = [];    // 현재 입력 중인 자모 배열
  let composeAnswerLen = 0;     // 이번 라운드 자모 칸 수
  let canGuessNow      = false; // 지금 내가 입력 가능한 상태인지

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

  // showColors: 자모별 최고 등급 색상 힌트 노출(방장 토글) / interactive: 입력 가능 상태
  function renderKeyboard(myKeyboard, showColors, interactive) {
    const wrap = document.createElement('div');
    wrap.className = 'jamo-keyboard';
    const title = document.createElement('div');
    title.className = 'jamo-keyboard-title';
    title.textContent = interactive ? '키보드를 눌러 자모를 입력하세요 (물리 키보드도 가능)' : '내 키보드';
    wrap.appendChild(title);

    KEY_ROWS.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'jamo-key-row';
      row.forEach(k => {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = `jamo-key${showColors && myKeyboard[k] ? ' ' + myKeyboard[k] : ''}`;
        key.textContent = k;
        key.disabled = !interactive;
        key.addEventListener('click', () => appendJamo(k));
        rowEl.appendChild(key);
      });
      wrap.appendChild(rowEl);
    });

    // 동작 키: 지우기(⌫) / 입력(⏎)
    const actionRow = document.createElement('div');
    actionRow.className = 'jamo-key-row jamo-action-row';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'jamo-key jamo-key-action jamo-key-del';
    del.textContent = '⌫ 지우기';
    del.disabled = !interactive;
    del.addEventListener('click', backspaceJamo);
    const enter = document.createElement('button');
    enter.type = 'button';
    enter.className = 'jamo-key jamo-key-action jamo-key-enter';
    enter.textContent = '입력 ⏎';
    enter.disabled = !interactive;
    enter.addEventListener('click', submitGuess);
    actionRow.appendChild(del);
    actionRow.appendChild(enter);
    wrap.appendChild(actionRow);

    return wrap;
  }

  // ── 조합 중인 자모 입력/삭제/제출 ─────────────────────────────────────────
  function appendJamo(j) {
    if (!canGuessNow) return;
    for (const piece of atomize(j)) {
      if (composing.length >= composeAnswerLen) break;
      composing.push(piece);
    }
    updateComposingCells();
  }

  function backspaceJamo() {
    if (!canGuessNow) return;
    composing.pop();
    updateComposingCells();
  }

  function submitGuess() {
    if (!canGuessNow) return;
    if (composing.length !== composeAnswerLen) {
      showError(`자모 ${composeAnswerLen}칸을 모두 채워주세요.`);
      return;
    }
    socket.emit('submit_guess', { guess: composeJamo(composing) });
    composing = [];
    updateComposingCells();
  }

  // 내 보드의 현재 시도 줄(#jamo-active-row)에 조합 중인 자모를 채워 넣는다.
  function updateComposingCells() {
    const row = document.getElementById('jamo-active-row');
    if (!row) return;
    row.querySelectorAll('.jamo-cell').forEach((cell, i) => {
      cell.textContent = composing[i] ?? '';
      cell.classList.toggle('filled', i < composing.length);
    });
    // 현재 줄 라벨에 조합 중인 단어를 실시간으로 보여준다 (예: 자연)
    const label = row.querySelector('.jamo-word-label');
    if (label) label.textContent = composeJamo(composing);
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

    // ── 입력 가능 상태 계산 (내 보드 현재 줄 활성화 + 키보드 활성화에 사용) ──
    const me = participants.find(p => p.id === myId);
    const canGuess = !isSpectator && !iAmHost && state.state === 'playing'
      && me && !me.solved && (me.attemptCount || 0) < MAX_ATTEMPTS;
    canGuessNow      = !!canGuess;
    composeAnswerLen = answerLength;
    if (state.state !== 'playing') composing = []; // 라운드가 끝나면 조합 초기화

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
      for (let r = attempts.length; r < MAX_ATTEMPTS; r++) {
        const empty = renderEmptyRow(answerLength);
        // 내 보드의 첫 빈 줄 = 현재 입력 줄. 조합 중인 자모를 여기에 채운다.
        if (isMe && canGuess && r === attempts.length) empty.id = 'jamo-active-row';
        card.appendChild(empty);
      }

      jamoBoards.appendChild(card);
    });

    // ── 내 키보드 (보드 카드 밖 별도 렌더 = 답 입력 수단) ──────────────────
    // 라운드 진행 중인 참가자에게는 항상 노출한다. keyboardVisible 토글은 이제
    // '색상 힌트' 노출 여부만 제어하고, 키보드 자체는 입력을 위해 늘 보인다.
    const showKeyboard = !isSpectator && !iAmHost && state.state === 'playing'
      && participants.some(p => p.id === myId);
    jamoMyKeyboard.style.display = showKeyboard ? 'flex' : 'none';
    jamoMyKeyboard.innerHTML = '';
    if (showKeyboard) {
      jamoMyKeyboard.appendChild(
        renderKeyboard(gameState.myKeyboard || {}, state.keyboardVisible !== false, canGuessNow)
      );
    }

    // 보드 재생성 후 조합 중인 자모를 현재 줄에 다시 채운다.
    updateComposingCells();
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

  // ── 물리 키보드 입력 (두벌식, e.code 기반 → IME/언어 설정과 무관) ──────────
  document.addEventListener('keydown', (e) => {
    if (!canGuessNow) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 채팅 등 입력창에 포커스가 있으면 게임 입력으로 가로채지 않는다.
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

    if (e.key === 'Enter')     { e.preventDefault(); submitGuess();  return; }
    if (e.key === 'Backspace') { e.preventDefault(); backspaceJamo(); return; }

    // 물리 키 위치(e.code) 우선, 안 되면 이미 자모로 들어온 e.key 사용(IME 대비)
    let jamo = CODE_JAMO[e.code];
    if (!jamo && /^[ㄱ-ㅎㅏ-ㅣ]$/.test(e.key)) jamo = e.key;
    if (jamo) { e.preventDefault(); appendJamo(jamo); }
  });
}
