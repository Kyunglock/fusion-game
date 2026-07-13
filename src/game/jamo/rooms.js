import { createRoomManager } from '../../shared/roomManager.js';
import { JAMO_MAX_PLAYERS, JAMO_MIN_PLAYERS } from '../../config.js';

const manager = createRoomManager({
  maxPlayers: JAMO_MAX_PLAYERS,
  minPlayers: JAMO_MIN_PLAYERS,
  extraRoomFields: {
    answer:          '',
    answerJamo:      [],
    keyboardVisible: true,
    winnerName:      null,
  },
  defaultPlayerFields: { attempts: [], solved: false, score: 0, wins: 0 },
  // 시도 내용(word/jamo)은 뷰어별로 마스킹해야 하므로 socket.js에서 별도 이벤트로 전송한다.
  // safeState에는 진행 상황(시도 횟수/정답 여부/점수)만 포함한다.
  safePlayer: (p) => ({
    id: p.id, name: p.name, avatar: p.avatar,
    isHost: p.isHost, ready: p.ready,
    solved: p.solved, attemptCount: p.attempts.length,
    score: p.score || 0, wins: p.wins || 0,
  }),
  extraStateFields: (room) => ({
    keyboardVisible: room.keyboardVisible,
    answerLength:    room.answerJamo.length,
    minPlayers:      JAMO_MIN_PLAYERS,
  }),
  resetGameState: (room) => {
    room.answer     = '';
    room.answerJamo = [];
    room.winnerName = null;
    room.players.forEach(p => { p.attempts = []; p.solved = false; });
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { manager };
export { JAMO_MAX_PLAYERS, JAMO_MIN_PLAYERS };
