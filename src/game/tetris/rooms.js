import { createRoomManager } from '../../shared/roomManager.js';
import { TETRIS_MAX_PLAYERS, TETRIS_MIN_PLAYERS, TETRIS_RETURN_DELAY as RETURN_DELAY } from '../../config.js';

const manager = createRoomManager({
  maxPlayers:  TETRIS_MAX_PLAYERS,
  minPlayers:  TETRIS_MIN_PLAYERS,
  extraRoomFields: {
    winner: null,
  },
  defaultPlayerFields: { alive: true, board: null },
  safePlayer: (p) => ({
    id: p.id, name: p.name, avatar: p.avatar,
    isHost: p.isHost, ready: p.ready, alive: p.alive, board: p.board,
  }),
  extraStateFields: (room) => ({
    winner:     room.winner,
    minPlayers: TETRIS_MIN_PLAYERS,
  }),
  resetGameState: (room) => {
    room.winner = null;
    room.players.forEach(p => { p.alive = true; p.board = null; });
  },
  onPlayerLeave: (room, socketId) => {
    // 게임 중 이탈 시 승리 판정
    if (room.state === 'playing') {
      const alive = room.players.filter(p => p.id !== socketId && p.alive);
      if (alive.length <= 1) {
        room.state  = 'gameOver';
        room.winner = alive[0]?.id ?? null;
        return { gameEnded: true };
      }
    }
    return {};
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { manager };

// 관전자 조회도 export
export const getTetrisRoomOfSpectator = manager.getRoomOfSpectator;

export { TETRIS_MAX_PLAYERS, TETRIS_MIN_PLAYERS, RETURN_DELAY };
