/**
 * 캐치마인드 순수 로직 — 초성 추출, 정답 판정, 그림(획) 데이터 검증.
 * DB·HTTP 를 모르는 순수 함수만 둔다 (자모 워들의 jamoLogic.js 와 같은 자리).
 */

import {
  CATCHMIND_MAX_STROKES,
  CATCHMIND_MAX_POINTS,
  CATCHMIND_MAX_JSON_BYTES,
  CATCHMIND_WORD_MIN_LEN,
  CATCHMIND_WORD_MAX_LEN,
} from '../../config.js';

// ── 초성 ──────────────────────────────────────────────────────────────────────
const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** '고양이' → 'ㄱㅇㅇ'. 한글이 아닌 글자는 그대로 둔다. */
export function chosungOf(word) {
  return [...String(word ?? '')].map((ch) => {
    const code = ch.codePointAt(0);
    if (code < HANGUL_BASE || code > HANGUL_LAST) return ch;
    return CHOSUNG[Math.floor((code - HANGUL_BASE) / 588)];
  }).join('');
}

// ── 정답 판정 ─────────────────────────────────────────────────────────────────
/**
 * 비교용으로 다듬는다. 띄어쓰기·기호 차이로 정답을 놓치는 일이 없도록
 * 공백과 문장부호를 걷어내고 영문은 소문자로 맞춘다.
 */
export function normalizeGuess(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s.,!?~'"·\-_]/g, '');
}

/** 정답인지 (완전 일치. 유사어까지 봐주면 제시어가 뭐였는지 흐려진다) */
export function isCorrect(guess, answer) {
  const g = normalizeGuess(guess);
  return g.length > 0 && g === normalizeGuess(answer);
}

// ── 직접 적는 제시어 ──────────────────────────────────────────────────────────
/**
 * 그리는 사람이 직접 적은 제시어를 검증한다.
 *
 * 사전에서 배정한 제시어와 달리 이쪽은 아무 글자나 들어올 수 있으므로,
 * **맞히는 쪽이 답을 적어낼 수 있는 모양**인지만 본다.
 *  - 완성형 한글만 — 영문·숫자·기호가 섞이면 정답이 완전 일치라 맞히기가 운이 된다
 *    (`normalizeGuess`가 걷어내는 것은 공백·문장부호뿐이다).
 *  - 자모(ㄱ·ㅏ)는 막는다 — 초성 힌트가 그대로 정답이 되어 버린다.
 *  - 글자 수는 CATCHMIND_WORD_MIN_LEN~MAX_LEN. 문장처럼 길면 30초 안에 그릴 수 없다.
 *
 * 부적절한 낱말까지 여기서 거르지는 않는다 — 그 몫은 신고(누적되면 자동으로
 * 출제 제외)에 있고, 낱말 목록으로 막으려 들면 끝이 없다.
 *
 * @returns {{ ok: true, word: string } | { ok: false, error: string }}
 */
export function validateCustomWord(raw) {
  // 띄어쓰기는 정답 판정에서 어차피 무시되므로(`normalizeGuess`) 저장 전에 걷어낸다
  // — '눈 사람'으로 올려두고 '눈사람'으로 맞히는 것이 정상 동작이라 표기를 하나로 모은다.
  const word = String(raw ?? '').replace(/\s+/g, '');
  const len  = [...word].length;

  if (len === 0) return { ok: false, error: '제시어를 적어주세요.' };
  if (len < CATCHMIND_WORD_MIN_LEN || len > CATCHMIND_WORD_MAX_LEN) {
    return {
      ok: false,
      error: `제시어는 ${CATCHMIND_WORD_MIN_LEN}~${CATCHMIND_WORD_MAX_LEN}글자로 적어주세요.`,
    };
  }
  if (!/^[가-힣]+$/u.test(word)) {
    return { ok: false, error: '제시어는 한글로만 적어주세요 (자음·모음 낱개는 안 돼요).' };
  }

  return { ok: true, word };
}

// ── 그림(획) 데이터 ───────────────────────────────────────────────────────────
/**
 * 그림은 PNG 가 아니라 **획 좌표**로 저장한다.
 *  - 용량이 이미지의 몇 분의 일이라 SQLite 에 수천 장이 쌓여도 부담이 없고,
 *  - 맞히기 화면에서 그린 순서대로 재생할 수 있다(캐치마인드의 핵심 재미),
 *  - 화면 크기와 무관하게 다시 그릴 수 있다.
 *
 * 좌표는 클라이언트가 CANVAS_W×CANVAS_H(4:3) 기준 정수로 정규화해서 보낸다.
 */
export const CANVAS_W = 1000;
export const CANVAS_H = 750;

/** 색 팔레트 — 클라이언트(client/js/catchmind.js)의 PALETTE 와 순서가 같아야 한다. */
export const PALETTE = [
  '#1f2328', '#e63946', '#f4a261', '#f5c842',
  '#2a9d5c', '#2b6cb0', '#7c5cff', '#c2185b',
];

/** 선 굵기 단계 (지우개도 이 배율을 쓴다) */
export const SIZES = [4, 10, 22];

const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};

/**
 * 클라이언트가 보낸 획 데이터를 검증하고 정규화한다.
 * 모양이 조금이라도 어긋나면 통째로 거절한다 — DB에는 믿을 수 있는 것만 넣는다.
 *
 * 입력/출력 형식: [{ c: 색인덱스, s: 굵기인덱스, e: 0|1(지우개), p: [x, y, x, y, …] }]
 *
 * @returns {{ ok: true, strokes: Array, json: string } | { ok: false, error: string }}
 */
export function sanitizeStrokes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: '그림이 비어 있습니다.' };
  }
  if (raw.length > CATCHMIND_MAX_STROKES) {
    return { ok: false, error: '획이 너무 많습니다. 조금 단순하게 그려주세요.' };
  }

  const strokes = [];
  let totalPoints = 0;

  for (const s of raw) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.p)) {
      return { ok: false, error: '그림 데이터가 올바르지 않습니다.' };
    }
    // 좌표는 x, y 가 짝을 이룬 평평한 배열이다 (객체 배열보다 절반 이하로 작다).
    if (s.p.length < 2 || s.p.length % 2 !== 0) {
      return { ok: false, error: '그림 데이터가 올바르지 않습니다.' };
    }

    const color = clampInt(s.c, 0, PALETTE.length - 1);
    const size  = clampInt(s.s, 0, SIZES.length - 1);
    if (color === null || size === null) {
      return { ok: false, error: '그림 데이터가 올바르지 않습니다.' };
    }

    const points = [];
    for (let i = 0; i < s.p.length; i += 2) {
      const x = clampInt(s.p[i],     0, CANVAS_W);
      const y = clampInt(s.p[i + 1], 0, CANVAS_H);
      if (x === null || y === null) {
        return { ok: false, error: '그림 데이터가 올바르지 않습니다.' };
      }
      points.push(x, y);
    }

    totalPoints += points.length / 2;
    if (totalPoints > CATCHMIND_MAX_POINTS) {
      return { ok: false, error: '그림이 너무 큽니다. 조금 단순하게 그려주세요.' };
    }

    strokes.push({ c: color, s: size, e: s.e ? 1 : 0, p: points });
  }

  const json = JSON.stringify(strokes);
  if (Buffer.byteLength(json, 'utf8') > CATCHMIND_MAX_JSON_BYTES) {
    return { ok: false, error: '그림이 너무 큽니다. 조금 단순하게 그려주세요.' };
  }

  return { ok: true, strokes, json };
}

/** 저장된 JSON 을 다시 배열로 (깨진 줄이 있어도 게임이 멈추지 않게 빈 배열로 떨어뜨린다) */
export function parseStrokes(json) {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
