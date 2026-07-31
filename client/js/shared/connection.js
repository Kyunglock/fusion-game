import { io } from '/socket.io/socket.io.esm.min.js';
import { appendSystemMessage } from './chatManager.js';

/**
 * 소켓 연결 · 재접속 관리 (모바일 절전 / 앱 전환 대응)
 *
 * 휴대폰 화면이 꺼지거나 다른 앱으로 넘어가면 브라우저가 얼어붙고 OS 가 소켓을 닫는다.
 * 서버는 자리를 잠시 붙잡아 두므로(SOCKET_RECONNECT_GRACE_MS), 클라이언트는
 * 1) 화면이 돌아오는 즉시 다시 연결하고,
 * 2) 있던 방으로 복귀(resume_room)를 요청하면 된다.
 *
 * 방 코드는 sessionStorage 에 두므로 새로고침으로 페이지가 다시 뜬 경우에도 복귀한다.
 */

const CID_KEY = 'pg-cid';

function randomId() {
  return crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** 브라우저 탭마다 하나씩 발급되는 클라이언트 식별자 (소켓 id 는 재접속 때 바뀌므로 쓸 수 없다) */
function clientId() {
  try {
    let id = sessionStorage.getItem(CID_KEY);
    if (!id) { id = randomId(); sessionStorage.setItem(CID_KEY, id); }
    return id;
  } catch { return randomId(); }
}

// ── 마지막으로 있던 방 기억 ───────────────────────────────────────────────────
const roomKey = (ns) => `pg-room:${ns}`;

export function rememberRoom(ns, code) { try { if (code) sessionStorage.setItem(roomKey(ns), code); } catch { /* 무시 */ } }
export function forgetRoom(ns)         { try { sessionStorage.removeItem(roomKey(ns)); }           catch { /* 무시 */ } }
export function recallRoom(ns)         { try { return sessionStorage.getItem(roomKey(ns)); }       catch { return null; } }

// ── 재연결 안내 배너 ──────────────────────────────────────────────────────────
let bannerEl = null;

function banner() {
  if (bannerEl) return bannerEl;
  bannerEl = document.createElement('div');
  bannerEl.id = 'pg-reconnect';
  bannerEl.innerHTML = '<span class="pg-reconnect-dot"></span><span>연결이 끊겼습니다. 다시 연결하는 중…</span>';
  document.body.appendChild(bannerEl);
  return bannerEl;
}

const showBanner = () => banner().classList.add('show');
const hideBanner = () => bannerEl?.classList.remove('show');

// ── 소켓 생성 ─────────────────────────────────────────────────────────────────
export function createSocket(ns = '/') {
  return io(ns, {
    auth: { cid: clientId() },
    // 돌아왔을 때 최대한 빨리 붙도록 재시도 간격을 짧게 둔다.
    reconnectionDelay:    500,
    reconnectionDelayMax: 3000,
  });
}

/**
 * 재접속 흐름을 붙인다.
 * @param {object}   socket
 * @param {string}   ns                 - 네임스페이스 ('/', '/jamo' …)
 * @param {object}   [handlers]
 * @param {function} [handlers.onResumed] - 복귀 성공 ({ roomCode, isSpectator })
 * @param {function} [handlers.onLost]    - 복귀 실패 (유예 시간 초과 등) → 로비로 돌려야 한다
 */
export function initReconnect(socket, ns, { onResumed = null, onLost = null } = {}) {
  let everConnected = false;

  socket.on('connect', () => {
    everConnected = true;
    hideBanner();
    const code = recallRoom(ns);
    if (code) socket.emit('resume_room', { roomCode: code });
    else      socket.emit('get_rooms');
  });

  socket.on('resumed', (info) => {
    rememberRoom(ns, info?.roomCode);
    onResumed?.(info ?? {});
  });

  socket.on('resume_failed', () => {
    forgetRoom(ns);
    onLost?.();
    socket.emit('get_rooms');
  });

  // 지금 어느 방에 있는지 추적 (복귀 요청에 쓴다)
  socket.on('room_created',   ({ code } = {}) => rememberRoom(ns, code));
  socket.on('room_update',    (state)        => rememberRoom(ns, state?.code));
  socket.on('spectate_start', (state)        => rememberRoom(ns, state?.code));
  socket.on('kicked',         ()             => forgetRoom(ns));

  // 같은 방 사람의 연결이 끊기거나 돌아오면 채팅에 알린다.
  socket.on('member_connection', ({ name, connected } = {}) => {
    appendSystemMessage(connected
      ? `🔌 ${name}님이 다시 연결되었습니다`
      : `⚠️ ${name}님의 연결이 끊겼습니다 (재접속 대기 중)`);
  });

  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return; // 우리가 일부러 끊은 경우
    if (recallRoom(ns)) showBanner();
  });

  // 화면이 돌아오면 재접속 대기시간(백오프)을 기다리지 말고 바로 붙는다.
  // 최초 연결 중(everConnected=false)에 끼어들면 진행 중인 핸드셰이크를 망가뜨리므로 건드리지 않는다.
  const wake = () => { if (everConnected && socket.disconnected) socket.connect(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) wake(); }); // 뒤로가기 복원(bfcache)
  window.addEventListener('online', wake);
}

/** 사용자가 직접 방을 나갈 때 — 재접속 유예 없이 즉시 빠진다 */
export function leaveRoom(socket, ns) {
  forgetRoom(ns);
  socket.emit('leave_room');
}
