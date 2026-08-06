import { Router } from 'express';

import { publicServers, findServer, serverName, verifyServerPassword } from '../servers.js';

/**
 * 서버(채널) 입장 API.
 *
 * 닉네임 로그인보다 **앞단**에 있는 관문이다. 비밀번호를 맞혀야 세션에 serverId 가
 * 박히고, 그때부터 게임 페이지·소켓·방 목록이 열린다.
 */
const router = Router();

// ── 비밀번호 시도 제한 (IP 기준, 메모리) ─────────────────────────────────────
// 서버가 둘뿐이라 무차별 대입이 통하면 의미가 없다. 프로세스가 하나이므로
// 별도 저장소 없이 Map 으로 충분하다(재시작하면 초기화되는 정도는 감수).
const MAX_FAILS   = 10;
const WINDOW_MS   = 10 * 60 * 1000;
const attempts    = new Map(); // ip → { fails, until }

function rateKey(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function blockedFor(req) {
  const rec = attempts.get(rateKey(req));
  if (!rec) return 0;
  if (Date.now() > rec.until) { attempts.delete(rateKey(req)); return 0; }
  return rec.fails >= MAX_FAILS ? Math.ceil((rec.until - Date.now()) / 1000) : 0;
}

function noteFail(req) {
  const key = rateKey(req);
  const rec = attempts.get(key);
  if (!rec || Date.now() > rec.until) attempts.set(key, { fails: 1, until: Date.now() + WINDOW_MS });
  else rec.fails += 1;
}

// ── 미들웨어 ─────────────────────────────────────────────────────────────────
/** API 용 — 서버를 고르지 않았으면 403 */
export function requireServer(req, res, next) {
  if (!findServer(req.session?.serverId)) return res.status(403).json({ error: 'no_server' });
  next();
}

/** 페이지 용 — 서버를 고르지 않았으면 홈(서버 선택)으로 되돌린다 */
export function requireServerPage(req, res, next) {
  if (!findServer(req.session?.serverId)) return res.redirect('/');
  next();
}

// ── GET /api/servers — 서버 목록 + 지금 들어와 있는 서버 ─────────────────────
router.get('/', (req, res) => {
  const current = findServer(req.session?.serverId)?.id ?? null;
  res.json({ servers: publicServers(), current, currentName: serverName(current) });
});

// ── POST /api/servers/enter { serverId, password } ───────────────────────────
router.post('/enter', (req, res) => {
  const wait = blockedFor(req);
  if (wait) {
    return res.status(429).json({ error: `비밀번호를 너무 많이 틀렸습니다. ${wait}초 후 다시 시도해주세요.` });
  }

  const { serverId, password } = req.body ?? {};
  const server = findServer(serverId);
  if (!server) return res.status(400).json({ error: '존재하지 않는 서버입니다.' });

  if (!verifyServerPassword(server.id, password)) {
    noteFail(req);
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }

  attempts.delete(rateKey(req));
  req.session.serverId = server.id;
  res.json({ serverId: server.id, serverName: server.name });
});

// ── POST /api/servers/leave — 다른 서버로 갈아타기 ───────────────────────────
// 서버를 바꾸면 이전 서버의 방과는 완전히 무관해지므로 방 정보를 들고 있지 않는다.
router.post('/leave', (req, res) => {
  req.session.serverId = null;
  res.json({ ok: true });
});

export default router;
