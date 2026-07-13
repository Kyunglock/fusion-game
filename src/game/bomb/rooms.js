import { createRoomManager } from '../../shared/roomManager.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../config.js';

const manager = createRoomManager({
  maxPlayers:  MAX_PLAYERS,
  minPlayers:  MIN_PLAYERS,
  extraRoomFields: {
    bombHolder:        null,
    bombHoldStartedAt: null,
    loser:             null,
    round:             0,
  },
  extraStateFields: (room) => ({
    bombHolder:        room.bombHolder,
    bombHoldStartedAt: room.bombHoldStartedAt,
    loser:             room.loser,
    round:             room.round,
  }),
  onPlayerLeave: (room, socketId) => {
    const wasHolder = room.bombHolder === socketId;
    const holderIdx = room.players.findIndex(p => p.id === socketId);
    // 폭탄 소유자가 나가면 다음 사람에게 넘기기 (removePlayer 내부에서 호출)
    if (wasHolder && room.state === 'playing' && room.players.length > 1) {
      // players에서 제거되기 전이므로 length-1을 고려
      const remaining = room.players.filter(p => p.id !== socketId);
      if (remaining.length > 0) {
        const nextIdx = holderIdx % remaining.length;
        room.bombHolder        = remaining[nextIdx].id;
        room.bombHoldStartedAt = Date.now();
      }
    }
    return {};
  },
  resetGameState: (room) => {
    room.bombHolder        = null;
    room.bombHoldStartedAt = null;
    room.loser             = null;
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { manager };
export { MAX_PLAYERS, MIN_PLAYERS };
