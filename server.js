import 'dotenv/config';
import express        from 'express';
import { createServer } from 'http';
import { Server }    from 'socket.io';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync }  from 'fs';
import session        from 'express-session';

import { PORT, SOCKET_PING_INTERVAL, SOCKET_PING_TIMEOUT, SOCKET_RECONNECT_GRACE_MS } from './src/config.js';
import { SqliteSessionStore } from './src/db/sessionStore.js';
import authRouter          from './src/routes/auth.js';
import soloRouter          from './src/routes/solo.js';
import { registerHandlers } from './src/game/crocodile/socket.js';
import { registerBombHandlers }   from './src/game/bomb/socket.js';
import { registerTetrisHandlers } from './src/game/tetris/socket.js';
import { registerJamoHandlers }   from './src/game/jamo/socket.js';
import { registerWordchainHandlers } from './src/game/wordchain/socket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app    = express();
const server = createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  // 모바일 절전·앱 전환으로 잠깐 응답이 끊긴 정도로는 연결을 버리지 않는다.
  pingInterval: SOCKET_PING_INTERVAL,
  pingTimeout:  SOCKET_PING_TIMEOUT,
  // 그래도 끊겼다면 재접속 시 소켓 id·방·놓친 패킷까지 그대로 복구한다.
  connectionStateRecovery: {
    maxDisconnectionDuration: SOCKET_RECONNECT_GRACE_MS,
    skipMiddlewares:          false, // 세션 미들웨어는 다시 태워야 한다
  },
});

// ── Pug 뷰 엔진 설정 ─────────────────────────────────────────────────────────
app.set('view engine', 'pug');
app.set('views', join(__dirname, 'views'));

// nginx(리버스 프록시) 뒤에서 실제 클라이언트 IP 를 읽는다 (로그인 시도 제한 기준).
app.set('trust proxy', 1);

const sessionMiddleware = session({
  secret:            process.env.SESSION_SECRET,
  store:             new SqliteSessionStore(), // SQLite 저장 → 재시작해도 로그인 유지
  resave:            false,
  saveUninitialized: false,
  rolling:           true,                     // 접속할 때마다 만료 연장
  cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
});

// 아바타(base64)까지 세션에 담기므로 기본 100kb 로는 부족하다.
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

app.use('/api', authRouter);
app.use('/api/solo', soloRouter);
app.use(express.static(join(__dirname, 'client')));

// ── SVG 사전 로드 ──────────────────────────────────────────────────────────────
const crocodileSvg = readFileSync(join(__dirname, 'client/partials/crocodile-svg.html'), 'utf-8');

// ── 게임 페이지 라우팅 (Pug) ──────────────────────────────────────────────────
app.get('/crocodile', (_req, res) => {
  res.render('pages/crocodile', { title: '악어 이빨 뽑기', cssFile: 'crocodile', jsFile: 'crocodile', hasFlash: true, crocodileSvg });
});

app.get('/bomb', (_req, res) => {
  res.render('pages/bomb', { title: '폭탄 돌리기', cssFile: 'bomb', jsFile: 'bomb', hasFlash: true });
});

app.get('/tetris', (_req, res) => {
  res.render('pages/tetris', { title: '테트리스 배틀', cssFile: 'tetris', jsFile: 'tetris', hasFlash: false });
});

app.get('/jamo', (_req, res) => {
  res.render('pages/jamo', { title: '자모 워들', cssFile: 'jamo', jsFile: 'jamo', hasFlash: false });
});

app.get('/wordchain', (_req, res) => {
  res.render('pages/wordchain', { title: '끝말잇기', cssFile: 'wordchain', jsFile: 'wordchain', hasFlash: true });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const logConnect = (label) => (socket) =>
  console.log(`[reconnect-debug][${label}] connect socket=${socket.id} cid=${socket.handshake?.auth?.cid} recovered=${socket.recovered} t=${new Date().toISOString()}`);

io.on('connection', (socket) => {
  logConnect('/')(socket);
  registerHandlers(io, socket);
});

const bombIo = io.of('/bomb');
bombIo.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
bombIo.on('connection', (socket) => {
  logConnect('/bomb')(socket);
  registerBombHandlers(bombIo, socket);
});

const tetrisIo = io.of('/tetris');
tetrisIo.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
tetrisIo.on('connection', (socket) => {
  logConnect('/tetris')(socket);
  registerTetrisHandlers(tetrisIo, socket);
});

const jamoIo = io.of('/jamo');
jamoIo.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
jamoIo.on('connection', (socket) => {
  logConnect('/jamo')(socket);
  registerJamoHandlers(jamoIo, socket);
});

const wordchainIo = io.of('/wordchain');
wordchainIo.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
wordchainIo.on('connection', (socket) => {
  logConnect('/wordchain')(socket);
  registerWordchainHandlers(wordchainIo, socket);
});

server.listen(PORT, () => console.log(`파티 게임즈 → http://localhost:${PORT}`));
