// 끝말잇기 단어 사전 — 표준국어대사전 기반 공개 단어 목록(acidsound/korean_wordlist)에서
// 완성형 한글 2~15글자만 걸러 gzip으로 담아둔 것을 서버 기동 시 한 번 로드한다.
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const words = new Set();
try {
  const raw = gunzipSync(readFileSync(join(__dirname, 'words.txt.gz'))).toString('utf8');
  for (const w of raw.split('\n')) if (w) words.add(w);
  console.log(`[wordchain] 사전 로드 완료: ${words.size.toLocaleString()}개 단어`);
} catch (e) {
  // 사전 파일이 없어도 게임은 돌아가야 한다 — 사전 검증만 건너뛴다
  console.error(`[wordchain] 사전 로드 실패, 사전 검증 없이 진행: ${e.message}`);
}

export const dictionarySize = words.size;
export const hasWord = (w) => words.size === 0 || words.has(w);
