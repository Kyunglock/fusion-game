import { rooms, getRoomOf, safeState, removePlayer, removeSpectator, manager, activeParticipants } from './rooms.js';
import { LIAR_HINT_TIMEOUT } from '../../config.js';
import { registerCommonHandlers } from '../../shared/socketHandlers.js';
import { recordPlayers } from '../../db/stats.js';

const DEFENSE_TIMEOUT_MS = 10_000; // 라이어로 지목된 사람의 최후 반론 시간

// ── 뷰어별 개인화 상태 전송 ──────────────────────────────────────────────────
// 방장·관전자는 참가자 전원의 역할·제시어를 볼 수 있고, 참가자는 자신의 제시어만 본다.
function emitLiarState(io, room) {
  const inRound = room.state === 'hint' || room.state === 'voteContinue' ||
                  room.state === 'voteLiar' || room.state === 'defense' ||
                  room.state === 'confirmAccuse' || room.state === 'liarGuess';
  const participants = room.players.filter(p => !p.isHost);
  const hostIds = room.players.filter(p => p.isHost).map(p => p.id);
  const privileged = new Set([...hostIds, ...room.spectators.map(s => s.id)]);
  const viewers = [...room.players.map(p => p.id), ...room.spectators.map(s => s.id)];

  viewers.forEach(viewerId => {
    if (privileged.has(viewerId)) {
      io.to(viewerId).emit('liar_state', {
        all: inRound ? participants.map(p => ({ id: p.id, name: p.name, role: p.role, word: p.word })) : [],
      });
    } else {
      const me = participants.find(p => p.id === viewerId);
      io.to(viewerId).emit('liar_state', {
        me: (inRound && me) ? { role: me.role, word: me.word } : null,
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

// ── 타이머 관리 (힌트 제출 · 최후 반론 제한시간) ──────────────────────────────
const hintTimers    = new Map();
const defenseTimers = new Map();

function clearHintTimer(code) {
  clearTimeout(hintTimers.get(code));
  hintTimers.delete(code);
}

function clearDefenseTimer(code) {
  clearTimeout(defenseTimers.get(code));
  defenseTimers.delete(code);
}

function clearAllTimers(code) {
  clearHintTimer(code);
  clearDefenseTimer(code);
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
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }
  room.currentTurn = room.turnOrder[room.currentTurnIndex];
  startHintTimer(io, room);
}

// 한 바퀴를 다시 돈다 (한 바퀴 더 / 지목 철회 공통 처리)
function backToHint(io, room) {
  room.state            = 'hint';
  room.currentTurnIndex = 0;
  room.currentTurn      = room.turnOrder[0];
  room.accusedId        = null;
  startHintTimer(io, room);
}

// ── 투표 집계 ────────────────────────────────────────────────────────────────
function tallyContinueVotesIfReady(io, room) {
  const participants = activeParticipants(room);
  if (Object.keys(room.continueVotes).length < participants.length) {
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }

  const accuseCount   = Object.values(room.continueVotes).filter(v => v === 'accuse').length;
  const continueCount = participants.length - accuseCount;

  if (accuseCount * 2 > participants.length) {
    room.state       = 'voteLiar';
    room.accuseVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'accuse', accuseCount, continueCount });
    io.to(room.code).emit('room_update', safeState(room));
  } else if (continueCount * 2 > participants.length) {
    io.to(room.code).emit('liar_vote_result', { result: 'continue', accuseCount, continueCount });
    backToHint(io, room);
  } else {
    // 동률 — 재투표
    room.continueVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'tie', accuseCount, continueCount });
    io.to(room.code).emit('room_update', safeState(room));
  }
}

function tallyAccuseVotesIfReady(io, room) {
  const participants = activeParticipants(room);
  if (Object.keys(room.accuseVotes).length < participants.length) {
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }

  const counts = new Map();
  Object.values(room.accuseVotes).forEach(targetId => counts.set(targetId, (counts.get(targetId) || 0) + 1));
  const max = Math.max(...counts.values());
  const topTargets = [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);

  if (topTargets.length > 1) {
    // 동률 — 재투표
    room.accuseVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'tie' });
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }

  const [accusedId] = topTargets;
  room.accusedId    = accusedId;
  room.defenseLines = [];
  const accused = room.players.find(p => p.id === accusedId);

  // 곧바로 결론짓지 않고, 지목된 사람에게 최후 반론 시간을 준다.
  room.state = 'defense';
  console.log(`[liar-debug] entering defense room=${room.code} accusedId=${accusedId} accusedName=${accused?.name}`);
  io.to(room.code).emit('liar_accused', { accusedId, accusedName: accused?.name ?? '' });
  startDefenseTimer(io, room);
}

function startDefenseTimer(io, room) {
  clearDefenseTimer(room.code);
  room.defenseDeadline = Date.now() + DEFENSE_TIMEOUT_MS;
  io.to(room.code).emit('room_update', safeState(room));

  defenseTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'defense') return;
    startConfirmVote(io, r);
  }, DEFENSE_TIMEOUT_MS));
}

function startConfirmVote(io, room) {
  clearDefenseTimer(room.code);
  room.state          = 'confirmAccuse';
  room.defenseDeadline = null;
  room.confirmVotes    = {};
  io.to(room.code).emit('room_update', safeState(room));
}

function tallyConfirmVotesIfReady(io, room) {
  const participants = activeParticipants(room);
  if (Object.keys(room.confirmVotes).length < participants.length) {
    io.to(room.code).emit('room_update', safeState(room));
    return;
  }

  const proceedCount  = Object.values(room.confirmVotes).filter(v => v === 'proceed').length;
  const withdrawCount = participants.length - proceedCount;

  if (proceedCount * 2 > participants.length) {
    io.to(room.code).emit('liar_vote_result', { result: 'proceed' });
    resolveAccusation(io, room);
  } else if (withdrawCount * 2 > participants.length) {
    io.to(room.code).emit('liar_vote_result', { result: 'withdraw' });
    backToHint(io, room);
  } else {
    // 동률 — 재투표
    room.confirmVotes = {};
    io.to(room.code).emit('liar_vote_result', { result: 'tie' });
    io.to(room.code).emit('room_update', safeState(room));
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
  } else {
    io.to(room.code).emit('liar_accuse_result', { correct: false, accusedId: room.accusedId, accusedName: accused?.name ?? '' });
    endRound(io, room, 'liar');
  }
}

// ── 라운드 종료 ────────────────────────────────────────────────────────────────
function endRound(io, room, winnerRole) {
  clearAllTimers(room.code);
  const participants = room.players.filter(p => !p.isHost);
  const liar          = room.players.find(p => p.id === room.liarId);

  recordPlayers('liar', participants,
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
    liarWord: room.liarWord,
  };

  room.state          = 'wordSetup';
  room.currentTurn    = null;
  room.turnDeadline   = null;
  room.hints          = [];
  room.continueVotes  = {};
  room.accuseVotes    = {};
  room.accusedId      = null;
  room.defenseDeadline = null;
  room.defenseLines    = [];
  room.confirmVotes    = {};

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
  // 대기실 → 제시어 입력 대기(wordSetup). 자모 워들과 동일하게 방장은 게임 화면
  // 안에서 직접 제시어(진짜/가짜)를 낸다.
  socket.on('start_game', () => {
    const { ok, room } = validateStartGame();
    if (!ok) return;

    room.state = 'wordSetup';
    room.players.forEach(p => { p.ready = false; p.role = null; p.word = null; p.wins = 0; });
    room.lastResult = null;

    broadcast(room);
    broadcastRooms();
  });

  // ── 힌트 제한시간 조절 (방장, 언제든 변경 가능 — 다음 차례부터 적용) ───────
  socket.on('set_hint_timeout', ({ seconds } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost) return;

    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 15 || value > 60) return err('힌트 제한시간은 15~60초 사이여야 합니다.');

    room.hintTimeout = Math.round(value);
    broadcast(room);
  });

  // ── 제시어 출제 (방장, 진짜/가짜 제시어 둘 다 직접 입력) ───────────────────
  socket.on('set_words', ({ realWord, liarWord } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost)   return;
    if (room.state !== 'wordSetup') return;

    const participants = room.players.filter(p => !p.isHost);
    if (participants.length < 3) return err('참가자가 최소 3명 필요합니다.');

    const real = String(realWord || '').trim();
    const liar = String(liarWord || '').trim();
    if (!real || !liar) return err('진짜 제시어와 라이어 제시어를 모두 입력해주세요.');
    if (real === liar) return err('두 제시어는 서로 달라야 합니다.');

    room.realWord = real;
    room.liarWord = liar;

    const turnOrder = shuffled(participants.map(p => p.id));
    const liarId    = turnOrder[Math.floor(Math.random() * turnOrder.length)];
    room.liarId = liarId;

    participants.forEach(p => {
      p.role = (p.id === liarId) ? 'liar' : 'citizen';
      p.word = (p.id === liarId) ? liar   : real;
    });

    room.turnOrder        = turnOrder;
    room.currentTurnIndex = 0;
    room.currentTurn      = turnOrder[0];
    room.hints            = [];
    room.cycleCount        = 0;
    room.continueVotes    = {};
    room.accuseVotes      = {};
    room.accusedId        = null;
    room.defenseDeadline   = null;
    room.defenseLines      = [];
    room.confirmVotes      = {};
    room.lastResult        = null;
    room.state             = 'hint';

    broadcastRooms();
    emitLiarState(io, room);
    startHintTimer(io, room); // room_update 브로드캐스트 포함
  });

  // ── 힌트 제출 (현재 차례인 참가자만) ────────────────────────────────────────
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
  socket.on('cast_continue_vote', ({ choice } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || player.isHost)    return;
    if (room.state !== 'voteContinue')        return;
    if (choice !== 'accuse' && choice !== 'continue') return;

    room.continueVotes[socket.id] = choice;
    tallyContinueVotesIfReady(io, room);
  });

  // ── 투표 2: 라이어로 지목할 사람 ─────────────────────────────────────────────
  socket.on('cast_accuse_vote', ({ targetId } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || player.isHost) return;
    if (room.state !== 'voteLiar')         return;
    if (!room.players.some(p => !p.isHost && p.id === targetId)) return;

    room.accuseVotes[socket.id] = targetId;
    tallyAccuseVotesIfReady(io, room);
  });

  // ── 투표 3: 지목된 사람의 반론 이후 — 그대로 진행 vs 철회 ───────────────────
  socket.on('cast_confirm_vote', ({ choice } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || player.isHost)  return;
    if (room.state !== 'confirmAccuse')     return;
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

  // ── 라이어의 마지막 기회: 진짜 제시어 맞히기 ────────────────────────────────
  socket.on('submit_liar_guess', ({ guess } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'liarGuess') return;
    if (socket.id !== room.liarId) return err('라이어만 정답을 맞힐 수 있습니다.');

    const clean = String(guess || '').trim();
    const correct = !!clean && clean === room.realWord;
    endRound(io, room, correct ? 'liar' : 'citizens');
  });

  // ── 대기실로 나가기 (방장 전용) ─────────────────────────────────────────────
  socket.on('return_to_lobby', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost || room.state === 'lobby') return;

    clearAllTimers(room.code);
    room.state = 'lobby';
    room.realWord = ''; room.liarWord = ''; room.liarId = null;
    room.turnOrder = []; room.currentTurnIndex = 0; room.currentTurn = null; room.turnDeadline = null;
    room.hints = []; room.cycleCount = 0; room.continueVotes = {}; room.accuseVotes = {};
    room.accusedId = null; room.defenseDeadline = null; room.defenseLines = []; room.confirmVotes = {};
    room.lastResult = null;
    room.players.forEach(p => { p.ready = false; p.role = null; p.word = null; });

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

    const wasInRound = room.state !== 'lobby' && room.state !== 'wordSetup';
    const result      = removePlayer(room, id);

    // 인원 미달(방장+최소 인원 아래로 떨어짐) — 승패 기록 없이 대기실로 되돌아간다.
    if (result.deleted) { clearAllTimers(room.code); broadcastRooms(); return; }
    if (result.alone) {
      clearAllTimers(room.code);
      if (wasInRound) io.to(result.remainingId).emit('alone_in_room', { message: `${result.leaverName}님이 나가 혼자 남았습니다.` });
      io.to(room.code).emit('room_update', safeState(room));
      broadcastRooms();
      return;
    }

    // 라이어가 나가면 라운드 자체가 성립하지 않으므로 무효 처리하고 다음 라운드를 준비시킨다.
    if (wasInRound && result.wasLiar) {
      clearAllTimers(room.code);
      room.state = 'wordSetup';
      room.currentTurn = null; room.turnDeadline = null;
      room.hints = []; room.continueVotes = {}; room.accuseVotes = {};
      room.accusedId = null; room.defenseDeadline = null; room.defenseLines = []; room.confirmVotes = {};
      room.lastResult = null;
      io.to(room.code).emit('round_cancelled');
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
      console.log(`[liar disconnect] ${socket.id}`);
      const room   = getRoomOf(socket.id);
      const player = room?.players.find(p => p.id === socket.id);
      if (!room || !player) return;
      player.disconnected = true;
      recheckVoteOnDisconnect(room);
    },
    onResume: (room) => { if (room.state !== 'lobby') emitLiarState(io, room); },
  });
}
