import { rooms, getRoomOf, safeState, removePlayer, removeSpectator, manager, RETURN_DELAY } from './rooms.js';
import { registerCommonHandlers, broadcastRoomList } from '../../shared/socketHandlers.js';
import { recordPlayers } from '../../db/stats.js';

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
    if (!r || r.state !== 'gameOver') return;
    r.state  = 'lobby';
    r.winner = null;
    r.players.forEach(p => { p.ready = false; p.alive = true; p.board = null; });
    io.to(r.code).emit('room_update', safeState(r));
    broadcastRoomList(io, manager, 'tetris_rooms_update');
  }, RETURN_DELAY));
}

export function registerTetrisHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame, registerLeaveFlow } =
    registerCommonHandlers(io, socket, manager, {
      roomsEvent:    'tetris_rooms_update',
      spectateCheck: 'playing',
      joinPlayerFields: () => ({ alive: true, board: null }),
    });

  // ── 게임 시작 ──────────────────────────────────────────────────────────────
  socket.on('start_game', () => {
    const { ok, room } = validateStartGame();
    if (!ok) return;

    room.state  = 'playing';
    room.winner = null;
    room.players.forEach(p => { p.ready = false; p.alive = true; p.board = null; });

    broadcast(room);
    broadcastRooms();
  });

  // ── 줄 제거 → 콤보 기반 쓰레기 줄 전송 ──────────────────────────────────────
  const COMBO_GARBAGE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
  const LINE_GARBAGE  = [0, 0, 1, 2, 4];

  socket.on('line_clear', ({ count, combo } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || room.state !== 'playing' || !player?.alive) return;
    if (typeof count !== 'number' || count < 1 || count > 4) return;
    if (typeof combo !== 'number' || combo < 1) return;

    const comboGarbage = COMBO_GARBAGE[Math.min(combo, COMBO_GARBAGE.length - 1)];
    const lineGarbage  = LINE_GARBAGE[count] ?? 0;
    const garbage      = comboGarbage + lineGarbage;
    if (garbage <= 0) return;

    room.players.forEach(p => {
      if (p.id !== socket.id && p.alive) {
        io.to(p.id).emit('garbage_lines', { count: garbage, fromName: player.name, combo });
      }
    });
  });

  // ── 보드 동기화 ────────────────────────────────────────────────────────────
  socket.on('board_update', ({ board } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || room.state !== 'playing' || !player) return;
    if (!Array.isArray(board)) return;
    player.board = board;
    socket.to(room.code).emit('player_board_update', { playerId: socket.id, board });
  });

  // ── 게임 오버 (해당 플레이어 탈락) ──────────────────────────────────────────
  socket.on('game_over', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || room.state !== 'playing' || !player?.alive) return;

    player.alive = false;
    player.board = null;

    io.to(room.code).emit('player_eliminated', { playerId: socket.id, playerName: player.name });
    broadcast(room);

    const alive = room.players.filter(p => p.alive);
    if (alive.length <= 1) {
      const winner  = alive[0] ?? null;
      room.state    = 'gameOver';
      room.winner   = winner?.id ?? null;

      recordPlayers('tetris', room.players, p => {
        if (!winner)            return 'draw';
        return p.id === winner.id ? 'win' : 'lose';
      });

      io.to(room.code).emit('game_result', {
        winnerId:   winner?.id   ?? null,
        winnerName: winner?.name ?? null,
      });
      broadcast(room);
      startReturnTimer(io, room);
      broadcastRooms();
    }
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

    if (room.state !== 'gameOver') clearReturnTimer(room.code);

    const wasPlaying = room.state === 'playing' || room.state === 'gameOver';
    const result     = removePlayer(room, id);

    if (result.deleted) { broadcastRooms(); return; }

    if (result.alone) {
      if (wasPlaying) {
        io.to(result.remainingId).emit('alone_in_room', {
          message: `${result.leaverName}님이 나가 혼자 남았습니다.`,
        });
      }
      io.to(room.code).emit('room_update', safeState(room));
    } else if (result.gameEnded) {
      const winner = room.players.find(p => p.id === room.winner);
      // 이탈로 승부가 갈린 경우도 남은 사람들의 전적에 반영한다 (나간 사람은 이미 제외됨)
      recordPlayers('tetris', room.players, p => {
        if (!winner)            return 'draw';
        return p.id === winner.id ? 'win' : 'lose';
      });
      io.to(room.code).emit('game_result', {
        winnerId:   room.winner,
        winnerName: winner?.name ?? null,
      });
      io.to(room.code).emit('room_update', safeState(room));
      startReturnTimer(io, room);
    } else {
      io.to(room.code).emit('room_update', safeState(room));
    }
    broadcastRooms();
  }

  registerLeaveFlow(leaveRoom, {
    immediate: () => console.log(`[tetris disconnect] ${socket.id}`),
    // 재접속하면 다른 플레이어들의 현재 보드를 다시 받아야 화면이 채워진다.
    onResume: (room, sock) => {
      room.players.forEach(p => {
        if (p.id !== sock.id && p.board) {
          sock.emit('player_board_update', { playerId: p.id, board: p.board });
        }
      });
    },
  });
}
