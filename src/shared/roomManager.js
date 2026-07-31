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
  /** 관전자를 safe 변환 (기본: id/이름/아바타만) */
  safeSpectator = (s) => ({ id: s.id, name: s.name, avatar: s.avatar }),
  /** removePlayer 후 게임 상태 초기화 로직 */
  resetGameState = (_room) => {},
  /** removePlayer 중 게임 고유 처리 (폭탄 넘기기 등). 반환값이 있으면 그것을 result에 merge */
  onPlayerLeave = (_room, _socketId) => null,
  /**
   * 재접속으로 소켓 id 가 바뀔 때 게임 상태에 박혀 있는 id 참조를 갱신한다.
   * (폭탄 소유자·현재 차례·승자 등. 인덱스로만 관리하는 값은 손댈 필요 없다)
   */
  remapPlayerId = (_room, _oldId, _newId) => {},
}) {
  const rooms = new Map();

  function generateRoomCode() {
    let code;
    do { code = crypto.randomInt(1000, 9999).toString(); } while (rooms.has(code));
    return code;
  }

  function createRoom(hostId, hostName, hostAvatar = null, hostUserId = null, hostAccountId = null) {
    const code = generateRoomCode();
    rooms.set(code, {
      code,
      players: [{
        id: hostId, userId: hostUserId, accountId: hostAccountId, name: hostName,
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
    // disconnected: 재접속 유예 중(잠시 연결이 끊긴 상태)임을 모든 게임에서 공통으로 알린다.
    return {
      code:            room.code,
      players:         room.players.map(p => ({ ...safePlayer(p), disconnected: !!p.disconnected })),
      spectators:      room.spectators.map(s => ({ ...safeSpectator(s), disconnected: !!s.disconnected })),
      allowSpectators: room.allowSpectators,
      state:           room.state,
      ...extraStateFields(room),
    };
  }

  // ── 재접속 유예 ────────────────────────────────────────────────────────────
  /**
   * 연결이 끊긴 사람을 방에서 빼지 않고 '연결 끊김' 표시만 한다.
   * @returns {{room: object, kind: 'player'|'spectator'}|null} 방에 속해 있지 않으면 null
   */
  function markDisconnected(socketId) {
    for (const room of rooms.values()) {
      const p = room.players.find(x => x.id === socketId);
      if (p) { p.disconnected = true; return { room, kind: 'player' }; }
      const s = room.spectators.find(x => x.id === socketId);
      if (s) { s.disconnected = true; return { room, kind: 'spectator' }; }
    }
    return null;
  }

  /** 재접속한 소켓을 붙잡아 둔 자리에 다시 연결한다. */
  function rebind(room, oldId, newId, kind) {
    const list   = kind === 'spectator' ? room.spectators : room.players;
    const member = list.find(x => x.id === oldId);
    if (!member) return false;
    // 같은 소켓 id 로 복구된 경우(연결 상태 복구)는 플래그만 내린다.
    if (oldId !== newId) {
      if (list.some(x => x.id === newId)) return false;
      member.id = newId;
      // 지난 채팅의 '내 메시지' 판별이 어긋나지 않도록 발신자 id 도 함께 옮긴다.
      room.chatHistory.forEach(m => { if (m.senderId === oldId) m.senderId = newId; });
      if (kind !== 'spectator') remapPlayerId(room, oldId, newId);
    }
    member.disconnected = false;
    return true;
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
      // 재접속 유예 중인 사람(disconnected)은 아직 살아 있는 자리로 본다.
      const anyAlive = room.players.some(p => liveIds.has(p.id) || p.disconnected);
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
    markDisconnected,
    rebind,
  };
}
