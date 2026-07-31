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
  // 계정 식별자(userId/accountId)는 서버 내부용이므로 클라이언트로 내보내지 않는다.
  safePlayer: (p) => ({
    id: p.id, name: p.name, avatar: p.avatar,
    isHost: p.isHost, ready: p.ready,
  }),
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
  // 재접속으로 소켓 id 가 바뀌어도 폭탄이 엉뚱한 사람에게 남지 않도록 옮겨준다.
  remapPlayerId: (room, oldId, newId) => {
    if (room.bombHolder === oldId) room.bombHolder = newId;
    if (room.loser      === oldId) room.loser      = newId;
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { manager };
export { MAX_PLAYERS, MIN_PLAYERS };
