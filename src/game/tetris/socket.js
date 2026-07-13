import { rooms, getRoomOf, getRooms, safeState, removePlayer, removeSpectator, manager, RETURN_DELAY } from './rooms.js';
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
    if (!r || r.state !== 'gameOver') return;
    r.state  = 'lobby';
    r.winner = null;
    r.players.forEach(p => { p.ready = false; p.alive = true; p.board = null; });
    io.to(r.code).emit('room_update', safeState(r));
    io.emit('tetris_rooms_update', getRooms());
  }, RETURN_DELAY));
}

export function registerTetrisHandlers(io, socket) {
  const { broadcast, broadcastRooms, err, validateStartGame } =
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

      io.to(room.code).emit('game_result', {
        winnerId:   winner?.id   ?? null,
        winnerName: winner?.name ?? null,
      });
      broadcast(room);
      startReturnTimer(io, room);
      broadcastRooms();
    }
  });

  // ── 연결 끊김 ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[tetris disconnect] ${socket.id}`);

    const spectatorRoom = manager.getRoomOfSpectator(socket.id);
    if (spectatorRoom) {
      removeSpectator(spectatorRoom, socket.id);
      broadcast(spectatorRoom);
      broadcastRooms();
      return;
    }

    const room = getRoomOf(socket.id);
    if (!room) return;

    if (room.state !== 'gameOver') clearReturnTimer(room.code);

    const wasPlaying = room.state === 'playing' || room.state === 'gameOver';
    const result     = removePlayer(room, socket.id);

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
  });
}
