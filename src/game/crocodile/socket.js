import { rooms, getRoomOf, startGame, safeState, removePlayer, removeSpectator, manager } from './rooms.js';
import { TURN_TIMEOUT, AUTO_RETURN_DELAY } from '../../config.js';
import { registerCommonHandlers, broadcastRoomList } from '../../shared/socketHandlers.js';
import { GAME_SERVERS, serverChannel } from '../../servers.js';
import { recordPlayers } from '../../db/stats.js';

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

    // 물린 사람만 패배, 나머지는 생존 승리
    recordPlayers('crocodile', r.players, p => (p.id === current.id ? 'lose' : 'win'));

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
    broadcastRoomList(io, manager, 'rooms_update');
  }, AUTO_RETURN_DELAY * 1000));
}

// ── 접속자 관리 (악어 전용) ──────────────────────────────────────────────────
// 접속자 위젯은 모든 페이지에 뜨므로 여기 목록이 곧 '지금 누가 있나'다.
// 서버(채널)를 갈라놓은 이상 남의 서버 사람까지 보이면 안 되므로 서버별로 나눠 보낸다.
const onlineUsers = new Map();

function broadcastOnline(io) {
  const perServer = new Map();
  for (const u of onlineUsers.values()) {
    if (!u.serverId) continue;
    if (!perServer.has(u.serverId)) perServer.set(u.serverId, { seen: new Set(), users: [] });
    const bucket = perServer.get(u.serverId);
    if (bucket.seen.has(u.userId)) continue;
    bucket.seen.add(u.userId);
    bucket.users.push({ username: u.username, avatar: u.avatar });
  }
  for (const s of GAME_SERVERS) {
    io.to(serverChannel(s.id)).emit('online_users', perServer.get(s.id)?.users ?? []);
  }
}

export function registerHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame, registerLeaveFlow } =
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
      serverId: sess.serverId ?? null,
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
          serverId: s.serverId ?? null,
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

      recordPlayers('crocodile', room.players, p => (p.id === current.id ? 'lose' : 'win'));

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

    clearTurnTimer(room.code);
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
    // 접속자 위젯은 유예 없이 바로 반영한다.
    immediate: () => {
      console.log(`[disconnect] ${socket.id}`);
      onlineUsers.delete(socket.id);
      broadcastOnline(io);
    },
  });
}
