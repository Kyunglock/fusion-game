import { createRoomManager } from '../../shared/roomManager.js';
import { WORDCHAIN_MAX_PLAYERS, WORDCHAIN_MIN_PLAYERS } from '../../config.js';
import { allowedStarts } from './chainLogic.js';

// 현재 체인 기준으로 다음 단어가 시작할 수 있는 글자 목록 (빈 체인이면 자유)
function currentAllowedStarts(room) {
  if (!room.chain?.length) return [];
  const lastWord = room.chain[room.chain.length - 1].word;
  return allowedStarts(lastWord[lastWord.length - 1]);
}

// socketId 다음 순서의 생존자 (본인 제외, 없으면 null)
export function nextAlive(room, socketId) {
  const n   = room.players.length;
  const idx = room.players.findIndex(p => p.id === socketId);
  for (let i = 1; i <= n; i++) {
    const p = room.players[((idx < 0 ? 0 : idx) + i) % n];
    if (p.id !== socketId && p.alive) return p;
  }
  return null;
}

const manager = createRoomManager({
  maxPlayers: WORDCHAIN_MAX_PLAYERS,
  minPlayers: WORDCHAIN_MIN_PLAYERS,
  extraRoomFields: {
    round:        0,
    chain:        [],    // { word, playerId, playerName }
    usedWords:    null,  // Set — start_game에서 생성, safeState에는 포함하지 않는다
    currentTurn:  null,  // 현재 차례인 플레이어의 socket id
    turnDeadline: null,
    winner:       null,  // { id, name }
  },
  defaultPlayerFields: { alive: true, wins: 0 },
  safePlayer: (p) => ({
    id: p.id, name: p.name, avatar: p.avatar,
    isHost: p.isHost, ready: p.ready,
    alive: p.alive !== false, wins: p.wins ?? 0,
  }),
  extraStateFields: (room) => ({
    round:         room.round,
    chain:         room.chain,
    currentTurn:   room.currentTurn,
    turnDeadline:  room.turnDeadline,
    winner:        room.winner,
    allowedStarts: currentAllowedStarts(room),
  }),
  onPlayerLeave: (room, socketId) => {
    // 자기 차례인 사람이 나가면 다음 생존자에게 턴을 넘긴다
    const wasCurrent = room.currentTurn === socketId;
    if (wasCurrent && room.state === 'playing') {
      room.currentTurn = nextAlive(room, socketId)?.id ?? null;
    }
    return { wasCurrent };
  },
  resetGameState: (room) => {
    room.chain        = [];
    room.usedWords    = null;
    room.currentTurn  = null;
    room.turnDeadline = null;
    room.winner       = null;
    room.players.forEach(p => { p.alive = true; });
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { manager };
