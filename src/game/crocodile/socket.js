import { rooms, getRoomOf, getRooms, startGame, safeState, removePlayer, removeSpectator, manager } from './rooms.js';
import { TURN_TIMEOUT, AUTO_RETURN_DELAY } from '../../config.js';
import { registerCommonHandlers } from '../../shared/socketHandlers.js';

// ── 타이머 관리 ───────────────────────────────────────────────────────────────
const turnTimers   = new Map();
const returnTimers = new Map();

function clearTurnTimer(code) {
  clearTimeout(turnTimers.get(code));
  turnTimers.delete(code);
}

function clearReturnTimer(code) {
  clearTimeout(returnTimers.get(code));
  returnTimers.delete(code);
}

function startTurnTimer(io, room) {
  clearTurnTimer(room.code);
  room.turnDeadline = Date.now() + TURN_TIMEOUT * 1000;
  io.to(room.code).emit('room_update', safeState(room));

  turnTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'playing') return;

    const current = r.players[r.currentTurnIndex];
    if (!current) return;

    r.loser        = current.id;
    r.state        = 'roundEnd';
    r.turnDeadline = null;

    io.to(r.code).emit('room_update', { ...safeState(r), loserName: current.name, trapTooth: r.trapTooth });
    io.to(r.code).emit('bite_event',  { loserId: current.id, loserName: current.name, trapTooth: r.trapTooth, timeout: true });

    startReturnTimer(io, r);
  }, TURN_TIMEOUT * 1000));
}

function startReturnTimer(io, room) {
  clearReturnTimer(room.code);
  returnTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'roundEnd') return;
    r.state        = 'lobby';
    r.turnDeadline = null;
    r.players.forEach(p => (p.ready = false));
    io.to(r.code).emit('room_update', safeState(r));
    io.emit('rooms_update', getRooms());
  }, AUTO_RETURN_DELAY * 1000));
}

// ── 접속자 관리 (악어 전용) ──────────────────────────────────────────────────
const onlineUsers = new Map();

function broadcastOnline(io) {
  const seen = new Set();
  const users = [];
  for (const u of onlineUsers.values()) {
    if (!seen.has(u.userId)) {
      seen.add(u.userId);
      users.push({ username: u.username, avatar: u.avatar });
    }
  }
  io.emit('online_users', users);
}

export function registerHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame } =
    registerCommonHandlers(io, socket, manager, {
      roomsEvent:    'rooms_update',
      spectateCheck: 'notLobby',
      joinPlayerFields: () => ({ score: 0 }),
    });

  // 접속자 등록
  const sess = socket.request.session;
  if (sess?.userId) {
    onlineUsers.set(socket.id, {
      userId:   sess.userId,
      username: sess.username,
      avatar:   sess.avatar   ?? null,
    });
  }
  broadcastOnline(io);

  socket.on('refresh_profile', () => {
    socket.request.session.reload((reloadErr) => {
      if (reloadErr) return;
      const s = socket.request.session;
      if (s?.userId) {
        onlineUsers.set(socket.id, {
          userId: s.userId, username: s.username,
          avatar: s.avatar ?? null,
        });
        broadcastOnline(io);
      }
    });
  });

  // ── 게임 시작 ──────────────────────────────────────────────────────────────
  socket.on('start_game', () => {
    const { ok, room } = validateStartGame();
    if (!ok) return;
    startGame(room);
    startTurnTimer(io, room);
    broadcastRooms();
  });

  // ── 이빨 누르기 ────────────────────────────────────────────────────────────
  socket.on('press_tooth', async ({ toothIndex } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'playing') return;

    const current = room.players[room.currentTurnIndex];
    if (!current || current.id !== socket.id)    return err('당신의 차례가 아닙니다.');
    if (room.pressedTeeth.includes(toothIndex)) return err('이미 누른 이빨입니다.');

    clearTurnTimer(room.code);
    room.pressedTeeth.push(toothIndex);

    if (toothIndex === room.trapTooth) {
      room.loser        = current.id;
      room.state        = 'roundEnd';
      room.turnDeadline = null;

      io.to(room.code).emit('room_update', { ...safeState(room), loserName: current.name, trapTooth: room.trapTooth });
      io.to(room.code).emit('bite_event',  { loserId: current.id, loserName: current.name, trapTooth: room.trapTooth });
      startReturnTimer(io, room);
    } else {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      io.to(room.code).emit('safe_press', { toothIndex, pressedBy: current.name });
      startTurnTimer(io, room);
    }
  });

  // ── 다시 하기 / 초기화 ─────────────────────────────────────────────────────
  socket.on('play_again', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost || room.state !== 'roundEnd') return;
    clearReturnTimer(room.code);
    room.state        = 'lobby';
    room.turnDeadline = null;
    room.players.forEach(p => (p.ready = false));
    broadcast(room);
    broadcastRooms();
  });

  socket.on('reset_game', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost) return;

    clearTurnTimer(room.code);
    clearReturnTimer(room.code);
    room.state        = 'lobby';
    room.pressedTeeth = [];
    room.trapTooth    = null;
    room.loser        = null;
    room.round        = 0;
    room.turnDeadline = null;
    room.players.forEach(p => { p.score = 0; p.ready = false; });
    broadcast(room);
    broadcastRooms();
  });

  // ── 연결 끊김 ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    onlineUsers.delete(socket.id);
    broadcastOnline(io);

    const spectatorRoom = manager.getRoomOfSpectator(socket.id);
    if (spectatorRoom) {
      removeSpectator(spectatorRoom, socket.id);
      io.to(spectatorRoom.code).emit('room_update', safeState(spectatorRoom));
      broadcastRooms();
      return;
    }

    const room = getRoomOf(socket.id);
    if (!room) return;

    clearTurnTimer(room.code);
    clearReturnTimer(room.code);

    const wasPlaying = room.state === 'playing' || room.state === 'roundEnd';
    const result = removePlayer(room, socket.id);

    if (result.deleted) { broadcastRooms(); return; }

    if (result.alone && wasPlaying) {
      io.to(result.remainingId).emit('alone_in_room', { message: `${result.leaverName}님이 나가 혼자 남았습니다.` });
    }
    if (!result.deleted) {
      io.to(room.code).emit('room_update', safeState(room));
    }
    broadcastRooms();
  });
}
