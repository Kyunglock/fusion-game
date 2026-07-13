export const PORT        = process.env.PORT || 4000;
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
