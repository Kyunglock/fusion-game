import { createRoomManager } from '../../shared/roomManager.js';
import { TOTAL_TEETH, MAX_PLAYERS, MIN_PLAYERS } from '../../config.js';

const manager = createRoomManager({
  maxPlayers:  MAX_PLAYERS,
  minPlayers:  MIN_PLAYERS,
  extraRoomFields: {
    trapTooth:        null,
    pressedTeeth:     [],
    currentTurnIndex: 0,
    loser:            null,
    round:            0,
    turnDeadline:     null,
  },
  defaultPlayerFields: { score: 0 },
  extraStateFields: (room) => ({
    pressedTeeth:     room.pressedTeeth,
    currentTurnIndex: room.currentTurnIndex,
    currentPlayerId:  room.players[room.currentTurnIndex]?.id ?? null,
    loser:            room.loser,
    round:            room.round,
    totalTeeth:       TOTAL_TEETH,
    turnDeadline:     room.turnDeadline ?? null,
  }),
  resetGameState: (room) => {
    room.pressedTeeth = [];
    room.trapTooth    = null;
    room.loser        = null;
    room.turnDeadline = null;
    if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { manager };

export function startGame(room) {
  room.state            = 'playing';
  room.trapTooth        = Math.floor(Math.random() * TOTAL_TEETH);
  room.pressedTeeth     = [];
  room.loser            = null;
  room.round           += 1;
  room.currentTurnIndex = (room.round - 1) % room.players.length;
}

export { MAX_PLAYERS, MIN_PLAYERS };
