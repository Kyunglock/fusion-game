import { Router } from 'express';

import {
  UserError, validateUsername,
  loginOrCreate, findById, updateUsername, updateAvatar,
} from '../db/users.js';
import { getUserStats } from '../db/stats.js';
import { getRanking, getUserRank } from '../db/ranking.js';

const router = Router();

// ── 세션 헬퍼 ────────────────────────────────────────────────────────────────
// 비밀번호 없이 닉네임이 곧 계정이다. 세션에는 DB 계정 id(userId)와 표시용
// 프로필을 캐시해 두고, 정본은 항상 DB(users) 이다.
function setSessionUser(req, user) {
  req.session.userId    = `user:${user.id}`;
  req.session.accountId = user.id;
  req.session.username  = user.username;
  req.session.avatar    = user.avatar ?? null;
}

function meBody(req) {
  const accountId = req.session.accountId ?? null;
  return {
    id:        req.session.userId,
    accountId,
    username:  req.session.username,
    avatar:    req.session.avatar ?? null,
    rank:      accountId ? getUserRank(accountId) : null,
  };
}

// 세션 고정(session fixation) 공격 방지: 접속할 때 세션 id 를 새로 발급한다.
function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });
}

function requireLogin(req, res, next) {
  if (!req.session.accountId) return res.status(401).json({ error: 'not_logged_in' });
  next();
}

// 검증/충돌 에러를 응답으로 바꾸는 래퍼
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
      console.error('[auth]', e);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  };
}

// ── 접속 (닉네임만 입력) ─────────────────────────────────────────────────────
// POST /api/auth { username }
router.post('/auth', handle(async (req, res) => {
  if (req.session.accountId) return res.json({ ...meBody(req), existing: true });

  const username = validateUsername(req.body?.username);
  const user     = loginOrCreate(username);

  await regenerate(req);
  setSessionUser(req, user);
  res.json({ ...meBody(req), existing: false });
}));

// ── 접속 종료 (다른 닉네임으로 갈아타기) ─────────────────────────────────────
router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── GET /api/me ──────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.accountId) return res.status(401).json({ error: 'not_logged_in' });

  // DB 를 정본으로 삼아 세션 캐시를 맞춘다 (다른 기기에서 바꾼 프로필 반영).
  const user = findById(req.session.accountId);
  if (!user) return req.session.destroy(() => res.status(401).json({ error: 'not_logged_in' }));

  req.session.username = user.username;
  req.session.avatar   = user.avatar ?? null;
  res.json(meBody(req));
});

// ── PUT /api/me/username ─────────────────────────────────────────────────────
router.put('/me/username', requireLogin, handle(async (req, res) => {
  const username = validateUsername(req.body?.username);
  updateUsername(req.session.accountId, username);
  req.session.username = username;
  res.json({ username });
}));

// ── PUT /api/me/avatar ───────────────────────────────────────────────────────
router.put('/me/avatar', requireLogin, handle(async (req, res) => {
  const { avatar } = req.body ?? {};
  if (!avatar || typeof avatar !== 'string') throw new UserError('이미지 데이터가 없습니다.');
  if (!avatar.startsWith('data:image/'))     throw new UserError('올바른 이미지 형식이 아닙니다.');

  // base64 부분만 추출해서 크기 확인 (~200KB 제한)
  const base64Data = avatar.split(',')[1] ?? '';
  if (base64Data.length > 280_000)           throw new UserError('이미지 크기가 너무 큽니다. (최대 200KB)');

  updateAvatar(req.session.accountId, avatar);
  req.session.avatar = avatar;
  res.json({ avatar });
}));

// ── GET /api/me/stats — 내 전적 + 등급 ───────────────────────────────────────
router.get('/me/stats', requireLogin, handle(async (req, res) => {
  res.json({
    ...getUserStats(req.session.accountId),
    rank: getUserRank(req.session.accountId),
  });
}));

// ── GET /api/ranking — 전체 등급표 (상위 100명) ──────────────────────────────
router.get('/ranking', (_req, res) => {
  res.json(getRanking().slice(0, 100));
});

export default router;
