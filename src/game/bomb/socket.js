import { rooms, getRoomOf, safeState, removePlayer, removeSpectator, manager } from './rooms.js';
import { BOMB_TIME_PER_PLAYER_MIN, BOMB_TIME_PER_PLAYER_MAX, BOMB_RETURN_DELAY, BOMB_WARN_MIN, BOMB_WARN_MAX } from '../../config.js';
import { registerCommonHandlers, broadcastRoomList } from '../../shared/socketHandlers.js';
import { recordPlayers } from '../../db/stats.js';

// ── 타이머 관리 ───────────────────────────────────────────────────────────────
const bombTimers   = new Map();
const warnTimers   = new Map();
const returnTimers = new Map();

function clearBombTimer(code) {
  clearTimeout(bombTimers.get(code));
  bombTimers.delete(code);
  clearTimeout(warnTimers.get(code));
  warnTimers.delete(code);
}

function clearReturnTimer(code) {
  clearTimeout(returnTimers.get(code));
  returnTimers.delete(code);
}

function startReturnTimer(io, room) {
  clearReturnTimer(room.code);
  returnTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'roundEnd') return;
    r.state             = 'lobby';
    r.bombHolder        = null;
    r.bombHoldStartedAt = null;
    r.players.forEach(p => (p.ready = false));
    io.to(r.code).emit('room_update', safeState(r));
    broadcastRoomList(io, manager, 'bomb_rooms_update');
  }, BOMB_RETURN_DELAY * 1000));
}

export function registerBombHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame, registerLeaveFlow } =
    registerCommonHandlers(io, socket, manager, {
      roomsEvent:    'bomb_rooms_update',
      spectateCheck: 'notLobby',
    });

  // ── 게임 시작 ──────────────────────────────────────────────────────────────
  socket.on('start_game', () => {
    const { ok, room } = validateStartGame();
    if (!ok) return;

    room.state             = 'playing';
    room.loser             = null;
    room.round            += 1;
    room.bombHolder        = room.players[0].id;
    room.bombHoldStartedAt = Date.now();
    room.players.forEach(p => (p.ready = false));

    const n     = room.players.length;
    const minMs = BOMB_TIME_PER_PLAYER_MIN * n * 1000;
    const maxMs = BOMB_TIME_PER_PLAYER_MAX * n * 1000;
    const delay = minMs + Math.random() * (maxMs - minMs);

    clearBombTimer(room.code);

    const warnBefore = (BOMB_WARN_MIN + Math.random() * (BOMB_WARN_MAX - BOMB_WARN_MIN)) * 1000;
    if (delay > warnBefore) {
      warnTimers.set(room.code, setTimeout(() => {
        const r = rooms.get(room.code);
        if (r?.state === 'playing') io.to(r.code).emit('bomb_warning');
      }, delay - warnBefore));
    } else {
      io.to(room.code).emit('bomb_warning');
    }

    bombTimers.set(room.code, setTimeout(() => {
      const r = rooms.get(room.code);
      if (!r || r.state !== 'playing') return;

      const holder = r.players.find(p => p.id === r.bombHolder);
      if (!holder) return;

      r.loser             = holder.id;
      r.state             = 'roundEnd';
      r.bombHoldStartedAt = null;

      // 폭탄을 들고 있던 사람만 패배, 나머지는 승리
      recordPlayers('bomb', r.players, p => (p.id === holder.id ? 'lose' : 'win'));

      io.to(r.code).emit('bomb_explode', { loserId: holder.id, loserName: holder.name });
      io.to(r.code).emit('room_update', safeState(r));

      startReturnTimer(io, r);
    }, delay));

    broadcast(room);
    broadcastRooms();
  });

  // ── 폭탄 패스 ──────────────────────────────────────────────────────────────
  socket.on('pass_bomb', () => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'playing') return;
    if (room.bombHolder !== socket.id) return err('지금 폭탄을 들고 있지 않습니다.');

    const idx     = room.players.findIndex(p => p.id === socket.id);
    const nextIdx = (idx + 1) % room.players.length;
    room.bombHolder        = room.players[nextIdx].id;
    room.bombHoldStartedAt = Date.now();
    broadcast(room);
  });

  // ── 방 이탈 ────────────────────────────────────────────────────────────────
  // 연결이 끊긴 경우에는 재접속 유예가 끝난 뒤에 호출된다 (registerLeaveFlow).
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

    clearBombTimer(room.code);
    clearReturnTimer(room.code);

    const wasPlaying = room.state === 'playing' || room.state === 'roundEnd';
    const result = removePlayer(room, id);

    if (result.deleted) { broadcastRooms(); return; }

    if (result.alone && wasPlaying) {
      io.to(result.remainingId).emit('alone_in_room', { message: `${result.leaverName}님이 나가 혼자 남았습니다.` });
    }
    io.to(room.code).emit('room_update', safeState(room));
    broadcastRooms();
  }

  registerLeaveFlow(leaveRoom, {
    immediate: () => console.log(`[bomb disconnect] ${socket.id}`),
  });
}
