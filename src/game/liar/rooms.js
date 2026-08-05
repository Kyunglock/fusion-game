import { createRoomManager } from '../../shared/roomManager.js';
import { LIAR_MAX_PLAYERS, LIAR_MIN_PLAYERS, LIAR_HINT_TIMEOUT } from '../../config.js';

/**
 * 라이어 게임 — 방장은 자모 워들처럼 진행만 담당하고 게임에 참여하지 않는다.
 * 참가자(non-host) 중 한 명이 무작위로 라이어가 되어 방장이 정해준 '가짜 제시어'를
 * 받고, 나머지는 '진짜 제시어'를 받는다. room.state 로 라운드 진행 단계를 표현한다:
 *
 *   lobby → wordSetup(방장이 두 제시어 입력) → hint(순서대로 힌트) →
 *   voteContinue(한 바퀴 더 vs 라이어 지목) → [voteLiar(지목 투표) → defense(최후 반론
 *   10초) → confirmAccuse(그대로 진행 vs 철회) → [liarGuess(라이어가 진짜 제시어 맞히기)]]
 *   → wordSetup(결과 공개, 다음 라운드 대기)
 *
 * 참가자의 역할(role)·제시어(word)는 뷰어별로 감춰야 하므로 safeState 에는 넣지 않고
 * socket.js 의 emitLiarState 가 개인화된 이벤트로 따로 보낸다.
 *
 * 투표 집계(votesIn/votesNeeded)는 재접속 유예 중(disconnected)인 참가자를 분모에서
 * 뺀다 — 안 그러면 끊긴 사람 몫만큼 영원히 채워지지 않아 투표가 멈춘 것처럼 보인다.
 */
function activeParticipants(room) {
  return room.players.filter(p => !p.isHost && !p.disconnected);
}

const manager = createRoomManager({
  maxPlayers: LIAR_MAX_PLAYERS,
  minPlayers: LIAR_MIN_PLAYERS,
  extraRoomFields: {
    hintTimeout:      LIAR_HINT_TIMEOUT, // 방장이 대기실에서 조절 가능 (초)
    realWord:         '',
    liarWord:         '',
    liarId:           null,
    turnOrder:        [],   // 참가자 id 배열 (라운드 시작 시 무작위 셔플, 시계방향 순서)
    currentTurnIndex: 0,
    currentTurn:      null,
    turnDeadline:     null,
    hints:            [],   // [{ playerId, playerName, text, skipped }]
    cycleCount:       0,    // 몇 바퀴를 돌았는지
    continueVotes:    {},   // playerId → 'accuse' | 'continue'
    accuseVotes:      {},   // playerId → 지목한 대상 playerId
    accusedId:        null, // voteLiar 결과로 지목된 사람 (defense~liarGuess 단계에서 공개)
    defenseDeadline:  null, // 최후 반론 10초 마감 시각
    defenseLines:     [],   // 지목된 사람이 반론 시간에 적은 글 [{ text }]
    confirmVotes:     {},   // playerId → 'proceed' | 'withdraw'
    lastResult:       null, // { winnerRole, liarName, realWord, liarWord } — wordSetup 단계에서만 공개
  },
  defaultPlayerFields: { role: null, word: null, wins: 0 },
  safePlayer: (p) => ({
    id: p.id, name: p.name, avatar: p.avatar,
    isHost: p.isHost, ready: p.ready, wins: p.wins || 0,
  }),
  extraStateFields: (room) => {
    const participants = activeParticipants(room);
    const inRound = room.state === 'hint' || room.state === 'voteContinue' ||
                    room.state === 'voteLiar' || room.state === 'defense' ||
                    room.state === 'confirmAccuse' || room.state === 'liarGuess';
    const votesMap = room.state === 'voteContinue' ? room.continueVotes
                    : room.state === 'voteLiar'      ? room.accuseVotes
                    : room.state === 'confirmAccuse'  ? room.confirmVotes
                    : null;
    return {
      minPlayers:   LIAR_MIN_PLAYERS,
      hintTimeout:  room.hintTimeout,
      hints:        inRound ? room.hints : [],
      currentTurn:  room.state === 'hint' ? room.currentTurn  : null,
      turnDeadline: room.state === 'hint' ? room.turnDeadline : null,
      cycleCount:   room.cycleCount,
      votesIn:      votesMap ? Object.keys(votesMap).length : 0,
      votesNeeded:  votesMap ? participants.length : 0,
      votedIds:     votesMap ? Object.keys(votesMap) : [],
      accusedId:    (room.state === 'defense' || room.state === 'confirmAccuse' || room.state === 'liarGuess') ? room.accusedId : null,
      defenseDeadline: room.state === 'defense' ? room.defenseDeadline : null,
      defenseLines: (room.state === 'defense' || room.state === 'confirmAccuse') ? room.defenseLines : [],
      // 결과·정답 공개는 다음 라운드 대기(wordSetup) 단계에서만
      lastResult:   room.state === 'wordSetup' ? room.lastResult : null,
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
    room.liarWord         = '';
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
    room.lastResult       = null;
    room.players.forEach(p => { p.ready = false; p.role = null; p.word = null; });
  },
});

export const { rooms, createRoom, getRoomOf, getRoomOfSpectator, getRooms, safeState, removePlayer, removeSpectator } = manager;
export { activeParticipants };
export { manager };
