import { rooms, getRoomOf, safeState, removePlayer, removeSpectator, manager, nextAlive } from './rooms.js';
import { WORDCHAIN_TURN_TIMEOUT, WORDCHAIN_RETURN_DELAY, WORDCHAIN_MAX_WORD_LEN } from '../../config.js';
import { validateWord } from './chainLogic.js';
import { hasWord } from './dictionary.js';
import { registerCommonHandlers, broadcastRoomList } from '../../shared/socketHandlers.js';
import { recordPlayers } from '../../db/stats.js';

// ── 타이머 관리 ───────────────────────────────────────────────────────────────
const turnTimers   = new Map();
const returnTimers = new Map();

function clearTurnTimer(code) {
  clearTimeout(turnTimers.get(code));
  turnTimers.delete(code);
}

function clearReturnTimer(code) {
  clearTimeout(returnTimers.get(code));
  returnTimers.delete(code);
}

// 턴 시작: 마감시각 설정 + 브로드캐스트, 시간 초과 시 현재 차례 탈락
function startTurnTimer(io, room) {
  clearTurnTimer(room.code);
  room.turnDeadline = Date.now() + WORDCHAIN_TURN_TIMEOUT * 1000;
  io.to(room.code).emit('room_update', safeState(room));

  turnTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'playing') return;
    const current = r.players.find(p => p.id === r.currentTurn);
    if (!current) return;
    eliminate(io, r, current);
  }, WORDCHAIN_TURN_TIMEOUT * 1000));
}

// 시간 초과 탈락 → 1명 남으면 라운드 종료, 아니면 같은 글자로 다음 생존자에게
function eliminate(io, room, player) {
  player.alive = false;
  io.to(room.code).emit('wordchain_out', { playerId: player.id, playerName: player.name });

  const alive = room.players.filter(p => p.alive);
  if (alive.length <= 1) return endRound(io, room, alive[0] ?? null);

  room.currentTurn = nextAlive(room, player.id)?.id ?? null;
  startTurnTimer(io, room);
}

function endRound(io, room, winnerPlayer) {
  clearTurnTimer(room.code);
  room.state        = 'roundEnd';
  room.currentTurn  = null;
  room.turnDeadline = null;
  room.winner       = winnerPlayer ? { id: winnerPlayer.id, name: winnerPlayer.name } : null;
  if (winnerPlayer) winnerPlayer.wins = (winnerPlayer.wins ?? 0) + 1;

  // 마지막까지 살아남은 사람이 승리, 나머지는 패배
  recordPlayers('wordchain', room.players, p => {
    if (!winnerPlayer)              return 'draw';
    return p.id === winnerPlayer.id ? 'win' : 'lose';
  });

  io.to(room.code).emit('wordchain_result', {
    winnerId:    winnerPlayer?.id   ?? null,
    winnerName:  winnerPlayer?.name ?? null,
    chainLength: room.chain.length,
  });
  io.to(room.code).emit('room_update', safeState(room));
  startReturnTimer(io, room);
}

function startReturnTimer(io, room) {
  clearReturnTimer(room.code);
  returnTimers.set(room.code, setTimeout(() => {
    const r = rooms.get(room.code);
    if (!r || r.state !== 'roundEnd') return;
    r.state        = 'lobby';
    r.chain        = [];
    r.usedWords    = null;
    r.winner       = null;
    r.players.forEach(p => { p.ready = false; p.alive = true; });
    io.to(r.code).emit('room_update', safeState(r));
    broadcastRoomList(io, manager, 'wordchain_rooms_update');
  }, WORDCHAIN_RETURN_DELAY * 1000));
}

export function registerWordchainHandlers(io, socket) {
  const { broadcastRooms, err, validateStartGame, registerLeaveFlow } =
    registerCommonHandlers(io, socket, manager, {
      roomsEvent:       'wordchain_rooms_update',
      spectateCheck:    'notLobby',
      joinPlayerFields: () => ({ alive: true, wins: 0 }),
    });

  // ── 게임 시작 ──────────────────────────────────────────────────────────────
  socket.on('start_game', () => {
    const { ok, room } = validateStartGame();
    if (!ok) return;

    room.state     = 'playing';
    room.round    += 1;
    room.chain     = [];
    room.usedWords = new Set();
    room.winner    = null;
    room.players.forEach(p => { p.ready = false; p.alive = true; });
    // 라운드마다 첫 차례를 돌아가며 배정
    room.currentTurn = room.players[(room.round - 1) % room.players.length].id;

    startTurnTimer(io, room); // room_update 브로드캐스트 포함
    broadcastRooms();
  });

  // ── 단어 제출 ──────────────────────────────────────────────────────────────
  socket.on('submit_word', ({ word } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player?.alive)                  return err('이미 탈락했습니다.');
    if (room.currentTurn !== socket.id)  return err('지금 내 차례가 아닙니다.');

    const w        = typeof word === 'string' ? word.trim() : '';
    const prevWord = room.chain.length ? room.chain[room.chain.length - 1].word : null;
    const errMsg   = validateWord(w, prevWord, room.usedWords, WORDCHAIN_MAX_WORD_LEN, hasWord);
    if (errMsg) return err(errMsg);

    room.chain.push({ word: w, playerId: player.id, playerName: player.name });
    room.usedWords.add(w);
    room.currentTurn = nextAlive(room, socket.id)?.id ?? null;

    io.to(room.code).emit('wordchain_word', { word: w, playerId: player.id, playerName: player.name });
    startTurnTimer(io, room);
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

    const wasPlaying = room.state === 'playing';
    const result     = removePlayer(room, id); // onPlayerLeave가 currentTurn을 다음 생존자로 넘긴다

    if (result.deleted) {
      clearTurnTimer(room.code);
      clearReturnTimer(room.code);
      broadcastRooms();
      return;
    }

    if (result.alone) {
      clearTurnTimer(room.code);
      clearReturnTimer(room.code);
      if (wasPlaying || room.state === 'roundEnd') {
        io.to(result.remainingId).emit('alone_in_room', { message: `${result.leaverName}님이 나가 혼자 남았습니다.` });
      }
      io.to(room.code).emit('room_update', safeState(room));
      broadcastRooms();
      return;
    }

    if (wasPlaying && room.state === 'playing') {
      const alive = room.players.filter(p => p.alive);
      if (alive.length <= 1) {
        endRound(io, room, alive[0] ?? null);
      } else if (result.wasCurrent) {
        startTurnTimer(io, room); // 나간 사람 차례였으면 새 차례로 타이머 재시작
      } else {
        io.to(room.code).emit('room_update', safeState(room));
      }
    } else {
      io.to(room.code).emit('room_update', safeState(room));
    }
    broadcastRooms();
  }

  registerLeaveFlow(leaveRoom, {
    immediate: () => console.log(`[wordchain disconnect] ${socket.id}`),
  });
}
