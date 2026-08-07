import { SOCKET_RECONNECT_GRACE_MS } from '../config.js';
import { GAME_SERVERS, serverChannel } from '../servers.js';
import { holdSeat, claimSeat, expireSeat } from './reconnect.js';

/**
 * 방 목록 브로드캐스트 — 서버(채널)별로 갈라서 보낸다.
 * 소켓 핸들러 바깥(타이머 콜백 등 socket 이 없는 자리)에서도 쓰라고 따로 뺐다.
 */
export function broadcastRoomList(io, manager, roomsEvent) {
  for (const s of GAME_SERVERS) {
    io.to(serverChannel(s.id)).emit(roomsEvent, manager.getRooms(s.id));
  }
}

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
    markDisconnected, rebind,
  } = manager;

  // 재접속 유예 식별자. ns 는 네임스페이스 이름, cid 는 브라우저 탭마다 하나씩 발급되는 값.
  const nsName = io.name ?? io.sockets?.name ?? '/';
  const cid    = socket.handshake?.auth?.cid ?? null;

  // 이 네임스페이스에 현재 연결된 소켓 id 집합.
  // (기본 네임스페이스는 io=Server → io.sockets.sockets, 그 외는 io=Namespace → io.sockets)
  function liveIds() {
    const s   = io.sockets;
    const map = (s && s.sockets instanceof Map) ? s.sockets : s;
    return new Set(map ? map.keys() : []);
  }

  // ── 세션 헬퍼 ───────────────────────────────────────────────────────��───
  const session          = () => socket.request.session;
  const sessionName      = () => session()?.username;
  const sessionAvatar    = () => session()?.avatar    ?? null;
  // 로그인 계정(users.id). 게스트는 null → 전적을 남기지 않는다.
  const sessionAccountId = () => session()?.accountId ?? null;
  // 이 소켓이 들어와 있는 서버(채널). 없으면 방을 만들 수도 들어갈 수도 없다.
  // (핸드셰이크 시점의 세션 스냅샷이라, 서버를 바꾸면 페이지를 다시 여는 것이 전제다)
  const sessionServerId  = () => session()?.serverId  ?? null;
  const myServerId       = sessionServerId();

  // 서버별 방 목록 브로드캐스트를 받도록 채널에 넣어둔다.
  if (myServerId) socket.join(serverChannel(myServerId));

  // ── 브로드캐스트 헬퍼 ────────────────────────────────────────────────────
  const broadcast      = (room) => io.to(room.code).emit('room_update', safeState(room));
  const broadcastRooms = ()     => {
    reapDisconnected(liveIds());
    broadcastRoomList(io, manager, roomsEvent);
  };
  const err            = (msg)  => socket.emit('error_msg', { message: msg });

  // 다른 서버의 방은 없는 방으로 취급한다 (코드를 알아도 들어올 수 없다).
  const visible = (room) => !!room && !!myServerId && room.serverId === myServerId;

  // ── get_rooms ────────────────────────────────────────────────────────────
  socket.on('get_rooms', () => {
    reapDisconnected(liveIds());
    socket.emit(roomsEvent, getRooms(myServerId));
  });

  // ── create_room ──────────────────────────────────────────────────────────
  socket.on('create_room', ({ playerName } = {}) => {
    if (!myServerId) return err('서버를 먼저 선택해주세요.');
    expireSeat(nsName, cid); // 재접속 유예로 붙잡아 둔 이전 자리가 있으면 정리한다
    const name     = (sessionName() || playerName || '플레이어').trim().slice(0, 16);
    const room     = createRoom(socket.id, name, sessionAvatar(), session()?.userId ?? null, sessionAccountId(), myServerId);
    socket.join(room.code);
    socket.emit('room_created', { code: room.code });
    socket.emit('chat_history', room.chatHistory);
    broadcast(room);
    broadcastRooms();
  });

  // ── join_room ────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, playerName } = {}) => {
    expireSeat(nsName, cid);
    const code     = (roomCode || '').trim();
    const name     = (sessionName() || playerName || '플레이어').trim().slice(0, 16);
    const room     = getRoomOf(socket.id)?.code === code ? null : rooms.get(code);

    if (!visible(room))                              return err('존재하지 않는 방입니다.');
    if (room.state !== 'lobby')                      return err('이미 게임이 진행 중인 방입니다.');
    if (room.players.length >= maxPlayers)            return err('방이 꽉 찼습니다.');
    if (room.players.some(p => p.id === socket.id))  return err('이미 입장한 방입니다.');
    if (room.players.some(p => p.name === name))     return err(`'${name}' 닉네임이 이미 사용 중입니다.`);

    room.players.push({
      id: socket.id, userId: session()?.userId ?? null, accountId: sessionAccountId(),
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
    expireSeat(nsName, cid);
    const code = (roomCode || '').trim();
    const name = (sessionName() || playerName || '관전자').trim().slice(0, 16);
    const room = rooms.get(code);

    if (!visible(room))                              return err('존재하지 않는 방입니다.');

    const canSpectate = spectateCheck === 'playing'
      ? room.state === 'playing'
      : room.state !== 'lobby';
    if (!canSpectate)                                return err('아직 게임이 시작되지 않았습니다.');
    if (!room.allowSpectators)                       return err('이 방은 관전이 허용되지 않습니다.');
    if (room.spectators.some(s => s.id === socket.id)) return err('이미 관전 중인 방입니다.');
    if (room.players.some(p => p.id === socket.id))  return err('이미 플레이어로 참여 중입니다.');

    room.spectators.push({
      id: socket.id, userId: session()?.userId ?? null, accountId: sessionAccountId(),
      name, avatar: sessionAvatar(),
    });
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
    // 방 브로드캐스트를 더 받지 않도록 소켓도 방에서 빼준다.
    io.in(targetId).socketsLeave(room.code);

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

  // ── 이탈 / 재접속 ─────────────────────────────────────────────────────────
  /**
   * 게임별 이탈 처리를 등록한다. 연결이 끊겼다고 곧바로 방에서 빼지 않고
   * SOCKET_RECONNECT_GRACE_MS 동안 자리를 붙잡아 둔 뒤, 돌아오지 않으면 그때 뺀다.
   * (모바일 절전·앱 전환으로 소켓이 닫히는 경우를 판이 끝난 것으로 오해하지 않기 위함)
   *
   * @param {function(string):void} leaveFn - 실제 이탈 처리. socket id 를 인자로 받는다
   * @param {object}   [opts]
   * @param {function} [opts.immediate] - 유예 없이 disconnect 즉시 해야 하는 처리 (접속자 목록 등)
   * @param {function} [opts.onResume]  - 재접속 성공 시 게임별 상태 재전송 (room, socket)
   * @param {number}   [opts.graceMs]   - 유예 시간 재정의 (게임별로 더 짧게 두고 싶을 때, 기본 SOCKET_RECONNECT_GRACE_MS)
   */
  function registerLeaveFlow(leaveFn, { immediate = null, onResume = null, graceMs = SOCKET_RECONNECT_GRACE_MS } = {}) {
    socket.on('disconnect', (reason) => {
      console.log(`[reconnect-debug][${nsName}] disconnect socket=${socket.id} cid=${cid} reason=${reason} t=${new Date().toISOString()}`);
      immediate?.();

      const marked = markDisconnected(socket.id);
      if (!marked) return; // 방에 속해 있지 않으면 붙잡아 둘 자리도 없다

      const { room, kind } = marked;
      const leaverId = socket.id;
      const held = holdSeat({
        ns: nsName, cid, roomCode: room.code, oldId: leaverId, kind,
        graceMs,
        onExpire: () => {
          console.log(`[reconnect-debug][${nsName}] seat EXPIRED cid=${cid} oldId=${leaverId} t=${new Date().toISOString()}`);
          leaveFn(leaverId);
        },
      });
      console.log(`[reconnect-debug][${nsName}] seat held=${held} cid=${cid} oldId=${leaverId} room=${room.code} t=${new Date().toISOString()}`);
      // cid 가 없는 클라이언트는 holdSeat 안에서 이미 이탈 처리됐다.
      if (!held) return;

      const member = kind === 'spectator'
        ? room.spectators.find(s => s.id === leaverId)
        : room.players.find(p => p.id === leaverId);
      io.to(room.code).emit('member_connection', { name: member?.name ?? '', connected: false });
      io.to(room.code).emit('room_update', safeState(room));
      broadcastRooms();
    });

    // 사용자가 직접 '나가기'를 누른 경우 — 유예 없이 바로 뺀다.
    socket.on('leave_room', () => {
      expireSeat(nsName, cid);
      const room = getRoomOf(socket.id) ?? getRoomOfSpectator(socket.id);
      leaveFn(socket.id);
      if (room) socket.leave(room.code);
      socket.emit(roomsEvent, getRooms(myServerId));
    });

    // 재접속 — 붙잡아 둔 자리에 새 소켓을 다시 연결한다.
    socket.on('resume_room', ({ roomCode } = {}) => {
      console.log(`[reconnect-debug][${nsName}] resume_room requested socket=${socket.id} cid=${cid} roomCode=${roomCode} t=${new Date().toISOString()}`);
      const seat = claimSeat(nsName, cid);
      const fail = (why) => {
        console.log(`[reconnect-debug][${nsName}] resume_room FAILED socket=${socket.id} cid=${cid} why=${why} t=${new Date().toISOString()}`);
        socket.emit('resume_failed');
      };

      if (!seat) return fail('no-seat-held (server hasn\'t marked old socket disconnected yet, or grace already expired)');
      // 클라이언트가 기억하는 방과 붙잡아 둔 자리가 다르면 자리를 정리하고 로비로 돌린다.
      if (roomCode && seat.roomCode !== roomCode) { seat.onExpire(); return fail('room-code-mismatch'); }

      const room = rooms.get(seat.roomCode);
      if (!room || !rebind(room, seat.oldId, socket.id, seat.kind)) {
        seat.onExpire();
        return fail('room-missing-or-rebind-failed');
      }
      console.log(`[reconnect-debug][${nsName}] resume_room SUCCESS socket=${socket.id} cid=${cid} room=${room.code} t=${new Date().toISOString()}`);

      socket.join(room.code);
      socket.emit('chat_history', room.chatHistory);
      socket.emit('resumed', { roomCode: room.code, isSpectator: seat.kind === 'spectator' });

      const member = seat.kind === 'spectator'
        ? room.spectators.find(s => s.id === socket.id)
        : room.players.find(p => p.id === socket.id);
      socket.to(room.code).emit('member_connection', { name: member?.name ?? '', connected: true });

      onResume?.(room, socket);
      io.to(room.code).emit('room_update', safeState(room));
      broadcastRooms();
    });
  }

  // 공개 API
  return {
    session, sessionName, sessionAvatar, sessionAccountId,
    broadcast, broadcastRooms, err,
    validateStartGame, registerLeaveFlow,
  };
}
