import 'dotenv/config';
import express        from 'express';
import { createServer } from 'http';
import { Server }    from 'socket.io';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync }  from 'fs';
import session        from 'express-session';

import { PORT }            from './src/config.js';
import authRouter          from './src/routes/auth.js';
import { registerHandlers } from './src/game/crocodile/socket.js';
import { registerBombHandlers }   from './src/game/bomb/socket.js';
import { registerTetrisHandlers } from './src/game/tetris/socket.js';
import { registerJamoHandlers }   from './src/game/jamo/socket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app    = express();
const server = createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// ── Pug 뷰 엔진 설정 ─────────────────────────────────────────────────────────
app.set('view engine', 'pug');
app.set('views', join(__dirname, 'views'));

const sessionMiddleware = session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000 },
});

app.use(express.json());
app.use(sessionMiddleware);

io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

app.use('/api', authRouter);
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
  res.render('pages/jamo', { title: '자모 맞추기', cssFile: 'jamo', jsFile: 'jamo', hasFlash: false });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);
  registerHandlers(io, socket);
});

const bombIo = io.of('/bomb');
bombIo.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
bombIo.on('connection', (socket) => {
  console.log(`[bomb connect] ${socket.id}`);
  registerBombHandlers(bombIo, socket);
});

const tetrisIo = io.of('/tetris');
tetrisIo.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
tetrisIo.on('connection', (socket) => {
  console.log(`[tetris connect] ${socket.id}`);
  registerTetrisHandlers(tetrisIo, socket);
});

const jamoIo = io.of('/jamo');
jamoIo.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
jamoIo.on('connection', (socket) => {
  console.log(`[jamo connect] ${socket.id}`);
  registerJamoHandlers(jamoIo, socket);
});

server.listen(PORT, () => console.log(`파티 게임즈 → http://localhost:${PORT}`));
