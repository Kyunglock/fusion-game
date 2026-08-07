import { createRoomManager } from '../../shared/roomManager.js';
import { LIAR_MAX_PLAYERS, LIAR_MIN_PLAYERS, LIAR_HINT_TIMEOUT, LIAR_DEFENSE_TIMEOUT, LIAR_GUESS_TIMEOUT } from '../../config.js';

/**
 * 라이어 게임 — 방장도 끝말잇기처럼 참가자로 함께 플레이한다(진행 전용 역할 없음).
 * 매 라운드 시작 시 전원 중 한 명이 무작위로 라이어가 되어 **제시어를 받지 못한 채**
 * (자신이 라이어라는 사실만 안다) 힌트를 내야 하고, 나머지는 진짜 제시어를 받는다.
 * 제시어는 방장이 입력하지 않고 자모 워들의 낱말 사전(jamoWords.js WORD_LIST)에서
 * 자동으로 무작위 배정한다. room.state 로 라운드 진행 단계를 표현한다:
 *
 *   lobby(대기실, 전원 준비 → 방장이 게임 시작) → hint(순서대로 힌트) →
 *   voteContinue(한 바퀴 더 vs 라이어 지목) → [voteLiar(지목 투표) → defense(최후 반론)
 *   → confirmAccuse(그대로 진행 vs 철회) → [liarGuess(라이어가 진짜 제시어 맞히기)]]
 *   → 다시 lobby(결과·직전 라운드 힌트 기록 공개, 전원 재준비 대기)
 *
 * 참가자의 역할(role)·제시어(word)는 뷰어별로 감춰야 하므로 safeState 에는 넣지 않고
 * socket.js 의 emitLiarState 가 개인화된 이벤트로 따로 보낸다(관전자만 전원 공개로 봄,
 * 방장도 이제 참가자이므로 자신의 역할만 본다).
 *
 * 투표 집계(votesIn/votesNeeded)는 재접속 유예 중(disconnected)인 사람을 분모에서
 * 뺀다 — 안 그러면 끊긴 사람 몫만큼 영원히 채워지지 않아 투표가 멈춘 것처럼 보인다.
 */
function activeParticipants(room) {
  return room.players.filter(p => !p.disconnected);
}

const manager = createRoomManager({
  maxPlayers: LIAR_MAX_PLAYERS,
  minPlayers: LIAR_MIN_PLAYERS,
  extraRoomFields: {
    hintTimeout:      LIAR_HINT_TIMEOUT,    // 방장이 대기실에서 조절 가능 (초)
    defenseTimeout:   LIAR_DEFENSE_TIMEOUT, // 〃 최후 반론 제한시간 (초)
    guessTimeout:     LIAR_GUESS_TIMEOUT,   // 〃 라이어 정답 제한시간 (초)
    realWord:         '',
    liarId:           null,
    turnOrder:        [],   // 참가자 id 배열 (라운드 시작 시 무작위 셔플, 시계방향 순서)
    currentTurnIndex: 0,
    currentTurn:      null,
    turnDeadline:     null,
    hints:            [],   // [{ playerId, playerName, text, skipped }] — 라운드 시작 시에만 비우고, 라운드 종료 후에는 다음 라운드 시작 전까지 남겨둔다
    cycleCount:       0,    // 몇 바퀴를 돌았는지
    continueVotes:    {},   // playerId → 'accuse' | 'continue'
    accuseVotes:      {},   // playerId → 지목한 대상 playerId
    accusedId:        null, // voteLiar 결과로 지목된 사람 (defense~liarGuess 단계에서 공개)
    defenseDeadline:  null, // 최후 반론 마감 시각
    defenseLines:     [],   // 지목된 사람이 반론 시간에 적은 글 [{ text }]
    confirmVotes:     {},   // playerId → 'proceed' | 'withdraw'
    guessDeadline:    null, // 라이어 정답 제출 마감 시각 (liarGuess 단계에서만 공개)
    lastResult:       null, // { winnerRole, liarName, realWord, liarGuess } — 라운드 종료 후 다음 라운드 시작 전까지 공개
  },
  defaultPlayerFields: { role: null, word: null, wins: 0 },
  safePlayer: (p) => ({
    id: p.id, name: p.name, avatar: p.avatar,
    isHost: p.isHost, ready: p.ready, wins: p.wins || 0,
  }),
  extraStateFields: (room) => {
    const participants = activeParticipants(room);
    const votesMap = room.state === 'voteContinue' ? room.continueVotes
                    : room.state === 'voteLiar'      ? room.accuseVotes
                    : room.state === 'confirmAccuse'  ? room.confirmVotes
                    : null;
    return {
      minPlayers:     LIAR_MIN_PLAYERS,
      hintTimeout:    room.hintTimeout,
      defenseTimeout: room.defenseTimeout,
      guessTimeout:   room.guessTimeout,
      // 힌트 기록·직전 결과는 그 자체로 비밀 정보가 아니며, 다음 라운드가 시작될 때
      // (assignNewRound) 비워지므로 언제 내려줘도 안전하다 — 대기실에서도 그대로 보인다.
      hints:        room.hints,
      lastResult:   room.lastResult,
      currentTurn:  room.state === 'hint' ? room.currentTurn  : null,
      turnDeadline: room.state === 'hint' ? room.turnDeadline : null,
      cycleCount:   room.cycleCount,
      votesIn:      votesMap ? Object.keys(votesMap).length : 0,
      votesNeeded:  votesMap ? participants.length : 0,
      votedIds:     votesMap ? Object.keys(votesMap) : [],
      accusedId:    (room.state === 'defense' || room.state === 'confirmAccuse' || room.state === 'liarGuess') ? room.accusedId : null,
      defenseDeadline: room.state === 'defense' ? room.defenseDeadline : null,
      defenseLines: (room.state === 'defense' || room.state === 'confirmAccuse') ? room.defenseLines : [],
      guessDeadline: room.state === 'liarGuess' ? room.guessDeadline : null,
    };
  },
  remapPlayerId: (room, oldId, newId) => {
    if (room.liarId      === oldId) room.liarId      = newId;
    if (room.currentTurn === oldId) room.currentTurn = newId;
    if (room.accusedId   === oldId) room.accusedId   = newId;
    room.turnOrder = room.turnOrder.map(id => (id === oldId ? newId : id));
    room.hints.forEach(h => { if (h.playerId === oldId) h.playerId = newId; });
    if (room.continueVotes[oldId] !== undefined) {
      room.continueVotes[newId] = room.continueVotes[oldId];
      delete room.continueVotes[oldId];
    }
    if (room.confirmVotes[oldId] !== undefined) {
      room.confirmVotes[newId] = room.confirmVotes[oldId];
      delete room.confirmVotes[oldId];
    }
    if (room.accuseVotes[oldId] !== undefined) {
      room.accuseVotes[newId] = room.accuseVotes[oldId];
      delete room.accuseVotes[oldId];
    }
    for (const [voter, target] of Object.entries(room.accuseVotes)) {
      if (target === oldId) room.accuseVotes[voter] = newId;
    }
  },
  onPlayerLeave: (room, socketId) => {
    const wasLiar        = room.liarId      === socketId;
    const wasCurrentTurn = room.currentTurn === socketId;
    room.turnOrder = room.turnOrder.filter(id => id !== socketId);
    delete room.continueVotes[socketId];
    delete room.confirmVotes[socketId];
    delete room.accuseVotes[socketId];
    for (const [voter, target] of Object.entries(room.accuseVotes)) {
      if (target === socketId) delete room.accuseVotes[voter];
    }
    return { wasLiar, wasCurrentTurn };
  },
  resetGameState: (room) => {
    room.realWord         = '';
    room.liarId           = null;
    room.turnOrder        = [];
    room.currentTurnIndex = 0;
    room.currentTurn      = null;
    room.turnDeadline     = null;
    room.hints            = [];
    room.cycleCount       = 0;
    room.continueVotes    = {};
    room.accuseVotes      = {};
    room.accusedId        = null;
    room.defenseDeadline  = null;
    room.defenseLines     = [];
    room.confirmVotes     = {};
    room.guessDeadline    = null;
    room.lastResult       = null;
    room.players.forEach(p => { p.ready = false; p.role = null; p.word = null; });
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { activeParticipants };
export { manager };
