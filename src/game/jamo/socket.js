import { decompose, judge, keyboardFromAttempts } from './jamoLogic.js';
import { rooms, getRoomOf, getRooms, safeState, removePlayer, removeSpectator, manager } from './rooms.js';
import { JAMO_MAX_ATTEMPTS } from '../../config.js';
import { registerCommonHandlers } from '../../shared/socketHandlers.js';

// ── 뷰어별 개인화 상태 전송 ──────────────────────────────────────────────────
// 방장/관전자는 모든 시도 내용을 볼 수 있고, 참가자는 자신의 시도만 전체 공개,
// 다른 참가자의 시도는 색깔 결과(result)만 보이고 단어/자모는 마스킹된다.
// 방장은 게임에 참여하지 않으므로 보드가 없다 → 참가자(non-host)만 전송한다.
function emitGameState(io, room) {
  const privileged = new Set(room.players.filter(p => p.isHost).map(p => p.id));
  room.spectators.forEach(s => privileged.add(s.id));

  const viewers = [...room.players.map(p => p.id), ...room.spectators.map(s => s.id)];

  viewers.forEach(viewerId => {
    const canSeeAll = privileged.has(viewerId);
    const players = room.players.filter(p => !p.isHost).map(p => {
      const revealAll = canSeeAll || p.id === viewerId;
      const attempts = revealAll
        ? p.attempts
        : p.attempts.map(a => ({ word: '', jamo: Array(room.answerJamo.length).fill(''), result: a.result }));
      return { id: p.id, attempts };
    });

    const me = room.players.find(p => p.id === viewerId);
    io.to(viewerId).emit('jamo_state', {
      players,
      myKeyboard: (me && !me.isHost) ? keyboardFromAttempts(me.attempts) : {},
    });
  });
}

// 라운드 종료 판정: 참가자(non-host) 전원이 정답을 맞혔거나 시도를 모두 소진했는지
function allParticipantsDone(room) {
  const participants = room.players.filter(p => !p.isHost);
  return participants.length > 0 &&
    participants.every(p => p.solved || p.attempts.length >= JAMO_MAX_ATTEMPTS);
}

export function registerJamoHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame } =
    registerCommonHandlers(io, socket, manager, {
      roomsEvent:    'jamo_rooms_update',
      spectateCheck: 'notLobby',
      joinPlayerFields: () => ({ attempts: [], solved: false, score: 0, wins: 0 }),
    });

  // ── 게임 시작 ───────────────────────────────────────────────────────────────
  // 대기실 → 게임 화면(라운드 대기). 제시어는 게임 안에서 방장이 낸다.
  socket.on('start_game', () => {
    const { ok, room } = validateStartGame();
    if (!ok) return;

    room.answer     = '';
    room.answerJamo = [];
    room.winnerName = null;
    room.state      = 'intermission';
    room.players.forEach(p => {
      p.attempts = []; p.solved = false; p.ready = false;
      p.score = 0; p.wins = 0;
    });

    broadcast(room);
    broadcastRooms();
    emitGameState(io, room);
  });

  // ── 제시어 출제 (방장, 게임 안에서 연속으로) ───────────────────────────────
  // intermission(라운드 대기) → playing(라운드 진행)
  socket.on('set_answer', ({ answer } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost)     return;
    if (room.state !== 'intermission') return;
    if (room.players.filter(p => !p.isHost).length < 1) return err('참가자가 없습니다.');

    const cleanAnswer = String(answer || '').trim();
    if (!cleanAnswer) return err('제시어를 입력해주세요.');

    const answerJamo = decompose(cleanAnswer);
    if (answerJamo.length < 1) return err('제시어 자모 길이가 이상합니다.');

    room.answer     = cleanAnswer;
    room.answerJamo = answerJamo;
    room.winnerName = null;
    room.state      = 'playing';
    room.players.forEach(p => { p.attempts = []; p.solved = false; });

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

  // ── 대기실로 나가기 (방장 전용) ─────────────────────────────────────────────
  // 자모 워들은 라운드 종료 후 자동 복귀가 없으므로 방장이 직접 대기실로 되돌린다.
  socket.on('return_to_lobby', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost || room.state === 'lobby') return;

    room.state      = 'lobby';
    room.answer     = '';
    room.answerJamo = [];
    room.winnerName = null;
    room.players.forEach(p => { p.ready = false; p.attempts = []; p.solved = false; });

    broadcast(room);
    broadcastRooms();
  });

  // ── 관전자 → 참여자로 이동 (대기실에서만) ──────────────────────────────────
  // 게임 도중 관전으로 들어온 사람이 나갔다 오지 않고 다음 게임에 참여할 수 있게 한다.
  socket.on('spectator_to_player', () => {
    const room = manager.getRoomOfSpectator(socket.id);
    if (!room || room.state !== 'lobby') return;
    if (room.players.length >= manager.maxPlayers) return err('방이 꽉 찼습니다.');

    const spec = room.spectators.find(s => s.id === socket.id);
    if (!spec) return;
    if (room.players.some(p => p.name === spec.name)) return err(`'${spec.name}' 닉네임이 이미 사용 중입니다.`);

    room.spectators = room.spectators.filter(s => s.id !== socket.id);
    room.players.push({
      id: socket.id, userId: socket.request.session?.userId ?? null,
      name: spec.name, avatar: spec.avatar ?? null,
      isHost: false, ready: false,
      attempts: [], solved: false, score: 0, wins: 0,
    });

    broadcast(room);
    broadcastRooms();
  });

  // ── 답 제출 (참가자 전용) ───────────────────────────────────────────────────
  socket.on('submit_guess', ({ guess } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.isHost || player.solved) return; // 방장은 참여하지 않는다
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
      player.solved   = true;
      player.wins     = (player.wins  || 0) + 1;
      player.score    = (player.score || 0) + Math.max(1, 6 - player.attempts.length);
      room.winnerName = player.name;
      room.state      = 'intermission'; // 첫 정답자가 나오면 라운드 종료
    } else if (allParticipantsDone(room)) {
      room.state = 'intermission';       // 전원 소진 → 무승부로 라운드 종료
    }

    broadcast(room);
    broadcastRooms();
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

    const wasIngame = room.state !== 'lobby';
    const result = removePlayer(room, socket.id);

    if (result.deleted) { broadcastRooms(); return; }

    if (result.alone && wasIngame) {
      io.to(result.remainingId).emit('alone_in_room', { message: `${result.leaverName}님이 나가 혼자 남았습니다.` });
    }

    // 라운드 진행 중 참가자가 나가 남은 참가자가 모두 끝났다면 라운드를 종료한다.
    if (room.state === 'playing' && allParticipantsDone(room)) {
      room.state = 'intermission';
    }

    io.to(room.code).emit('room_update', safeState(room));
    if (room.state !== 'lobby') emitGameState(io, room);
    broadcastRooms();
  });
}
