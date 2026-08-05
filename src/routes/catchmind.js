import { Router } from 'express';

import {
  CATCHMIND_MAX_ATTEMPTS,
  CATCHMIND_HINT_VOTES,
  CATCHMIND_REPORTS_TO_HIDE,
} from '../config.js';
import { chosungOf, isCorrect, sanitizeStrokes, parseStrokes } from '../game/catchmind/drawingLogic.js';
import { pickWord, categoryOf, isKnownWord } from '../game/catchmind/words.js';
import * as store from '../db/catchmind.js';

/**
 * 캐치마인드 API.
 *
 * 다른 게임과 달리 소켓이 없다. 그림을 그려 DB에 쌓아두면 다른 사람이 아무 때나
 * 들어와 그 그림을 맞히는 비동기 게임이라, 방·턴 대신 평범한 HTTP 로 충분하다.
 */
const router = Router();

function requireLogin(req, res, next) {
  if (!req.session.accountId) return res.status(401).json({ error: 'not_logged_in' });
  next();
}

router.use(requireLogin);

/** 그림 하나를 클라이언트가 쓸 모양으로 (정답은 절대 넣지 않는다) */
function quizPayload(drawing, play, { replay, remaining }) {
  const attempts = play?.attempts ?? 0;
  return {
    id:       drawing.id,
    strokes:  parseStrokes(drawing.strokes),
    length:   [...drawing.word].length,
    category: categoryOf(drawing.word),
    hint: {
      votes:    drawing.hint_votes,
      needed:   CATCHMIND_HINT_VOTES,
      revealed: !!drawing.hint_revealed,
      // 공개된 그림에만 초성을 실어 보낸다. 안 그러면 개발자 도구로 다 보인다.
      chosung:  drawing.hint_revealed ? chosungOf(drawing.word) : null,
    },
    author:      { name: drawing.author, avatar: drawing.author_avatar ?? null },
    createdAt:   drawing.created_at,
    attempts,
    remainingAttempts: Math.max(0, CATCHMIND_MAX_ATTEMPTS - attempts),
    maxAttempts: CATCHMIND_MAX_ATTEMPTS,
    // 복습(이미 푼 그림)은 전적에 반영하지 않는다는 것을 화면에서 알려주기 위함
    replay,
    remaining,
  };
}

// ── 그리기 ────────────────────────────────────────────────────────────────────

/**
 * GET /api/catchmind/word — 그릴 제시어 배정
 * 배정한 제시어는 세션에 넣어두고, 그림을 저장할 때 그 값을 쓴다
 * (클라이언트가 보낸 제시어를 그대로 믿으면 아무 단어나 정답으로 만들 수 있다).
 */
router.get('/word', (req, res) => {
  const exclude = new Set();
  // 새로고침한 경우 방금 나온 제시어는 피해준다.
  if (req.query.refresh && req.session.catchmindWord) exclude.add(req.session.catchmindWord);

  const word = pickWord(store.drawingCounts(), exclude);
  req.session.catchmindWord = word;

  res.json({ word, category: categoryOf(word) });
});

/** POST /api/catchmind/drawings — 그림 저장. 제시어는 세션에 배정된 것을 쓴다. */
router.post('/drawings', (req, res) => {
  const word = req.session.catchmindWord;
  if (!word || !isKnownWord(word)) {
    return res.status(409).json({ error: '제시어가 만료되었습니다. 새로 받아주세요.' });
  }

  const clean = sanitizeStrokes(req.body?.strokes);
  if (!clean.ok) return res.status(400).json({ error: clean.error });

  const id = store.saveDrawing({
    accountId:   req.session.accountId,
    word,
    strokesJson: clean.json,
  });

  // 한 제시어로 두 번 저장되지 않도록 배정을 비운다.
  req.session.catchmindWord = null;
  res.json({ id, word });
});

// ── 홈 요약 ───────────────────────────────────────────────────────────────────

/**
 * GET /api/catchmind/summary — 홈 화면 안내문용 숫자만.
 * 홈에서 /quiz 를 부르면 그림이 '열람됨'으로 찍혀 버리므로 조회 전용으로 따로 둔다.
 */
router.get('/summary', (req, res) => {
  const accountId = req.session.accountId;
  res.json({
    remaining: store.remainingCount(accountId),
    ...store.mySummary(accountId),
  });
});

// ── 맞히기 ────────────────────────────────────────────────────────────────────

/** GET /api/catchmind/quiz — 맞힐 그림 한 장 */
router.get('/quiz', (req, res) => {
  const accountId = req.session.accountId;
  const picked    = store.pickQuiz(accountId);

  if (!picked) {
    return res.json({ empty: true, remaining: 0 });
  }

  const { drawing, replay } = picked;
  const play = store.openQuiz(drawing.id, accountId, { replay });
  res.json(quizPayload(drawing, play, { replay, remaining: store.remainingCount(accountId) }));
});

/** 그림 + 그 사람의 풀이 상태를 함께 집는다 (없거나 숨겨졌으면 404) */
function loadQuiz(req, res) {
  const drawing = store.getDrawing(Number(req.params.id));
  if (!drawing || drawing.hidden) {
    res.status(404).json({ error: '그림을 찾을 수 없습니다.' });
    return null;
  }
  if (drawing.user_id === req.session.accountId) {
    res.status(403).json({ error: '자기가 그린 그림은 맞힐 수 없습니다.' });
    return null;
  }

  const play   = store.getPlay(drawing.id, req.session.accountId);
  const replay = play?.finished === 1;
  return { drawing, play, replay };
}

/** POST /api/catchmind/quiz/:id/guess — 정답 시도 */
router.post('/quiz/:id/guess', (req, res) => {
  const ctx = loadQuiz(req, res);
  if (!ctx) return;

  const { drawing, replay } = ctx;
  const guess = String(req.body?.guess ?? '').trim();
  if (!guess) return res.status(400).json({ error: '정답을 입력해주세요.' });
  if (guess.length > 30) return res.status(400).json({ error: '너무 긴 답입니다.' });

  // 시도 기록이 없는 채로 바로 제출한 경우(화면을 거치지 않은 요청)도 자리를 만들어 준다.
  if (!ctx.play) store.openQuiz(drawing.id, req.session.accountId, { replay: false });

  const correct = isCorrect(guess, drawing.word);
  const result  = store.submitGuess(drawing, req.session.accountId, correct, { replay });

  res.json({
    ...result,
    // 끝난 뒤에만 정답을 알려준다.
    answer: result.finished ? drawing.word : null,
  });
});

/** POST /api/catchmind/quiz/:id/giveup — 포기하고 정답 보기 (패로 기록) */
router.post('/quiz/:id/giveup', (req, res) => {
  const ctx = loadQuiz(req, res);
  if (!ctx) return;

  const { drawing, replay } = ctx;
  if (!ctx.play) store.openQuiz(drawing.id, req.session.accountId, { replay: false });

  const { recorded } = store.giveUp(drawing, req.session.accountId, { replay });
  res.json({ answer: drawing.word, recorded });
});

/**
 * POST /api/catchmind/quiz/:id/hint — 초성 힌트에 동의
 * 서로 다른 사람 CATCHMIND_HINT_VOTES 명이 동의하면 그 그림의 초성이 영구 공개된다.
 * 혼자서는 못 열고, 어려운 그림일수록 표가 빨리 모여 자연스럽게 풀린다.
 */
router.post('/quiz/:id/hint', (req, res) => {
  const ctx = loadQuiz(req, res);
  if (!ctx) return;

  const { drawing } = ctx;
  const vote = store.voteHint(drawing.id, req.session.accountId);
  res.json({ ...vote, chosung: vote.revealed ? chosungOf(drawing.word) : null });
});

/** POST /api/catchmind/quiz/:id/report — 신고 (쌓이면 출제에서 자동 제외) */
router.post('/quiz/:id/report', (req, res) => {
  const ctx = loadQuiz(req, res);
  if (!ctx) return;

  res.json(store.reportDrawing(ctx.drawing.id, req.session.accountId));
});

// ── 내 그림 ───────────────────────────────────────────────────────────────────

/** GET /api/catchmind/mine — 내가 그린 그림 + 얼마나 맞혀졌는지 */
router.get('/mine', (req, res) => {
  const accountId = req.session.accountId;
  const drawings  = store.myDrawings(accountId, 40).map(d => ({
    id:       d.id,
    word:     d.word,
    strokes:  parseStrokes(d.strokes),
    seen:     d.seen_count,
    solved:   d.solved_count,
    reports:  d.reports,
    hidden:   !!d.hidden,
    hintRevealed: !!d.hint_revealed,
    createdAt: d.created_at,
  }));

  res.json({
    drawings,
    summary:        store.mySummary(accountId),
    reportsToHide:  CATCHMIND_REPORTS_TO_HIDE,
  });
});

/** DELETE /api/catchmind/drawings/:id — 내 그림 내리기 */
router.delete('/drawings/:id', (req, res) => {
  const ok = store.hideMyDrawing(Number(req.params.id), req.session.accountId);
  if (!ok) return res.status(404).json({ error: '그림을 찾을 수 없습니다.' });
  res.json({ hidden: true });
});

export default router;
