/**
 * 재접속 유예(grace period) 자리 관리.
 *
 * 모바일에서 화면을 끄거나 다른 앱으로 잠깐 넘어가면 OS 가 소켓을 닫아버려
 * 서버에는 그냥 disconnect 로 보인다. 곧바로 방에서 빼면 돌아왔을 때 판이 사라지므로,
 * 자리를 잠시 붙잡아 두고(hold) 같은 클라이언트가 돌아오면 돌려준다(claim).
 * 유예 시간이 지나면 그제서야 원래의 이탈 처리(onExpire)를 돌린다.
 *
 * 클라이언트 식별자(cid)는 브라우저 탭마다 하나씩 발급해 socket.handshake.auth.cid 로 보낸다.
 * 소켓 id 는 재접속 때 바뀔 수 있으므로 자리 매칭 기준으로 쓸 수 없다.
 */
const seats = new Map(); // `${ns}:${cid}` → { roomCode, oldId, kind, timer, onExpire }

const keyOf = (ns, cid) => `${ns}:${cid}`;

/**
 * 자리를 유예 시간 동안 붙잡아 둔다.
 * cid 가 없는(구버전) 클라이언트는 붙잡을 방법이 없으므로 즉시 이탈 처리한다.
 * @returns {boolean} 붙잡아 뒀으면 true, 즉시 처리했으면 false
 */
export function holdSeat({ ns, cid, roomCode, oldId, kind, graceMs, onExpire }) {
  if (!cid) { onExpire(); return false; }

  const key  = keyOf(ns, cid);
  const prev = seats.get(key);
  // 같은 탭이 이미 다른 자리를 붙잡고 있었다면 그 자리는 정리한다.
  if (prev) { clearTimeout(prev.timer); prev.onExpire(); }

  const seat = { roomCode, oldId, kind, onExpire };
  seat.timer = setTimeout(() => {
    seats.delete(key);
    onExpire();
  }, graceMs);
  seats.set(key, seat);
  return true;
}

/** 재접속한 클라이언트가 붙잡아 둔 자리를 되찾는다. 없으면 null */
export function claimSeat(ns, cid) {
  if (!cid) return null;
  const key  = keyOf(ns, cid);
  const seat = seats.get(key);
  if (!seat) return null;
  clearTimeout(seat.timer);
  seats.delete(key);
  return seat;
}

/** 붙잡아 둔 자리를 지금 즉시 이탈 처리한다 (명시적 퇴장·다른 방 입장 등) */
export function expireSeat(ns, cid) {
  const seat = claimSeat(ns, cid);
  if (seat) seat.onExpire();
  return !!seat;
}
