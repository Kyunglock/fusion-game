import { rooms, getRoomOf, safeState, removePlayer, removeSpectator, manager, participantsOf, activeParticipants } from './rooms.js';
import { LIAR_MIN_PLAYERS, LIAR_HINT_TIMEOUT, LIAR_DEFENSE_TIMEOUT, LIAR_GUESS_TIMEOUT, LIAR_VOTE_TIMEOUT, LIAR_RECONNECT_GRACE_MS } from '../../config.js';
import { registerCommonHandlers } from '../../shared/socketHandlers.js';
import { recordPlayers } from '../../db/stats.js';
// 인지형 제시어는 캐치마인드 사전을 재사용한다 — 낱말마다 카테고리가 붙어 있어
// 라이어에게 '동물'·'음식' 같은 힌트를 줄 수 있고, 전부 눈에 보이는 사물이라
// 힌트를 내기도 좋다(자모 워들 사전은 '희망'·'역사' 같은 추상어까지 섞여 있다).
import { ALL_WORDS, categoryOf } from '../catchmind/words.js';

// ── 뷰어별 개인화 상태 전송 ──────────────────────────────────────────────────
// 참가자는 자신의 역할·제시어만 보고, 관전자와 바보형 방장(진행자)만 참가자 전원의
// 역할·제시어를 모두 본다.
//   · 인지형 — 라이어는 role만 알 뿐 word는 null로 내려간다(제시어 모름)
//   · 바보형 — 라이어에게도 시민인 척(role: 'citizen') 가짜 제시어를 진짜처럼 내려보낸다.
//     감추는 것은 서버에서 끝내야 한다(플래그만 보내고 화면에서 가리면 개발자 도구로 다 보인다).
function selfView(room, p) {
  const disguised = room.liarMode === 'unaware' && p.role === 'liar' && room.state !== 'liarGuess';
  return { role: disguised ? 'citizen' : p.role, word: p.word, ...liarHint(room, p) };
}

// 인지형 라이어에게만 주는 카테고리 힌트 — 제시어를 아예 모른 채 힌트를 지어내는 것은
// 너무 불리해서, 낱말이 어느 갈래인지(동물·음식 …)까지만 알려준다.
// 시민에게는 붙이지 않는다(어차피 제시어를 알고 있어 의미가 없다).
function liarHint(room, p) {
  if (p.role !== 'liar' || room.liarMode !== 'aware' || !room.wordCategory) return {};
  return { category: room.wordCategory };
}

function emitLiarState(io, room) {
  const inRound = room.state === 'hint' || room.state === 'voteContinue' ||
                  room.state === 'voteLiar' || room.state === 'defense' ||
                  room.state === 'confirmAccuse' || room.state === 'liarGuess';
  const participants = participantsOf(room);
  const privileged = new Set([
    ...room.spectators.map(s => s.id),
    // 바보형 방장은 제시어를 직접 낸 진행자다 — 이미 다 아는 사람이라 전원 공개로 본다.
    ...(room.liarMode === 'unaware' ? room.players.filter(p => p.isHost).map(p => p.id) : []),
  ]);
  const viewers = [...room.players.map(p => p.id), ...room.spectators.map(s => s.id)];

  viewers.forEach(viewerId => {
    if (privileged.has(viewerId)) {
      io.to(viewerId).emit('liar_state', {
        all: inRound ? participants.map(p => ({ id: p.id, name: p.name, role: p.role, word: p.word, ...liarHint(room, p) })) : [],
      });
    } else {
      const me = participants.find(p => p.id === viewerId);
      io.to(viewerId).emit('liar_state', {
        me: (inRound && me) ? selfView(room, me) : null,
      });
    }
  });
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── 타이머 관리 (힌트 제출 · 투표 · 최후 반론 · 라이어 정답 제한시간) ─────────
const hintTimers    = new Map();
const voteTimers    = new Map();
const defenseTimers = new Map();
const guessTimers   = new Map();

function clearHintTimer(code) {
  clearTimeout(hintTimers.get(code));
  hintTimers.delete(code);
}

function clearVoteTimer(code) {
  clearTimeout(voteTimers.get(code));
  voteTimers.delete(code);
}

function clearDefenseTimer(code) {
  clearTimeout(defenseTimers.get(code));
  defenseTimers.delete(code);
}

function clearGuessTimer(code) {
  clearTimeout(guessTimers.get(code));
  guessTimers.delete(code);
}

function clearAllTimers(code) {
  clearHintTimer(code);
  clearVoteTimer(code);
  clearDefenseTimer(code);
  clearGuessTimer(code);
}

// ── 투표 제한시간 ─────────────────────────────────────────────────────────────
// 세 투표(voteContinue/voteLiar/confirmAccuse) 공통. 한 명이 자리를 비우면 투표가
// 영원히 채워지지 않아 판이 멈추므로 시간을 두고, 시간이 끝나면 **그때까지 낸 표만으로**
// 집계한다(안 낸 사람은 기권). 표가 갈리거나 하나도 없으면 그 단계에서 아무것도
// 결정되지 않은 것으로 보고 힌트를 한 바퀴 더 돈다 — 재투표로 두면 아무도 없는 방에서
// 무한히 되풀이된다.
function startVoteTimer(io, room) {
  clearVoteTimer(room.code);
  const timeoutMs = (room.voteTimeout || LIAR_VOTE_TIMEOUT) * 1000;
  room.voteDeadline = Date.now() + timeoutMs;
  io.to(room.code).emit('room_update', safeState(room));

  voteTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r) return;
    if      (r.state === 'voteContinue')  tallyContinueVotesIfReady(io, r, true);
    else if (r.state === 'voteLiar')      tallyAccuseVotesIfReady(io, r, true);
    else if (r.state === 'confirmAccuse') tallyConfirmVotesIfReady(io, r, true);
  }, timeoutMs));
}

// 시간이 끝났는데 결론이 나지 않은 경우 — 지목 없이 한 바퀴 더 돈다.
function voteTimedOut(io, room) {
  io.to(room.code).emit('liar_vote_result', { result: 'timeout' });
  backToHint(io, room);
}

function startHintTimer(io, room) {
  clearHintTimer(room.code);
  const timeoutMs = (room.hintTimeout || LIAR_HINT_TIMEOUT) * 1000;
  room.turnDeadline = Date.now() + timeoutMs;
  io.to(room.code).emit('room_update', safeState(room));

  hintTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'hint') return;
    const current = r.players.find(p => p.id === r.currentTurn);
    r.hints.push({ playerId: r.currentTurn, playerName: current?.name ?? '', text: null, skipped: true });
    advanceTurn(io, r);
  }, timeoutMs));
}

// 힌트가 기록된 뒤(제출 또는 시간 초과) 다음 차례로 넘기거나, 한 바퀴 다 돌았으면 투표로 전환
function advanceTurn(io, room) {
  room.currentTurnIndex += 1;
  if (room.currentTurnIndex >= room.turnOrder.length) {
    room.cycleCount += 1;
    clearHintTimer(room.code);
    room.state         = 'voteContinue';
    room.currentTurn   = null;
    room.turnDeadline  = null;
    room.continueVotes = {};
    startVoteTimer(io, room); // room_update 브로드캐스트 포함
    return;
  }
  room.currentTurn = room.turnOrder[room.currentTurnIndex];
  startHintTimer(io, room);
}

// 한 바퀴를 다시 돈다 (한 바퀴 더 / 지목 철회 / 투표 시간 초과 공통 처리)
function backToHint(io, room) {
  clearVoteTimer(room.code);
  room.state            = 'hint';
  room.currentTurnIndex = 0;
  room.currentTurn      = room.turnOrder[0];
  room.accusedId        = null;
  room.voteDeadline     = null;
  startHintTimer(io, room);
}

// ── 투표 집계 ────────────────────────────────────────────────────────────────
// force=true 는 제한시간이 끝나 그때까지 낸 표만으로 집계하는 경우다(안 낸 사람은 기권).
// 전원이 냈을 때는 '많이 나온 쪽'과 '과반'이 같은 뜻이라, 기권을 뺀 득표 비교로 통일한다.
function tallyContinueVotesIfReady(io, room, force = false) {
  const participants = activeParticipants(room);
  const votes        = Object.values(room.continueVotes);
  if (!force && votes.length < participants.length) {
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }

  const accuseCount   = votes.filter(v => v === 'accuse').length;
  const continueCount = votes.filter(v => v === 'continue').length;

  if (accuseCount > continueCount) {
    clearVoteTimer(room.code);
    room.state       = 'voteLiar';
    room.accuseVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'accuse', accuseCount, continueCount });
    startVoteTimer(io, room);
  } else if (continueCount > accuseCount) {
    io.to(room.code).emit('liar_vote_result', { result: 'continue', accuseCount, continueCount });
    backToHint(io, room);
  } else if (force) {
    voteTimedOut(io, room);
  } else {
    // 동률 — 재투표 (제한시간도 다시 준다)
    room.continueVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'tie', accuseCount, continueCount });
    startVoteTimer(io, room);
  }
}

function tallyAccuseVotesIfReady(io, room, force = false) {
  const participants = activeParticipants(room);
  const votes        = Object.values(room.accuseVotes);
  if (!force && votes.length < participants.length) {
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }

  // 시간이 끝났는데 아무도 지목하지 않았으면 지목 없이 한 바퀴 더 돈다.
  if (votes.length === 0) return voteTimedOut(io, room);

  const counts = new Map();
  votes.forEach(targetId => counts.set(targetId, (counts.get(targetId) || 0) + 1));
  const max = Math.max(...counts.values());
  const topTargets = [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);

  if (topTargets.length > 1) {
    if (force) return voteTimedOut(io, room);
    // 동률 — 재투표 (제한시간도 다시 준다)
    room.accuseVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'tie' });
    startVoteTimer(io, room);
    return;
  }

  const [accusedId] = topTargets;
  clearVoteTimer(room.code);
  room.voteDeadline = null;
  room.accusedId    = accusedId;
  room.defenseLines = [];
  const accused = room.players.find(p => p.id === accusedId);

  // 곧바로 결론짓지 않고, 지목된 사람에게 최후 반론 시간을 준다.
  room.state = 'defense';
  io.to(room.code).emit('liar_accused', { accusedId, accusedName: accused?.name ?? '' });
  startDefenseTimer(io, room);
}

function startDefenseTimer(io, room) {
  clearDefenseTimer(room.code);
  const timeoutMs = (room.defenseTimeout || LIAR_DEFENSE_TIMEOUT) * 1000;
  room.defenseDeadline = Date.now() + timeoutMs;
  io.to(room.code).emit('room_update', safeState(room));

  defenseTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'defense') return;
    startConfirmVote(io, r);
  }, timeoutMs));
}

function startConfirmVote(io, room) {
  clearDefenseTimer(room.code);
  room.state          = 'confirmAccuse';
  room.defenseDeadline = null;
  room.confirmVotes    = {};
  startVoteTimer(io, room); // room_update 브로드캐스트 포함
}

function tallyConfirmVotesIfReady(io, room, force = false) {
  const participants = activeParticipants(room);
  const votes        = Object.values(room.confirmVotes);
  if (!force && votes.length < participants.length) {
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }

  const proceedCount  = votes.filter(v => v === 'proceed').length;
  const withdrawCount = votes.filter(v => v === 'withdraw').length;

  if (proceedCount > withdrawCount) {
    clearVoteTimer(room.code);
    room.voteDeadline = null;
    io.to(room.code).emit('liar_vote_result', { result: 'proceed' });
    resolveAccusation(io, room);
  } else if (withdrawCount > proceedCount) {
    io.to(room.code).emit('liar_vote_result', { result: 'withdraw' });
    backToHint(io, room);
  } else if (force) {
    // 시간이 끝났는데 결론이 안 났다 — 지목을 무르고 한 바퀴 더 (사람을 기권으로 몰아내지 않는다)
    voteTimedOut(io, room);
  } else {
    // 동률 — 재투표 (제한시간도 다시 준다)
    room.confirmVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'tie' });
    startVoteTimer(io, room);
  }
}

// 지목이 그대로 진행되면 실제로 라이어였는지 확인한다.
function resolveAccusation(io, room) {
  const accused = room.players.find(p => p.id === room.accusedId);

  if (room.accusedId === room.liarId) {
    room.state = 'liarGuess';
    io.to(room.code).emit('liar_accuse_result', { correct: true, accusedId: room.accusedId, accusedName: accused?.name ?? '' });
    io.to(room.code).emit('room_update', safeState(room));
    emitLiarState(io, room);
    startGuessTimer(io, room);
  } else {
    io.to(room.code).emit('liar_accuse_result', { correct: false, accusedId: room.accusedId, accusedName: accused?.name ?? '' });
    endRound(io, room, 'liar');
  }
}

// 라이어가 제한시간 안에 답을 내지 못하면 시민 승리로 라운드가 끝난다.
function startGuessTimer(io, room) {
  clearGuessTimer(room.code);
  const timeoutMs = (room.guessTimeout || LIAR_GUESS_TIMEOUT) * 1000;
  room.guessDeadline = Date.now() + timeoutMs;
  io.to(room.code).emit('room_update', safeState(room));

  guessTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'liarGuess') return;
    endRound(io, r, 'citizens');
  }, timeoutMs));
}

// ── 라운드 시작 (제시어 배정) ────────────────────────────────────────────────
// 인지형: 캐치마인드 사전에서 무작위로 제시어를 뽑고, 참가자(방장 포함) 중 한 명을
//        라이어로 정한다 — 라이어는 제시어 대신 그 낱말의 **카테고리**만 받는다.
// 바보형: 방장이 넘긴 진짜/가짜 제시어를 쓰고 방장은 진행자로 빠진다. 라이어는 가짜 제시어를
//        진짜인 줄 알고 받는다(자기가 라이어인 줄 모른다 — emitLiarState 의 selfView 참고).
function assignNewRound(io, room, words = null) {
  const unaware      = room.liarMode === 'unaware';
  const participants = participantsOf(room);
  const word      = unaware ? words.realWord : ALL_WORDS[Math.floor(Math.random() * ALL_WORDS.length)];
  const turnOrder = shuffled(participants.map(p => p.id));
  const liarId    = turnOrder[Math.floor(Math.random() * turnOrder.length)];

  // 방장이 낸 낱말은 사전 밖일 수 있으므로 카테고리가 없을 수 있다(바보형은 힌트도 없다).
  const category = unaware ? null : categoryOf(word);
  room.wordCategory = category ? `${category.emoji} ${category.label}` : null;
  room.realWord = word;
  room.fakeWord = unaware ? words.fakeWord : '';
  room.liarId   = liarId;
  // 진행자(방장)에게는 역할도 제시어도 없다 — 남아 있던 지난 라운드 값을 지운다.
  room.players.forEach(p => { p.role = null; p.word = null; });
  participants.forEach(p => {
    p.role = (p.id === liarId) ? 'liar' : 'citizen';
    p.word = (p.id === liarId) ? (unaware ? room.fakeWord : null) : word;
  });

  room.turnOrder        = turnOrder;
  room.currentTurnIndex = 0;
  room.currentTurn      = turnOrder[0];
  room.hints            = []; // 직전 라운드 힌트 기록은 다음 라운드가 시작되는 지금 비운다
  room.cycleCount       = 0;
  room.continueVotes    = {};
  room.accuseVotes      = {};
  room.accusedId        = null;
  room.defenseDeadline  = null;
  room.defenseLines     = [];
  room.confirmVotes     = {};
  room.lastResult        = null;
  room.state             = 'hint';

  emitLiarState(io, room);
  startHintTimer(io, room); // room_update 브로드캐스트 포함
}

// ── 라운드 종료 ────────────────────────────────────────────────────────────────
// 먼저 '라운드 무효' — 라이어(또는 바보형 진행자)가 나가는 등 라운드 자체가 성립하지
// 않게 된 경우다. 승패를 남기지 않고 대기실로 되돌리며, 결과를 밝힐 수 없으므로 힌트
// 기록도 함께 지운다(정상 종료인 endRound 는 힌트·결과를 대기실에 남겨둔다).
function cancelRound(room) {
  clearAllTimers(room.code);
  room.state            = 'lobby';
  room.realWord         = '';
  room.fakeWord         = '';
  room.wordCategory     = null;
  room.liarId           = null;
  room.turnOrder        = [];
  room.currentTurnIndex = 0;
  room.currentTurn      = null;
  room.turnDeadline     = null;
  room.hints            = [];
  room.cycleCount       = 0;
  room.continueVotes    = {};
  room.accuseVotes      = {};
  room.accusedId        = null;
  room.defenseDeadline  = null;
  room.defenseLines     = [];
  room.confirmVotes     = {};
  room.voteDeadline     = null;
  room.guessDeadline    = null;
  room.lastResult       = null;
  // 준비 상태는 유지한다 — 라운드를 이어서 도는 게임이라 매판 다시 누르게 하면 번거롭다.
  room.players.forEach(p => { p.role = null; p.word = null; });
}

// liarGuess: 라이어가 실제로 제출한 답 (틀린 지목으로 라운드가 끝나 라이어가 답을
// 낼 기회조차 없었으면 null) — 실시간 미리보기를 놓친 사람도 결과 배너에서 볼 수 있게.
// 힌트 기록(room.hints)은 여기서 지우지 않는다 — 다음 라운드가 시작될 때(assignNewRound)
// 비워지므로, 대기실로 돌아간 사이에도 직전 라운드 힌트를 계속 볼 수 있다.
function endRound(io, room, winnerRole, liarGuess = null) {
  clearAllTimers(room.code);
  const participants = participantsOf(room); // 바보형 진행자(방장)는 전적에 남기지 않는다
  const liar          = room.players.find(p => p.id === room.liarId);

  recordPlayers(room.serverId, 'liar', participants,
    p => (p.id === room.liarId) === (winnerRole === 'liar') ? 'win' : 'lose',
    () => 0,
  );

  participants.forEach(p => {
    const won = (p.id === room.liarId) === (winnerRole === 'liar');
    if (won) p.wins = (p.wins || 0) + 1;
  });

  room.lastResult = {
    winnerRole,
    liarName: liar?.name ?? '',
    realWord: room.realWord,
    // 바보형에서만 채워진다 — 라이어가 진짜인 줄 알고 받았던 낱말도 함께 밝힌다.
    fakeWord: room.fakeWord || null,
    liarGuess,
  };

  room.state          = 'lobby';
  room.currentTurn    = null;
  room.turnDeadline   = null;
  room.continueVotes  = {};
  room.accuseVotes    = {};
  room.accusedId      = null;
  room.defenseDeadline = null;
  room.defenseLines    = [];
  room.confirmVotes    = {};
  room.voteDeadline    = null;
  room.guessDeadline   = null;
  // 준비 상태는 그대로 둔다 — 대기실로 돌아온 즉시 방장이 다음 라운드를 시작할 수 있게.
  // (새로 들어온 사람만 준비를 눌러야 하고, 빠지고 싶으면 준비를 취소하면 된다)
  room.players.forEach(p => { p.role = null; p.word = null; });

  io.to(room.code).emit('liar_result', room.lastResult);
  io.to(room.code).emit('room_update', safeState(room));
  emitLiarState(io, room);
}

export function registerLiarHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame, registerLeaveFlow } =
    registerCommonHandlers(io, socket, manager, {
      roomsEvent:    'liar_rooms_update',
      spectateCheck: 'notLobby',
      joinPlayerFields: () => ({ role: null, word: null, wins: 0 }),
    });

  // ── 게임 시작 ───────────────────────────────────────────────────────────────
  // 인지형: 전원 준비 완료 후 방장이 누르면 방장을 포함한 전원에게 제시어를 자동 배정한다.
  // 바보형: 방장이 함께 보낸 진짜/가짜 제시어를 쓴다. 제시어는 여기서만 받고 방 상태로는
  //        절대 내보내지 않는다(safeState 에 없음) — 대기실에 미리 저장해 두면 새어 나간다.
  socket.on('start_game', ({ realWord, fakeWord } = {}) => {
    const { ok, room } = validateStartGame();
    if (!ok) return;

    let words = null;
    if (room.liarMode === 'unaware') {
      // 방장은 진행자로 빠지므로 최소 인원은 방장을 뺀 참가자 기준으로 센다.
      if (participantsOf(room).length < LIAR_MIN_PLAYERS) {
        return err(`바보형은 방장을 뺀 참가자가 ${LIAR_MIN_PLAYERS}명 이상이어야 합니다.`);
      }
      const real = String(realWord || '').trim().slice(0, 20);
      const fake = String(fakeWord || '').trim().slice(0, 20);
      if (!real || !fake) return err('진짜 제시어와 가짜 제시어를 모두 입력해주세요.');
      if (real === fake)  return err('진짜 제시어와 가짜 제시어가 서로 달라야 합니다.');
      words = { realWord: real, fakeWord: fake };
    }

    room.players.forEach(p => { p.wins = 0; });
    assignNewRound(io, room, words);
    broadcastRooms();
    io.to(room.code).emit('game_started');
  });

  // ── 라이어 유형 (방장, 대기실에서만 변경) ───────────────────────────────────
  // 유형에 따라 방장이 참가자인지 진행자인지가 갈리므로 라운드 중에는 바꿀 수 없다.
  socket.on('set_liar_mode', ({ mode } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost || room.state !== 'lobby') return;
    if (mode !== 'aware' && mode !== 'unaware') return;

    room.liarMode = mode;
    broadcast(room);
  });

  // ── 제한시간 조절 (방장, 대기실에서 언제든 변경 가능) ───────────────────────
  socket.on('set_hint_timeout', ({ seconds } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost) return;

    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 15 || value > 60) return err('힌트 제한시간은 15~60초 사이여야 합니다.');

    room.hintTimeout = Math.round(value);
    broadcast(room);
  });

  socket.on('set_defense_timeout', ({ seconds } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost) return;

    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 10 || value > 120) return err('반론 제한시간은 10~120초 사이여야 합니다.');

    room.defenseTimeout = Math.round(value);
    broadcast(room);
  });

  socket.on('set_vote_timeout', ({ seconds } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost) return;

    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 10 || value > 120) return err('투표 제한시간은 10~120초 사이여야 합니다.');

    room.voteTimeout = Math.round(value);
    broadcast(room);
  });

  socket.on('set_guess_timeout', ({ seconds } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost) return;

    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 10 || value > 60) return err('정답 제한시간은 10~60초 사이여야 합니다.');

    room.guessTimeout = Math.round(value);
    broadcast(room);
  });

  // ── 힌트 제출 (현재 차례인 사람만) ──────────────────────────────────────────
  socket.on('submit_hint', ({ text } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'hint') return;
    if (room.currentTurn !== socket.id) return err('지금 내 차례가 아닙니다.');

    const clean = String(text || '').trim().slice(0, 40);
    if (!clean) return err('힌트를 입력해주세요.');

    const player = room.players.find(p => p.id === socket.id);
    room.hints.push({ playerId: socket.id, playerName: player?.name ?? '', text: clean, skipped: false });
    advanceTurn(io, room);
  });

  // ── 투표 1: 라이어 지목 vs 한 바퀴 더 ───────────────────────────────────────
  // (바보형 방장은 진행자라 참가자 목록에 없으므로 투표할 수 없다)
  socket.on('cast_continue_vote', ({ choice } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room && participantsOf(room).find(p => p.id === socket.id);
    if (!room || !player)              return;
    if (room.state !== 'voteContinue') return;
    if (choice !== 'accuse' && choice !== 'continue') return;

    room.continueVotes[socket.id] = choice;
    tallyContinueVotesIfReady(io, room);
  });

  // ── 투표 2: 라이어로 지목할 사람 ─────────────────────────────────────────────
  socket.on('cast_accuse_vote', ({ targetId } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room && participantsOf(room).find(p => p.id === socket.id);
    if (!room || !player)          return;
    if (room.state !== 'voteLiar') return;
    if (!participantsOf(room).some(p => p.id === targetId)) return;

    room.accuseVotes[socket.id] = targetId;
    tallyAccuseVotesIfReady(io, room);
  });

  // ── 투표 3: 지목된 사람의 반론 이후 — 그대로 진행 vs 철회 ───────────────────
  socket.on('cast_confirm_vote', ({ choice } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room && participantsOf(room).find(p => p.id === socket.id);
    if (!room || !player)               return;
    if (room.state !== 'confirmAccuse') return;
    if (choice !== 'proceed' && choice !== 'withdraw') return;

    room.confirmVotes[socket.id] = choice;
    tallyConfirmVotesIfReady(io, room);
  });

  // ── 최후 반론 (지목된 사람만, defense 단계에서만) ───────────────────────────
  // 토스트 입력창에 한 줄씩 적으면 일기처럼 쌓여 모두에게 실시간으로 보인다.
  socket.on('submit_defense_line', ({ text } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'defense') return;
    if (socket.id !== room.accusedId) return err('지목된 사람만 반론을 적을 수 있습니다.');

    const clean = String(text || '').trim().slice(0, 80);
    if (!clean) return;

    room.defenseLines.push({ text: clean });
    if (room.defenseLines.length > 20) room.defenseLines.shift();
    io.to(room.code).emit('room_update', safeState(room));
  });

  // ── 반론 종료 (지목된 사람이 직접, 남은 시간 상관없이 즉시 다음 단계로) ────
  socket.on('end_defense', () => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'defense') return;
    if (socket.id !== room.accusedId) return err('지목된 사람만 반론을 끝낼 수 있습니다.');

    startConfirmVote(io, room);
  });

  // ── 라이어의 마지막 기회: 진짜 제시어 맞히기 ────────────────────────────────
  // 입력 중인 글자를 실시간으로 다른 사람들에게도 보여준다 (제출 전, 미리보기).
  socket.on('submit_guess_typing', ({ text } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'liarGuess') return;
    if (socket.id !== room.liarId) return;

    socket.to(room.code).emit('liar_guess_typing', { text: String(text || '').slice(0, 20) });
  });

  socket.on('submit_liar_guess', ({ guess } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'liarGuess') return;
    if (socket.id !== room.liarId) return err('라이어만 정답을 맞힐 수 있습니다.');

    const clean = String(guess || '').trim();
    const correct = !!clean && clean === room.realWord;
    endRound(io, room, correct ? 'liar' : 'citizens', clean);
  });

  // ── 대기실로 나가기 (방장 전용, 게임 도중 언제든 라운드를 중단) ─────────────
  socket.on('return_to_lobby', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost || room.state === 'lobby') return;

    cancelRound(room);
    broadcast(room);
    broadcastRooms();
  });

  // ── 투표 중 누군가 끊기면 즉시 다시 집계한다 ─────────────────────────────────
  // (재접속 유예 90초를 다 기다리면 그 사람 몫만큼 투표가 영원히 안 채워진 것처럼 보인다)
  function recheckVoteOnDisconnect(room) {
    if (room.state === 'voteContinue')     tallyContinueVotesIfReady(io, room);
    else if (room.state === 'voteLiar')    tallyAccuseVotesIfReady(io, room);
    else if (room.state === 'confirmAccuse') tallyConfirmVotesIfReady(io, room);
  }

  // ── 방 이탈 ─────────────────────────────────────────────────────────────────
  function leaveRoom(id) {
    const spectatorRoom = manager.getRoomOfSpectator(id);
    if (spectatorRoom) {
      removeSpectator(spectatorRoom, id);
      io.to(spectatorRoom.code).emit('room_update', safeState(spectatorRoom));
      broadcastRooms();
      return;
    }

    const room = getRoomOf(id);
    if (!room) return;

    const wasInRound = room.state !== 'lobby';
    const result      = removePlayer(room, id);

    // 인원 미달 — 승패 기록 없이 대기실로 되돌아간다.
    if (result.deleted) { clearAllTimers(room.code); broadcastRooms(); return; }
    if (result.alone) {
      clearAllTimers(room.code);
      if (wasInRound) io.to(result.remainingId).emit('alone_in_room', { message: `${result.leaverName}님이 나가 혼자 남았습니다.` });
      io.to(room.code).emit('room_update', safeState(room));
      broadcastRooms();
      return;
    }

    // 라운드가 성립하지 않게 되는 경우들 — 승패 기록 없이 대기실로 되돌린다.
    //   · 라이어가 나감 (정체가 성립하지 않는다)
    //   · 바보형에서 제시어를 쥐고 있던 진행자(방장)가 나감
    //   · 바보형에서 방장을 뺀 참가자가 최소 인원 아래로 떨어짐
    //     (방 인원 기준인 공통 로직의 minPlayers 검사로는 걸리지 않는다)
    const unaware = room.liarMode === 'unaware';
    const reason = result.wasLiar ? 'liar'
                 : (unaware && result.wasHost) ? 'host'
                 : (unaware && participantsOf(room).length < LIAR_MIN_PLAYERS) ? 'tooFew'
                 : null;
    if (wasInRound && reason) {
      cancelRound(room);
      io.to(room.code).emit('round_cancelled', { reason });
      io.to(room.code).emit('room_update', safeState(room));
      broadcastRooms();
      return;
    }

    if (room.state === 'hint') {
      if (result.wasCurrentTurn) {
        const idx = room.turnOrder.indexOf(room.currentTurn);
        room.currentTurnIndex = idx >= 0 ? idx : 0;
        room.currentTurn      = room.turnOrder[room.currentTurnIndex] ?? null;
        if (room.currentTurn) startHintTimer(io, room);
      } else {
        io.to(room.code).emit('room_update', safeState(room));
      }
    } else if (room.state === 'voteContinue' || room.state === 'voteLiar' || room.state === 'confirmAccuse') {
      recheckVoteOnDisconnect(room);
    } else {
      io.to(room.code).emit('room_update', safeState(room));
    }
    broadcastRooms();
  }

  registerLeaveFlow(leaveRoom, {
    // 끊긴 그 순간 바로 표시해 두고, 지금 투표 중이었다면 그 사람 없이 즉시 재집계한다
    // (재접속 유예 90초를 다 기다리지 않아도 되게). 아직 markDisconnected 가 돌기 전이라
    // 직접 표시해 둔다 — 뒤이어 한 번 더 표시돼도 안전하다(멱등).
    immediate: () => {
      const room   = getRoomOf(socket.id);
      const player = room?.players.find(p => p.id === socket.id);
      if (!room || !player) return;
      player.disconnected = true;
      recheckVoteOnDisconnect(room);
    },
    onResume: (room) => { if (room.state !== 'lobby') emitLiarState(io, room); },
    // 힌트·투표가 실시간으로 맞물려 돌아가므로 공용 90초 유예 대신 60초만 기다린다.
    graceMs: LIAR_RECONNECT_GRACE_MS,
  });
}
