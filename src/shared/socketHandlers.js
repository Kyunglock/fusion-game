/**
 * 공통 소켓 핸들러 등록.
 * 8개의 중복 핸들러를 한 곳에서 관리한다.
 *
 * @param {object} io        - Socket.IO 네임스페이스 (또는 기본 io)
 * @param {object} socket    - 개별 소켓
 * @param {object} manager   - createRoomManager()가 반환한 객체
 * @param {object} opts
 * @param {string} opts.roomsEvent       - 방 목록 브로드캐스트 이벤트명 ('rooms_update' 등)
 * @param {string} opts.spectateCheck    - 관전 가능 조건 ('notLobby' | 'playing')
 * @param {function} [opts.joinPlayerFields] - join_room 시 추가 플레이어 필드 () => ({})
 */
export function registerCommonHandlers(io, socket, manager, opts) {
  const {
    roomsEvent,
    spectateCheck = 'notLobby',
    joinPlayerFields = () => ({}),
  } = opts;

  const {
    rooms, maxPlayers, minPlayers,
    createRoom, getRoomOf, getRoomOfSpectator,
    getRooms, safeState, removePlayer, removeSpectator, reapDisconnected,
  } = manager;

  // 이 네임스페이스에 현재 연결된 소켓 id 집합.
  // (기본 네임스페이스는 io=Server → io.sockets.sockets, 그 외는 io=Namespace → io.sockets)
  function liveIds() {
    const s   = io.sockets;
    const map = (s && s.sockets instanceof Map) ? s.sockets : s;
    return new Set(map ? map.keys() : []);
  }

  // ── 세션 헬퍼 ───────────────────────────────────────────────────────��───
  const session       = () => socket.request.session;
  const sessionName   = () => session()?.username;
  const sessionAvatar = () => session()?.avatar    ?? null;

  // ── 브로드캐스트 헬퍼 ────────────────────────────────────────────────────
  const broadcast      = (room) => io.to(room.code).emit('room_update', safeState(room));
  const broadcastRooms = ()     => { reapDisconnected(liveIds()); io.emit(roomsEvent, getRooms()); };
  const err            = (msg)  => socket.emit('error_msg', { message: msg });

  // ── get_rooms ────────────────────────────────────────────────────────────
  socket.on('get_rooms', () => { reapDisconnected(liveIds()); socket.emit(roomsEvent, getRooms()); });

  // ── create_room ──────────────────────────────────────────────────────────
  socket.on('create_room', ({ playerName } = {}) => {
    const name     = (sessionName() || playerName || '플레이어').trim().slice(0, 16);
    const room     = createRoom(socket.id, name, sessionAvatar(), session()?.userId ?? null);
    socket.join(room.code);
    socket.emit('room_created', { code: room.code });
    socket.emit('chat_history', room.chatHistory);
    broadcast(room);
    broadcastRooms();
  });

  // ── join_room ────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, playerName } = {}) => {
    const code     = (roomCode || '').trim();
    const name     = (sessionName() || playerName || '플레이어').trim().slice(0, 16);
    const room     = getRoomOf(socket.id)?.code === code ? null : rooms.get(code);

    if (!room)                                       return err('존재하지 않는 방입니다.');
    if (room.state !== 'lobby')                      return err('이미 게임이 진행 중인 방입니다.');
    if (room.players.length >= maxPlayers)            return err('방이 꽉 찼습니다.');
    if (room.players.some(p => p.id === socket.id))  return err('이미 입장한 방입니다.');
    if (room.players.some(p => p.name === name))     return err(`'${name}' 닉네임이 이미 사용 중입니다.`);

    room.players.push({
      id: socket.id, userId: session()?.userId ?? null,
      name, avatar: sessionAvatar(),
      isHost: false, ready: false,
      ...joinPlayerFields(),
    });
    socket.join(code);
    socket.emit('chat_history', room.chatHistory);
    socket.to(code).emit('member_joined', { name, isSpectator: false });
    broadcast(room);
    broadcastRooms();
  });

  // ── join_as_spectator ────────────────────────────────────────────────────
  socket.on('join_as_spectator', ({ roomCode, playerName } = {}) => {
    const code = (roomCode || '').trim();
    const name = (sessionName() || playerName || '관전자').trim().slice(0, 16);
    const room = rooms.get(code);

    if (!room)                                       return err('존재하지 않는 방입니다.');

    const canSpectate = spectateCheck === 'playing'
      ? room.state === 'playing'
      : room.state !== 'lobby';
    if (!canSpectate)                                return err('아직 게임이 시작되지 않았습니다.');
    if (!room.allowSpectators)                       return err('이 방은 관전이 허용되지 않습니다.');
    if (room.spectators.some(s => s.id === socket.id)) return err('이미 관전 중인 방입니다.');
    if (room.players.some(p => p.id === socket.id))  return err('이미 플레이어로 참여 중입니다.');

    room.spectators.push({ id: socket.id, name, avatar: sessionAvatar() });
    socket.join(code);
    socket.emit('chat_history', room.chatHistory);
    socket.emit('spectate_start', safeState(room));
    socket.to(code).emit('member_joined', { name, isSpectator: true });
    io.to(code).emit('room_update', safeState(room));
    broadcastRooms();
  });

  // ── toggle_spectator_allowed ─────────────────────────────────────────────
  socket.on('toggle_spectator_allowed', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost || room.state !== 'lobby') return;
    room.allowSpectators = !room.allowSpectators;
    broadcast(room);
    broadcastRooms();
  });

  // ── kick_player ──────────────────────────────────────────────────────────
  socket.on('kick_player', ({ targetId } = {}) => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player?.isHost || room.state !== 'lobby') return;

    const target = room.players.find(p => p.id === targetId);
    if (!target || target.isHost) return;

    room.players = room.players.filter(p => p.id !== targetId);
    io.to(targetId).emit('kicked', { message: '방장에 의해 강퇴되었습니다.' });

    if (room.players.length === 0) {
      rooms.delete(room.code);
    } else {
      broadcast(room);
    }
    broadcastRooms();
  });

  // ── toggle_ready ─────────────────────────────────────────────────────────
  socket.on('toggle_ready', () => {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || room.state !== 'lobby' || !player || player.isHost) return;
    player.ready = !player.ready;
    broadcast(room);
  });

  // ── chat_message ─────────────────────────────────────────────────────────
  socket.on('chat_message', ({ text } = {}) => {
    const room      = getRoomOf(socket.id) ?? getRoomOfSpectator(socket.id);
    const player    = room?.players.find(p => p.id === socket.id);
    const spectator = room?.spectators?.find(s => s.id === socket.id);
    const sender    = player ?? spectator;
    if (!room || !sender) return;
    const msg = typeof text === 'string' ? text.trim().slice(0, 100) : '';
    if (!msg) return;
    const entry = {
      senderId:     socket.id,
      senderName:   sender.name,
      senderAvatar: sender.avatar ?? null,
      text:         msg,
    };
    room.chatHistory.push(entry);
    if (room.chatHistory.length > 100) room.chatHistory.shift();
    io.to(room.code).emit('chat_message', entry);
  });

  // ── start_game 공통 검증 유틸 ────────────────────────────────────────────
  function validateStartGame() {
    const room   = getRoomOf(socket.id);
    const player = room?.players.find(p => p.id === socket.id);
    if (!room)                             return { ok: false };
    if (!player?.isHost)                   { err('방장만 게임을 시작할 수 있습니다.'); return { ok: false }; }
    if (room.players.length < minPlayers)  { err(`최소 ${minPlayers}명이 필요합니다.`); return { ok: false }; }
    if (room.state !== 'lobby')            return { ok: false };
    const nonHosts = room.players.filter(p => !p.isHost);
    if (nonHosts.length > 0 && !nonHosts.every(p => p.ready)) {
      err('모든 플레이어가 준비 완료해야 합니다.');
      return { ok: false };
    }
    return { ok: true, room };
  }

  // 공개 API
  return {
    session, sessionName, sessionAvatar,
    broadcast, broadcastRooms, err,
    validateStartGame,
  };
}
