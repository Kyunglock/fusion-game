import crypto from 'crypto';

/**
 * 게임 서버(채널) 정의.
 *
 * 물리적으로 서버를 나누는 것이 아니라 **같은 프로세스 안에서 방 목록만 갈라놓는다.**
 * 퓨전 사람들과 친구들이 서로의 방·접속자를 보지 않게 하려는 것이라, 프로세스를
 * 두 벌 띄우고 DB·전적을 쪼갤 이유가 없다. 계정·전적·등급은 그대로 공용이다.
 *
 * 입장은 서버마다 다른 비밀번호로 막는다. **비밀번호는 아래에 그대로 적혀 있다** —
 * 저장소가 공개라 누구나 볼 수 있지만, 이 관문은 아는 사람만 들이려는 잠금이 아니라
 * 두 무리를 갈라놓는 구분선에 가깝다는 판단(주인 결정). 굳이 숨겨야 할 때는 환경변수
 * (envKey)로 덮어쓰면 코드를 고치지 않고 바꿀 수 있다.
 */
export const GAME_SERVERS = [
  {
    id:      'fusion',
    name:    '퓨전 서버',
    icon:    '🏢',
    desc:    '퓨전 사람들이 모이는 서버',
    envKey:  'SERVER_PASSWORD_FUSION',
    password: 'fusion',
  },
  {
    id:      'friends',
    name:    '친구방',
    icon:    '🎉',
    desc:    '친구들끼리 노는 서버',
    envKey:  'SERVER_PASSWORD_FRIENDS',
    password: 'dlxjsjftlxl',
  },
];

const byId = new Map(GAME_SERVERS.map(s => [s.id, s]));

/** 비밀번호를 뺀, 클라이언트에 내보내도 되는 목록 */
export function publicServers() {
  return GAME_SERVERS.map(({ id, name, icon, desc }) => ({ id, name, icon, desc }));
}

export function findServer(id) {
  return byId.get(id) ?? null;
}

export function serverName(id) {
  return byId.get(id)?.name ?? null;
}

/** 서버별 방 목록 브로드캐스트에 쓰는 Socket.IO 방 이름 (방 코드와 겹치지 않게 접두사) */
export function serverChannel(id) {
  return `srv:${id}`;
}

/** 환경변수가 있으면 그쪽이 이긴다 (코드를 고치지 않고 바꾸고 싶을 때). */
function passwordOf(server) {
  return process.env[server.envKey] || server.password;
}

/**
 * 비밀번호 검증. 길이로 정답 여부가 새지 않도록 해시를 상수시간 비교한다.
 */
export function verifyServerPassword(id, password) {
  const server = byId.get(id);
  if (!server || typeof password !== 'string') return false;

  const a = crypto.createHash('sha256').update(password, 'utf8').digest();
  const b = crypto.createHash('sha256').update(passwordOf(server), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}
