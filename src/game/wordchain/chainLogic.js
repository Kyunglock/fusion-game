// 끝말잇기 순수 로직 — 한글 음절 분해, 두음법칙, 단어 검증

const HANGUL_BASE = 0xac00;

// 초성 인덱스 (표준 순서): ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ
const CHO_N  = 2;   // ㄴ
const CHO_R  = 5;   // ㄹ
const CHO_NG = 11;  // ㅇ

// 두음법칙에서 ㄹ/ㄴ이 ㅇ으로 바뀌는 중성 (ㅑ ㅒ ㅕ ㅖ ㅛ ㅠ ㅣ)
const JUNG_IOTIZED = new Set([2, 3, 6, 7, 12, 17, 20]);

export function isHangulWord(word) {
  return /^[가-힣]+$/.test(word);
}

function decomposeSyllable(ch) {
  const code = ch.charCodeAt(0) - HANGUL_BASE;
  return {
    cho:  Math.floor(code / 588),
    jung: Math.floor((code % 588) / 28),
    jong: code % 28,
  };
}

function composeSyllable(cho, jung, jong) {
  return String.fromCharCode(HANGUL_BASE + cho * 588 + jung * 28 + jong);
}

/**
 * 이전 단어의 끝 글자로 시작할 수 있는 글자 목록 (두음법칙 포함).
 * 예: '력' → ['력', '역'], '로' → ['로', '노'], '녀' → ['녀', '여'], '무' → ['무']
 */
export function allowedStarts(lastChar) {
  const set = new Set([lastChar]);
  const { cho, jung, jong } = decomposeSyllable(lastChar);

  if (cho === CHO_R) {
    // ㄹ + ㅑㅕㅛㅠㅣㅖ… → ㅇ (례→예), 그 외 → ㄴ (락→낙)
    set.add(composeSyllable(JUNG_IOTIZED.has(jung) ? CHO_NG : CHO_N, jung, jong));
  } else if (cho === CHO_N && JUNG_IOTIZED.has(jung)) {
    // ㄴ + ㅑㅕㅛㅠㅣㅖ… → ㅇ (녀→여)
    set.add(composeSyllable(CHO_NG, jung, jong));
  }
  return [...set];
}

/**
 * 다음 단어 검증. 통과하면 null, 실패하면 사용자에게 보여줄 에러 메시지를 반환.
 * (사전 검증은 하지 않는다 — 실제 단어인지는 참가자들이 채팅으로 감시하는 컨셉)
 */
export function validateWord(word, prevWord, usedWords, maxLen = 15) {
  if (!word || !isHangulWord(word)) return '완성된 한글 단어만 낼 수 있습니다.';
  if (word.length < 2)              return '두 글자 이상의 단어만 낼 수 있습니다.';
  if (word.length > maxLen)         return `단어는 최대 ${maxLen}글자입니다.`;
  if (prevWord) {
    const starts = allowedStarts(prevWord[prevWord.length - 1]);
    if (!starts.includes(word[0])) {
      return `'${starts.join("' 또는 '")}'(으)로 시작하는 단어를 내야 합니다.`;
    }
  }
  if (usedWords.has(word))          return '이미 나온 단어입니다.';
  return null;
}
