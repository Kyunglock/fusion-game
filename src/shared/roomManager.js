import crypto from 'crypto';

/**
 * 범용 방 관리자 팩토리.
 * 각 게임에서 createRoomManager(config)를 호출하면
 * rooms Map과 공통 CRUD 함수를 돌려준다.
 */
export function createRoomManager({
  maxPlayers,
  minPlayers,
  /** 방 생성 시 추가 필드 (예: { trapTooth: null, round: 0 }) */
  extraRoomFields = {},
  /** 플레이어 join 시 기본 필드 (예: { score: 0 }) */
  defaultPlayerFields = {},
  /** safeState 에 추가로 포함할 필드 추출기 */
  extraStateFields = (_room) => ({}),
  /** 플레이어를 safe 변환 (기본: 그대로) */
  safePlayer = (p) => p,
  /** removePlayer 후 게임 상태 초기화 로직 */
  resetGameState = (_room) => {},
  /** removePlayer 중 게임 고유 처리 (폭탄 넘기기 등). 반환값이 있으면 그것을 result에 merge */
  onPlayerLeave = (_room, _socketId) => null,
}) {
  const rooms = new Map();

  function generateRoomCode() {
    let code;
    do { code = crypto.randomInt(1000, 9999).toString(); } while (rooms.has(code));
    return code;
  }

  function createRoom(hostId, hostName, hostAvatar = null, hostUserId = null) {
    const code = generateRoomCode();
    rooms.set(code, {
      code,
      players: [{
        id: hostId, userId: hostUserId, name: hostName,
        avatar: hostAvatar,
        isHost: true, ready: false,
        ...defaultPlayerFields,
      }],
      spectators:      [],
      allowSpectators: true,
      state:           'lobby',
      chatHistory:     [],
      ...extraRoomFields,
    });
    return rooms.get(code);
  }

  function getRoomOf(socketId) {
    for (const room of rooms.values()) {
      if (room.players.some(p => p.id === socketId)) return room;
    }
    return null;
  }

  function getRoomOfSpectator(socketId) {
    for (const room of rooms.values()) {
      if (room.spectators.some(s => s.id === socketId)) return room;
    }
    return null;
  }

  function getRooms() {
    return [...rooms.values()]
      .filter(r => r.state === 'lobby' || (r.state !== 'lobby' && r.allowSpectators))
      .map(r => {
        const host = r.players.find(p => p.isHost);
        return {
          code:            r.code,
          hostName:        host?.name     ?? '',
          playerCount:     r.players.length,
          maxPlayers,
          spectatorCount:  r.spectators.length,
          isPlaying:       r.state !== 'lobby',
          allowSpectators: r.allowSpectators,
        };
      });
  }

  function safeState(room) {
    return {
      code:            room.code,
      players:         room.players.map(safePlayer),
      spectators:      room.spectators.map(s => ({ id: s.id, name: s.name, avatar: s.avatar })),
      allowSpectators: room.allowSpectators,
      state:           room.state,
      ...extraStateFields(room),
    };
  }

  function removePlayer(room, socketId) {
    const leaverName = room.players.find(p => p.id === socketId)?.name ?? '플레이어';

    // 게임 고유 처리 (폭탄 넘기기 등) — removePlayer 전에 호출
    const extra = onPlayerLeave(room, socketId);

    room.players = room.players.filter(p => p.id !== socketId);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      return { deleted: true, alone: false, leaverName, ...extra };
    }

    if (!room.players.some(p => p.isHost)) room.players[0].isHost = true;

    if (room.players.length < minPlayers) {
      const remainingId = room.players[0].id;
      room.state = 'lobby';
      resetGameState(room);
      room.players.forEach(p => { p.ready = false; });
      return { deleted: false, alone: true, remainingId, leaverName, ...extra };
    }

    return { deleted: false, alone: false, leaverName, ...extra };
  }

  function removeSpectator(room, socketId) {
    const name = room.spectators.find(s => s.id === socketId)?.name ?? '관전자';
    room.spectators = room.spectators.filter(s => s.id !== socketId);
    return name;
  }

  // 연결이 끊긴 소켓만 남은 방을 청소한다.
  // (disconnect 이벤트를 놓쳤거나 소켓이 유실된 경우 남는 유령 방 방지)
  // liveIds: 해당 네임스페이스에 현재 연결된 소켓 id의 Set
  function reapDisconnected(liveIds) {
    let changed = false;
    for (const [code, room] of rooms) {
      const anyAlive = room.players.some(p => liveIds.has(p.id));
      if (!anyAlive) { rooms.delete(code); changed = true; }
    }
    return changed;
  }

  return {
    rooms,
    maxPlayers,
    minPlayers,
    createRoom,
    getRoomOf,
    getRoomOfSpectator,
    getRooms,
    safeState,
    removePlayer,
    removeSpectator,
    reapDisconnected,
  };
}
