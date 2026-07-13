import { decompose, judge, keyboardFromAttempts } from './jamoLogic.js';
import { rooms, getRoomOf, getRooms, safeState, removePlayer, removeSpectator, manager } from './rooms.js';
import { JAMO_MAX_ATTEMPTS, JAMO_RETURN_DELAY } from '../../config.js';
import { registerCommonHandlers } from '../../shared/socketHandlers.js';

// ── 타이머 관리 ───────────────────────────────────────────────────────────────
const returnTimers = new Map();

function clearReturnTimer(code) {
  clearTimeout(returnTimers.get(code));
  returnTimers.delete(code);
}

function startReturnTimer(io, room) {
  clearReturnTimer(room.code);
  returnTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'roundEnd') return;
    r.state        = 'lobby';
    r.answer       = '';
    r.answerJamo   = [];
    r.winnerName   = null;
    r.players.forEach(p => { p.ready = false; p.attempts = []; p.solved = false; });
    io.to(r.code).emit('room_update', safeState(r));
    io.emit('jamo_rooms_update', getRooms());
  }, JAMO_RETURN_DELAY * 1000));
}

// ── 뷰어별 개인화 상태 전송 ──────────────────────────────────────────────────
// 방장/관전자는 모든 시도 내용을 볼 수 있고, 참가자는 자신의 시도만 전체 공개,
// 다른 참가자의 시도는 색깔 결과(result)만 보이고 단어/자모는 마스킹된다.
function emitGameState(io, room) {
  const privileged = new Set(room.players.filter(p => p.isHost).map(p => p.id));
  room.spectators.forEach(s => privileged.add(s.id));

  const viewers = [...room.players.map(p => p.id), ...room.spectators.map(s => s.id)];

  viewers.forEach(viewerId => {
    const canSeeAll = privileged.has(viewerId);
    const players = room.players.map(p => {
      const revealAll = canSeeAll || p.id === viewerId;
      const attempts = revealAll
        ? p.attempts
        : p.attempts.map(a => ({ word: '', jamo: Array(room.answerJamo.length).fill(''), result: a.result }));
      return { id: p.id, attempts };
    });

    const me = room.players.find(p => p.id === viewerId);
    io.to(viewerId).emit('jamo_state', {
      players,
      myKeyboard: me ? keyboardFromAttempts(me.attempts) : {},
    });
  });
}

export function registerJamoHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame } =
    registerCommonHandlers(io, socket, manager, {
      roomsEvent:    'jamo_rooms_update',
      spectateCheck: 'notLobby',
      joinPlayerFields: () => ({ attempts: [], solved: false, score: 0, wins: 0 }),
    });

  // ── 게임 시작 (방장이 제시어를 입력) ────────────────────────────────────────
  socket.on('start_game', ({ answer } = {}) => {
    const { ok, room } = validateStartGame();
    if (!ok) return;

    const cleanAnswer = String(answer || '').trim();
    if (!cleanAnswer) return err('제시어를 입력해주세요.');

    const answerJamo = decompose(cleanAnswer);
    if (answerJamo.length < 1) return err('제시어 자모 길이가 이상합니다.');

    room.answer     = cleanAnswer;
    room.answerJamo = answerJamo;
    room.winnerName = null;
    room.state      = 'playing';
    room.players.forEach(p => { p.attempts = []; p.solved = false; p.ready = false; });

    broadcast(room);
    broadcastRooms();
    emitGameState(io, room);
  });

  // ── 참가자 키보드 표시 토글 (방장 전용) ─────────────────────────────────────
  socket.on('toggle_keyboard_visible', ({ visible } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost) return;
    room.keyboardVisible = !!visible;
    broadcast(room);
  });

  // ── 답 제출 ──────────────────────────────────────────────────────────────
  socket.on('submit_guess', ({ guess } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.solved) return;
    if (player.attempts.length >= JAMO_MAX_ATTEMPTS) return err(`이미 ${JAMO_MAX_ATTEMPTS}번 모두 시도했습니다.`);

    const cleanGuess = String(guess || '').trim();
    if (!cleanGuess) return err('답을 입력해주세요.');

    const guessJamo = decompose(cleanGuess);
    if (guessJamo.length !== room.answerJamo.length) {
      return err(`자모 개수가 맞지 않습니다. 이 문제는 ${room.answerJamo.length}칸입니다.`);
    }

    const result = judge(room.answerJamo, guessJamo);
    const solved = result.every(r => r === 'green');
    player.attempts.push({ word: cleanGuess, jamo: guessJamo, result });

    if (solved) {
      player.solved = true;

      // 방장의 테스트 정답은 게임 종료/점수/승수에 영향을 주지 않는다.
      if (!player.isHost) {
        player.wins     = (player.wins  || 0) + 1;
        player.score    = (player.score || 0) + Math.max(1, 6 - player.attempts.length);
        room.state      = 'roundEnd';
        room.winnerName = player.name;
      }
    }

    if (room.state !== 'roundEnd') {
      const participants = room.players.filter(p => !p.isHost);
      const allDone = participants.length > 0 && participants.every(p => p.attempts.length >= JAMO_MAX_ATTEMPTS);
      if (allDone) room.state = 'roundEnd';
    }

    if (room.state === 'roundEnd') {
      io.to(room.code).emit('room_update', { ...safeState(room), answer: room.answer, winnerName: room.winnerName });
      broadcastRooms();
      startReturnTimer(io, room);
    } else {
      broadcast(room);
    }
    emitGameState(io, room);
  });

  // ── 관전 입장 시 진행 중인 게임 상태도 함께 전송 ────────────────────────────
  socket.on('join_as_spectator', () => {
    const room = manager.getRoomOfSpectator(socket.id);
    if (room && room.state !== 'lobby') emitGameState(io, room);
  });

  // ── 연결 끊김 ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[jamo disconnect] ${socket.id}`);

    const spectatorRoom = manager.getRoomOfSpectator(socket.id);
    if (spectatorRoom) {
      removeSpectator(spectatorRoom, socket.id);
      io.to(spectatorRoom.code).emit('room_update', safeState(spectatorRoom));
      broadcastRooms();
      return;
    }

    const room = getRoomOf(socket.id);
    if (!room) return;

    clearReturnTimer(room.code);

    const wasPlaying = room.state === 'playing' || room.state === 'roundEnd';
    const result = removePlayer(room, socket.id);

    if (result.deleted) { broadcastRooms(); return; }

    if (result.alone && wasPlaying) {
      io.to(result.remainingId).emit('alone_in_room', { message: `${result.leaverName}님이 나가 혼자 남았습니다.` });
    }
    io.to(room.code).emit('room_update', safeState(room));
    broadcastRooms();
  });
}
