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

// ── 캐치마인드 (그림 갤러리) ──────────────────────────────────────────────────
// 방을 만들지 않고 혼자 들어와서 그리거나, 남이 그려둔 그림을 맞히는 비동기 게임.
// 그린 그림은 DB에 쌓이고, 맞히기는 그 더미에서 아직 안 본 그림을 한 장씩 꺼내 준다.
export const CATCHMIND_MAX_ATTEMPTS      = 5; // 한 그림당 정답 시도 횟수 (소진하면 패)
export const CATCHMIND_REPORTS_TO_HIDE   = 3; // 이만큼 신고가 쌓이면 출제에서 자동 제외
// 이 횟수만큼 틀리면 그 사람에게 초성이 보인다 (마지막 한 번을 남겨두고 주는 구제책).
export const CATCHMIND_HINT_AFTER_ATTEMPTS = 4;
// 초성 공개 여부는 시도 횟수로만 갈리므로 맞혔을 때 점수는 하나뿐이다.
export const CATCHMIND_SCORE_SOLVE       = 3;
// 그림 용량 상한. 좌표는 정수로 정규화해 넣으므로 이 정도면 넉넉하다.
export const CATCHMIND_MAX_STROKES       = 300;    // 획 개수
export const CATCHMIND_MAX_POINTS        = 12_000; // 전체 점 개수
export const CATCHMIND_MAX_JSON_BYTES    = 200_000;

export const LIAR_MAX_PLAYERS     = 9;  // 최대 9명 (방장도 참가자로 함께 플레이)
export const LIAR_MIN_PLAYERS     = 3;  // 최소 3명 (방장 포함, 라이어 1 + 시민 2 이상)
// 라이어 게임은 힌트·투표가 실시간으로 맞물려 돌아가므로 공용 90초 유예(SOCKET_RECONNECT_GRACE_MS)는
// 너무 길다 — 끊긴 사람 자리를 60초만 붙잡아 두고, 그래도 안 돌아오면 자동으로 내보낸다.
export const LIAR_RECONNECT_GRACE_MS = 60_000;
export const LIAR_HINT_TIMEOUT    = 15; // 힌트 제출 제한시간 (초), 못 내면 힌트 없이 다음 차례로
export const LIAR_DEFENSE_TIMEOUT = 60; // 라이어로 지목된 사람의 최후 반론 제한시간 (초). '반론 종료'로 조기 종료 가능
export const LIAR_GUESS_TIMEOUT   = 30; // 라이어가 진짜 제시어를 맞힐 제한시간 (초), 못 내면 시민 승리
// 위 세 시간은 모두 방장이 대기실에서 실시간으로 조절 가능 (set_hint_timeout/set_defense_timeout/set_guess_timeout)
// 제시어는 대기실에서 게임 시작 시 자동 배정되므로(jamoWords.js 재사용) 방장의 수동 입력 단계가 없다.
// 라운드 종료 후 대기실로 돌아가 다시 전원 준비 → 게임 시작으로 다음 라운드를 시작한다.
