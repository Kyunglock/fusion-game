import { Router } from 'express';

import { JAMO_SOLO_MAX_ATTEMPTS, JAMO_SOLO_DIFFICULTIES } from '../config.js';
import { recordJamoSolo, getJamoSoloDay } from '../db/soloStats.js';

// 솔로 플레이(솔플) 전적 API. 판정은 클라이언트가 하고 서버는 '난이도별 하루 한 판'
// 이라는 규칙만 지킨다 → 반복 제출로 전적을 부풀릴 수 없다.
const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS  = 86_400_000;

function requireLogin(req, res, next) {
  if (!req.session.accountId) return res.status(401).json({ error: 'not_logged_in' });
  next();
}

/**
 * '오늘의 낱말' 기준일을 정한다.
 * 낱말은 클라이언트의 로컬 날짜로 뽑히므로 그 날짜를 그대로 쓰되, 시차로 설명되는
 * 범위(±1일)를 벗어나면 서버 날짜로 되돌린다(날짜를 바꿔가며 여러 판 기록하는 것 방지).
 */
function resolveDate(raw) {
  const today = new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(raw ?? '')) return today;
  const gap = Math.abs(Date.parse(`${raw}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`));
  return Number.isFinite(gap) && gap <= DAY_MS ? raw : today;
}

// ── GET /api/solo/jamo?date=YYYY-MM-DD — 그날의 난이도별 클리어 상태 ────────────
router.get('/jamo', requireLogin, (req, res) => {
  const date = resolveDate(req.query?.date);
  res.json({ date, ...getJamoSoloDay(req.session.accountId, date) });
});

// ── POST /api/solo/jamo — 솔플 한 판 결과 기록 ─────────────────────────────────
// body { date, difficulty, solved, attempts }
router.post('/jamo', requireLogin, (req, res) => {
  const { difficulty, solved, attempts } = req.body ?? {};
  if (!JAMO_SOLO_DIFFICULTIES[difficulty]) {
    return res.status(400).json({ error: '알 수 없는 난이도입니다.' });
  }

  const date = resolveDate(req.body?.date);
  const won  = solved === true;
  // 실패는 시도를 다 쓴 것이므로 항상 최대 시도 횟수로 본다.
  const tries = won
    ? Math.min(JAMO_SOLO_MAX_ATTEMPTS, Math.max(1, Math.trunc(Number(attempts)) || 1))
    : JAMO_SOLO_MAX_ATTEMPTS;

  try {
    res.json(recordJamoSolo({
      accountId: req.session.accountId,
      date, difficulty, solved: won, attempts: tries,
    }));
  } catch (e) {
    // 전적 기록 실패가 게임을 막아서는 안 된다.
    console.error('[solo] 자모 솔플 전적 기록 실패', e);
    res.status(500).json({ error: '전적을 기록하지 못했습니다.' });
  }
});

export default router;
