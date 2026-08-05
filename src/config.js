export const PORT        = process.env.PORT || 4000;

// ── 연결 유지 (모바일 절전·백그라운드 대응) ───────────────────────────────────
// 휴대폰 화면이 꺼지거나 다른 앱으로 넘어가면 브라우저가 얼어붙어 ping 에 답하지 못하고,
// OS 가 소켓을 닫아버리기도 한다. 이때 곧바로 방에서 빼버리면 돌아왔을 때 판이 사라진다.
// 1) ping 을 넉넉히 기다려 잠깐 멈춘 정도로는 끊지 않고,
// 2) 그래도 끊겼다면 자리를 SOCKET_RECONNECT_GRACE_MS 동안 붙잡아 두고 재접속을 기다린다.
// 세 값 모두 환경변수로 조절할 수 있다 (배포 환경에 맞춰 늘리거나 줄이기 위함).
export const SOCKET_PING_INTERVAL      = Number(process.env.SOCKET_PING_INTERVAL) || 25_000;
export const SOCKET_PING_TIMEOUT       = Number(process.env.SOCKET_PING_TIMEOUT)  || 60_000;
export const SOCKET_RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS)   || 90_000;
export const TOTAL_TEETH = 24;
export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 2;

export const TURN_TIMEOUT      = 20; // 이빨 선택 제한시간 (초)
export const AUTO_RETURN_DELAY = 4;  // 라운드 종료 후 대기실 자동 복귀 (초)

export const BOMB_TIME_PER_PLAYER_MIN = 5;  // 폭탄 최소 폭발 시간 (인원당 초)
export const BOMB_TIME_PER_PLAYER_MAX = 10; // 폭탄 최대 폭발 시간 (인원당 초)
export const BOMB_RETURN_DELAY = 4; // 폭발 후 대기실 복귀 (초)
export const BOMB_WARN_MIN    = 3;  // 경고(흔들림) 시작 최소 시간 (폭발 N초 전)
export const BOMB_WARN_MAX    = 7;  // 경고(흔들림) 시작 최대 시간 (폭발 N초 전)

export const TETRIS_MAX_PLAYERS   = 4;
export const TETRIS_MIN_PLAYERS   = 2;
export const TETRIS_RETURN_DELAY  = 6000; // 게임 종료 후 대기실 자동 복귀 (ms)

export const JAMO_MAX_PLAYERS   = 8;
export const JAMO_MIN_PLAYERS   = 2; // 방장 + 참가자 1명 이상
export const JAMO_MAX_ATTEMPTS  = 5;
// 라운드 종료 후 방장이 게임 안에서 직접 다음 제시어를 내므로 자동 복귀 타이머는 없다.

// 자모 워들 솔로 플레이(솔플). 채점은 클라이언트가 하지만 전적은 서버가 남기므로
// 두 값은 client/js/jamoWords.js 의 SOLO_MAX_ATTEMPTS·SOLO_DIFFICULTY 와 같아야 한다.
export const JAMO_SOLO_MAX_ATTEMPTS = 6;
export const JAMO_SOLO_DIFFICULTIES = { easy: '하', medium: '중', hard: '상' };

export const WORDCHAIN_MAX_PLAYERS  = 8;
export const WORDCHAIN_MIN_PLAYERS  = 2;
export const WORDCHAIN_TURN_TIMEOUT = 15; // 단어 제출 제한시간 (초)
export const WORDCHAIN_RETURN_DELAY = 6;  // 라운드 종료 후 대기실 자동 복귀 (초)
export const WORDCHAIN_MAX_WORD_LEN = 15; // 단어 최대 글자 수

export const LIAR_MAX_PLAYERS  = 9; // 방장 + 참가자 최대 8명
export const LIAR_MIN_PLAYERS  = 4; // 방장 + 참가자 최소 3명 (라이어 1 + 시민 2 이상)
export const LIAR_HINT_TIMEOUT = 15; // 힌트 제출 제한시간 (초), 못 내면 힌트 없이 다음 차례로
// 라운드 종료 후 방장이 게임 안에서 직접 다음 제시어를 내므로 자동 복귀 타이머는 없다.
