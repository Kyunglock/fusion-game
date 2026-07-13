// 한글 자모 분해 및 판정 로직
// (korean-jamo-word-game-v5-double-consonant-host-test 이식)

const CHO  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['', 'ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

const VOWEL_SPLIT = {
  'ㅐ':['ㅏ','ㅣ'], 'ㅒ':['ㅑ','ㅣ'], 'ㅔ':['ㅓ','ㅣ'], 'ㅖ':['ㅕ','ㅣ'],
  'ㅘ':['ㅗ','ㅏ'], 'ㅙ':['ㅗ','ㅏ','ㅣ'], 'ㅚ':['ㅗ','ㅣ'],
  'ㅝ':['ㅜ','ㅓ'], 'ㅞ':['ㅜ','ㅓ','ㅣ'], 'ㅟ':['ㅜ','ㅣ'], 'ㅢ':['ㅡ','ㅣ'],
};

const DOUBLE_CONSONANT_SPLIT = { 'ㄲ':['ㄱ','ㄱ'], 'ㄸ':['ㄷ','ㄷ'], 'ㅃ':['ㅂ','ㅂ'], 'ㅆ':['ㅅ','ㅅ'], 'ㅉ':['ㅈ','ㅈ'] };

const JONG_SPLIT = {
  'ㄲ':['ㄱ','ㄱ'], 'ㅆ':['ㅅ','ㅅ'], 'ㄳ':['ㄱ','ㅅ'], 'ㄵ':['ㄴ','ㅈ'], 'ㄶ':['ㄴ','ㅎ'],
  'ㄺ':['ㄹ','ㄱ'], 'ㄻ':['ㄹ','ㅁ'], 'ㄼ':['ㄹ','ㅂ'], 'ㄽ':['ㄹ','ㅅ'], 'ㄾ':['ㄹ','ㅌ'],
  'ㄿ':['ㄹ','ㅍ'], 'ㅀ':['ㄹ','ㅎ'], 'ㅄ':['ㅂ','ㅅ'],
};

export const KEYBOARD_ROWS = [
  ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'],
  ['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ'],
];

function splitConsonant(jamo) { return DOUBLE_CONSONANT_SPLIT[jamo] || [jamo]; }

// 단어 → 자모 배열 (초성 쌍자음/받침 쌍자음까지 낱개로 분해)
export function decompose(word) {
  const result = [];
  for (const ch of word.trim()) {
    const code = ch.charCodeAt(0);
    if (code < 0xAC00 || code > 0xD7A3) {
      result.push(ch);
      continue;
    }
    const idx  = code - 0xAC00;
    const cho  = Math.floor(idx / 588);
    const jung = Math.floor((idx % 588) / 28);
    const jong = idx % 28;

    result.push(...splitConsonant(CHO[cho]));
    result.push(...(VOWEL_SPLIT[JUNG[jung]] || [JUNG[jung]]));
    if (JONG[jong]) result.push(...(JONG_SPLIT[JONG[jong]] || [JONG[jong]]));
  }
  return result;
}

// Wordle 스타일 자모 단위 채점 (green/yellow/black)
export function judge(answerJamo, guessJamo) {
  const result = Array(guessJamo.length).fill('black');
  const remain = {};

  for (let i = 0; i < guessJamo.length; i++) {
    if (guessJamo[i] === answerJamo[i]) result[i] = 'green';
    else if (answerJamo[i]) remain[answerJamo[i]] = (remain[answerJamo[i]] || 0) + 1;
  }

  for (let i = 0; i < guessJamo.length; i++) {
    if (result[i] === 'green') continue;
    if (remain[guessJamo[i]] > 0) {
      result[i] = 'yellow';
      remain[guessJamo[i]]--;
    }
  }
  return result;
}

// 시도 이력으로부터 개인 키보드 상태(자모별 최고 등급 색) 계산
export function keyboardFromAttempts(attempts) {
  const rank = { black: 1, yellow: 2, green: 3 };
  const keys = {};
  for (const attempt of attempts) {
    attempt.jamo.forEach((j, idx) => {
      const color = attempt.result[idx];
      if (!keys[j] || rank[color] > rank[keys[j]]) keys[j] = color;
    });
  }
  return keys;
}
