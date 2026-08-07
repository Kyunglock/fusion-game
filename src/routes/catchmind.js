import { Router } from 'express';

import {
  CATCHMIND_MAX_ATTEMPTS,
  CATCHMIND_HINT_AFTER_ATTEMPTS,
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
function quizPayload(drawing, play, { replay, remaining, myVote }) {
  const attempts = play?.attempts ?? 0;
  return {
    id:       drawing.id,
    strokes:  parseStrokes(drawing.strokes),
    length:   [...drawing.word].length,
    category: categoryOf(drawing.word),
    // 초성은 처음엔 감춰두고, 그 사람이 CATCHMIND_HINT_AFTER_ATTEMPTS 번 틀리면
    // 그때부터 보여준다(마지막 한 번을 남겨두고 주는 구제책). 조건을 못 채웠으면
    // 아예 실어 보내지 않는다 — 보내놓고 화면에서만 가리면 개발자 도구로 다 보인다.
    chosung:   attempts >= CATCHMIND_HINT_AFTER_ATTEMPTS ? chosungOf(drawing.word) : null,
    hintAfter: CATCHMIND_HINT_AFTER_ATTEMPTS,
    votes: {
      likes:    drawing.likes,
      dislikes: drawing.dislikes,
      mine:     myVote,
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

  const word = pickWord(store.drawingCounts(req.session.serverId), exclude);
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
    // 그린 서버(채널)를 함께 박는다 — 이 그림은 그 서버에서만 출제된다.
    serverId:    req.session.serverId,
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
  const { accountId, serverId } = req.session;
  res.json({
    remaining: store.remainingCount(accountId, serverId),
    ...store.mySummary(accountId, serverId),
    ...store.playedSummary(accountId, serverId),
  });
});

// ── 맞히기 ────────────────────────────────────────────────────────────────────

/** GET /api/catchmind/quiz — 맞힐 그림 한 장 */
router.get('/quiz', (req, res) => {
  const { accountId, serverId } = req.session;
  const picked    = store.pickQuiz(accountId, serverId);

  if (!picked) {
    return res.json({ empty: true, remaining: 0 });
  }

  const { drawing, replay } = picked;
  const play = store.openQuiz(drawing.id, accountId, { replay });
  res.json(quizPayload(drawing, play, {
    replay,
    remaining: store.remainingCount(accountId, serverId),
    myVote:    store.myVote(drawing.id, accountId),
  }));
});

/** 그림 + 그 사람의 풀이 상태를 함께 집는다 (없거나 숨겨졌으면 404) */
function loadQuiz(req, res) {
  const drawing = store.getDrawing(Number(req.params.id));
  // 다른 서버(채널)의 그림은 id 를 알아도 없는 그림으로 취급한다.
  if (!drawing || drawing.hidden || drawing.server_id !== req.session.serverId) {
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
    // 이번 시도로 초성 공개 조건을 채웠으면 바로 함께 내려준다(다시 부를 필요 없이).
    chosung: !result.finished && result.attempts >= CATCHMIND_HINT_AFTER_ATTEMPTS
      ? chosungOf(drawing.word)
      : null,
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
 * POST /api/catchmind/quiz/:id/vote — 추천 · 비추천
 * body { value: 1 | -1 | 0 }. 같은 값을 다시 보내면 취소된다(토글).
 * 그림의 좋고 나쁨을 표시할 뿐이라 신고와 달리 출제 여부에는 영향을 주지 않는다.
 */
router.post('/quiz/:id/vote', (req, res) => {
  const ctx = loadQuiz(req, res);
  if (!ctx) return;

  const raw = Number(req.body?.value);
  if (![1, -1, 0].includes(raw)) {
    return res.status(400).json({ error: '알 수 없는 평가입니다.' });
  }

  res.json(store.castVote(ctx.drawing.id, req.session.accountId, raw));
});

/** POST /api/catchmind/quiz/:id/report — 신고 (쌓이면 출제에서 자동 제외) */
router.post('/quiz/:id/report', (req, res) => {
  const ctx = loadQuiz(req, res);
  if (!ctx) return;

  res.json(store.reportDrawing(ctx.drawing.id, req.session.accountId));
});

// ── 랭킹 ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/catchmind/board?sort=likes|misses — 그림 랭킹
 *
 * 그림·통계는 모두에게 보여주되 **제시어는 내가 이미 끝낸 그림(과 내가 그린
 * 그림)만** 실어 보낸다. 맞혔든 틀렸든 끝냈다면 그 자리에서 정답을 봤으니 가릴
 * 이유가 없다. 아직 손대지 않은 그림은 글자 수만 알려주고 `word: null` 로
 * 내려간다 — 목록에서 답이 새면 맞히기가 무의미해진다.
 */
router.get('/board', (req, res) => {
  const { accountId, serverId } = req.session;
  const sort = store.BOARD_SORT_KEYS.includes(req.query.sort) ? req.query.sort : 'likes';

  const items = store.leaderboard(accountId, serverId, sort).map((d) => {
    const mine    = d.author_id === accountId;
    const canSee  = mine || d.finished_by_me === 1;
    return {
      id:       d.id,
      strokes:  parseStrokes(d.strokes),
      length:   [...d.word].length,
      word:     canSee ? d.word : null,
      mine,
      solvedByMe:   d.solved_by_me === 1,
      finishedByMe: d.finished_by_me === 1,
      likes:    d.likes,
      dislikes: d.dislikes,
      misses:   d.misses,
      seen:     d.seen_count,
      solved:   d.solved_count,
      author:   { name: d.author, avatar: d.author_avatar ?? null },
      createdAt: d.created_at,
    };
  });

  res.json({ sort, items });
});

// ── 그림 평가 ─────────────────────────────────────────────────────────────────

/**
 * GET /api/catchmind/rated?filter=all|solved|missed — 평가할 그림 목록
 *
 * 대상은 **내가 이미 끝낸 그림**뿐이다(맞혔거나 틀렸거나 포기한 것). 그래서 랭킹과
 * 달리 제시어를 가릴 필요가 없다 — 어차피 그 자리에서 정답을 봤다.
 * 표를 던지는 것은 기존 `POST /quiz/:id/vote` 를 그대로 쓴다.
 */
router.get('/rated', (req, res) => {
  const { accountId, serverId } = req.session;
  const filter = store.RATE_FILTER_KEYS.includes(req.query.filter) ? req.query.filter : 'all';

  const items = store.ratedDrawings(accountId, serverId, filter).map(d => ({
    id:       d.id,
    strokes:  parseStrokes(d.strokes),
    word:     d.word,
    solvedByMe: d.solved_by_me === 1,
    myAttempts: d.my_attempts,
    maxAttempts: CATCHMIND_MAX_ATTEMPTS,
    likes:    d.likes,
    dislikes: d.dislikes,
    myVote:   d.my_vote,
    seen:     d.seen_count,
    solved:   d.solved_count,
    author:   { name: d.author, avatar: d.author_avatar ?? null },
    createdAt: d.created_at,
  }));

  res.json({ filter, items, ...store.playedSummary(accountId, serverId) });
});

// ── 내 그림 ───────────────────────────────────────────────────────────────────

/** GET /api/catchmind/mine — 내가 그린 그림 + 얼마나 맞혀졌는지 */
router.get('/mine', (req, res) => {
  const { accountId, serverId } = req.session;
  const drawings  = store.myDrawings(accountId, serverId, 40).map(d => ({
    id:       d.id,
    word:     d.word,
    strokes:  parseStrokes(d.strokes),
    seen:     d.seen_count,
    solved:   d.solved_count,
    reports:  d.reports,
    hidden:   !!d.hidden,
    likes:    d.likes,
    dislikes: d.dislikes,
    createdAt: d.created_at,
  }));

  res.json({
    drawings,
    summary:        store.mySummary(accountId, serverId),
    reportsToHide:  CATCHMIND_REPORTS_TO_HIDE,
  });
});

/** DELETE /api/catchmind/drawings/:id — 내 그림 내리기 */
router.delete('/drawings/:id', (req, res) => {
  const ok = store.hideMyDrawing(Number(req.params.id), req.session.accountId, req.session.serverId);
  if (!ok) return res.status(404).json({ error: '그림을 찾을 수 없습니다.' });
  res.json({ hidden: true });
});

export default router;
