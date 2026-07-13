import { io }               from '/socket.io/socket.io.esm.min.js';
import { escHtml, showError } from './utils.js';
import { $, screens, showScreen, initScreenManager } from './shared/screenManager.js';
import { initChat, setChatVisible, showJoinNotice } from './shared/chatManager.js';
import { checkAuth }       from './shared/authCheck.js';
import { renderRoomList as renderRoomListBase, renderSpectatorList, renderWaiting as renderWaitingBase } from './shared/lobbyRenderer.js';
import { startReturnCountdown, clearReturnCountdown, showAloneOverlay } from './shared/uiHelpers.js';

{
// ══════════════════════════════════════════════════════════════════════════════
//  TETRIS ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const COLS = 10, ROWS = 20;

function calcCellSize() {
  const maxByH = Math.floor((window.innerHeight * 0.72) / ROWS);
  const maxByW = Math.floor((window.innerWidth  * 0.46) / COLS);
  return Math.max(18, Math.min(28, maxByH, maxByW));
}

let CELL = calcCellSize();

const PIECES = {
  I: { color: '#00cfcf', rotations: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ]},
  O: { color: '#cfcf00', rotations: [[[1,1],[1,1]]] },
  T: { color: '#9b00cf', rotations: [
    [[0,1,0],[1,1,1],[0,0,0]], [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]], [[0,1,0],[1,1,0],[0,1,0]],
  ]},
  S: { color: '#00cf00', rotations: [
    [[0,1,1],[1,1,0],[0,0,0]], [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]], [[1,0,0],[1,1,0],[0,1,0]],
  ]},
  Z: { color: '#cf0000', rotations: [
    [[1,1,0],[0,1,1],[0,0,0]], [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]], [[0,1,0],[1,1,0],[1,0,0]],
  ]},
  J: { color: '#0059cf', rotations: [
    [[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]], [[0,1,0],[0,1,0],[1,1,0]],
  ]},
  L: { color: '#cf7200', rotations: [
    [[0,0,1],[1,1,1],[0,0,0]], [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]], [[1,1,0],[0,1,0],[0,1,0]],
  ]},
};

const PIECE_TYPES = Object.keys(PIECES);

let board    = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
let current  = null;
let holdPiece = null;
let holdUsed  = false;
let pieceBag = [];
let score    = 0;
let lines    = 0;
let level    = 1;
let isAlive     = false;
let gameActive  = false;
let gameStarted = false;
let isSpectator = false;
let dropTimer  = null;
let combo      = 0;
let comboHideTimer = null;

const playerAvatarEmojis = new Map();
const AVATAR_ICONS = ['🟦', '🟧', '🟥', '🟩'];

function resetBoard() { board = Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
function newBag() {
  const b = [...PIECE_TYPES];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
function ensurePieceBag() { while (pieceBag.length < 7) pieceBag.push(...newBag()); }
function nextPiece() { ensurePieceBag(); const type = pieceBag.shift(); ensurePieceBag(); return { type, rotation: 0, color: PIECES[type].color }; }
function getMatrix(piece) { return PIECES[piece.type].rotations[piece.rotation % PIECES[piece.type].rotations.length]; }
function getCells(piece) {
  const matrix = getMatrix(piece);
  const cells  = [];
  matrix.forEach((row, r) => row.forEach((v, c) => { if (v) cells.push({ r: piece.y + r, c: piece.x + c }); }));
  return cells;
}

function isValid(piece, dx = 0, dy = 0, rot = null) {
  const testPiece = { ...piece, x: piece.x + dx, y: piece.y + dy };
  if (rot !== null) testPiece.rotation = rot;
  const matrix = getMatrix(testPiece);
  return matrix.every((row, r) => row.every((v, c) => {
    if (!v) return true;
    const nr = testPiece.y + r, nc = testPiece.x + c;
    if (nr < 0) return true;
    if (nr >= ROWS || nc < 0 || nc >= COLS) return false;
    return !board[nr][nc];
  }));
}

const KICK_OFFSETS = [0, -1, 1, -2, 2];
function tryRotate(dir) {
  if (!current) return;
  const numRots = PIECES[current.type].rotations.length;
  const newRot  = ((current.rotation + dir) % numRots + numRots) % numRots;
  for (const dx of KICK_OFFSETS) {
    if (isValid(current, dx, 0, newRot)) { current.rotation = newRot; current.x += dx; render(); return; }
  }
}

function spawnPiece() {
  const { type, rotation, color } = nextPiece();
  const matrix = PIECES[type].rotations[rotation];
  current = { type, rotation, color, x: Math.floor((COLS - matrix[0].length) / 2), y: 0 };
  if (!isValid(current)) { triggerGameOver(); return false; }
  holdUsed = false;
  return true;
}

function lockPiece() {
  if (!current) return;
  getCells(current).forEach(({ r, c }) => { if (r >= 0 && r < ROWS) board[r][c] = current.color; });
  current = null;
  const completeRows = findCompleteRows();
  const cleared = clearLines();
  if (cleared > 0) {
    combo++;
    spawnLineClearParticles(completeRows);
    const scoreMap = [0, 100, 300, 500, 800];
    score += (scoreMap[cleared] ?? 800) * level;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    if (gameActive && isAlive) socket.emit('line_clear', { count: cleared, combo });
    updateStats();
    if (combo >= 2) showComboEffect(combo);
    if (cleared >= 4)      { startFlash(255, 220, 50, 1.0, 0.06);  shakeBoard('heavy'); }
    else if (cleared >= 3) { startFlash(180, 255, 120, 0.85, 0.06); shakeBoard('normal'); }
    else if (cleared >= 2) { startFlash(255, 255, 150, 0.65, 0.07); }
    else                   { startFlash(255, 255, 200, 0.4, 0.08); }
  } else {
    if (combo >= 2) hideComboDisplay();
    combo = 0;
  }
  spawnPiece();
  render();
  syncBoard();
}

function findCompleteRows() { const rows = []; for (let r = 0; r < ROWS; r++) { if (board[r].every(c => c !== null)) rows.push(r); } return rows; }
function clearLines() {
  let count = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(c => c !== null)) { board.splice(r, 1); board.unshift(Array(COLS).fill(null)); count++; r++; }
  }
  return count;
}

function addGarbageLines(count) {
  const hole = Math.floor(Math.random() * COLS);
  for (let i = 0; i < count; i++) { board.shift(); const row = Array(COLS).fill('#555555'); row[hole] = null; board.push(row); }
}

function ghostY() { if (!current) return current?.y ?? 0; let dy = 0; while (isValid(current, 0, dy + 1)) dy++; return current.y + dy; }
function hardDrop() { if (!current || !isAlive) return; while (isValid(current, 0, 1)) current.y++; lockPiece(); resetDropTimer(); }
function softDrop() { if (!current || !isAlive) return; if (isValid(current, 0, 1)) { current.y++; score += 1; render(); } else { lockPiece(); } resetDropTimer(); }
function moveLeft()  { if (current && isAlive && isValid(current, -1)) { current.x--; render(); } }
function moveRight() { if (current && isAlive && isValid(current, +1)) { current.x++; render(); } }

function holdCurrentPiece() {
  if (!current || holdUsed || !isAlive) return;
  if (!holdPiece) { holdPiece = { type: current.type, color: current.color }; spawnPiece(); }
  else {
    const saved = holdPiece;
    holdPiece = { type: current.type, color: current.color };
    current = { type: saved.type, rotation: 0, color: saved.color, x: Math.floor((COLS - PIECES[saved.type].rotations[0][0].length) / 2), y: 0 };
  }
  holdUsed = true;
  render();
}

function dropInterval() { return Math.max(80, 800 - (level - 1) * 60); }
function resetDropTimer() {
  clearTimeout(dropTimer);
  if (!gameActive || !isAlive) return;
  dropTimer = setTimeout(() => {
    if (!current || !isAlive) return;
    if (isValid(current, 0, 1)) { current.y++; render(); resetDropTimer(); }
    else { lockPiece(); resetDropTimer(); }
  }, dropInterval());
}

function triggerGameOver() {
  isAlive = false; gameActive = false;
  clearTimeout(dropTimer);
  socket.emit('game_over');
  mainBoardWrap.classList.add('dead');
  deadOverlay.classList.add('show');
  renderBoard(); syncBoard();
}

function updateStats() { $('stat-lines').textContent = lines; $('stat-score').textContent = score; $('stat-level').textContent = level; }

let syncInterval = null;
function startSyncInterval() { clearInterval(syncInterval); syncInterval = setInterval(syncBoard, 500); }
function stopSyncInterval()  { clearInterval(syncInterval); syncInterval = null; }
function syncBoard() {
  if (!gameActive && !isAlive) return;
  const snapshot = board.map(row => [...row]);
  if (current) { getCells(current).forEach(({ r, c }) => { if (r >= 0 && r < ROWS && c >= 0 && c < COLS) snapshot[r][c] = current.color; }); }
  socket.emit('board_update', { board: snapshot });
}

// ══════════════════════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════════════════════

const canvasBoard = $('canvas-board');
const canvasHold  = $('canvas-hold');
const canvasNext  = $('canvas-next');
const ctxBoard    = canvasBoard.getContext('2d');
const ctxHold     = canvasHold.getContext('2d');
const ctxNext     = canvasNext.getContext('2d');
const mainBoardWrap = $('main-board-wrap');
const deadOverlay   = $('dead-overlay');

function setupCanvases() {
  CELL = calcCellSize();
  const miniC = Math.floor(CELL / 2);
  canvasBoard.width = COLS * CELL; canvasBoard.height = ROWS * CELL;
  canvasHold.width = 4 * CELL; canvasHold.height = 4 * CELL;
  canvasNext.width = 4 * CELL; canvasNext.height = 3 * 4 * CELL;
  document.querySelectorAll('.opp-canvas').forEach(c => { c.width = COLS * miniC; c.height = ROWS * miniC; });
}

function drawCell(ctx, x, y, color, cellSize = CELL, alpha = 1) {
  if (!color) { ctx.fillStyle = '#0d2b1a'; ctx.fillRect(x * cellSize + 0.5, y * cellSize + 0.5, cellSize - 1, cellSize - 1); return; }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color; ctx.fillRect(x * cellSize + 0.5, y * cellSize + 0.5, cellSize - 1, cellSize - 1);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 3); ctx.fillRect(x * cellSize + 1, y * cellSize + 1, 3, cellSize - 2);
  ctx.globalAlpha = 1;
}

const flash     = { r: 0, g: 0, b: 0, alpha: 0, decay: 0.07 };
const particles = [];
let animRaf = null;

function startAnimLoop() {
  if (animRaf) return;
  function loop() {
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.alpha = Math.max(0, p.alpha - 0.045); if (p.alpha === 0) particles.splice(i, 1); }
    if (flash.alpha > 0) flash.alpha = Math.max(0, flash.alpha - flash.decay);
    renderBoard();
    if (particles.length > 0 || flash.alpha > 0) { animRaf = requestAnimationFrame(loop); } else { animRaf = null; }
  }
  animRaf = requestAnimationFrame(loop);
}

function startFlash(r, g, b, alpha, decay) { flash.r = r; flash.g = g; flash.b = b; flash.alpha = alpha; flash.decay = decay; startAnimLoop(); }

function spawnLineClearParticles(completeRows) {
  completeRows.forEach(r => {
    for (let c = 0; c < COLS; c++) {
      const color = board[r][c]; if (!color) continue;
      const cx = (c + 0.5) * CELL, cy = (r + 0.5) * CELL;
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2, speed = 1.8 + Math.random() * 4.5;
        particles.push({ x: cx + (Math.random() - 0.5) * CELL * 0.5, y: cy + (Math.random() - 0.5) * CELL * 0.5, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.8, color, alpha: 1, size: CELL * (0.18 + Math.random() * 0.24) });
      }
    }
  });
  startAnimLoop();
}

function shakeBoard(intensity = 'normal') {
  mainBoardWrap.classList.remove('board-shake-heavy', 'board-shake'); void mainBoardWrap.offsetWidth;
  mainBoardWrap.classList.add(intensity === 'heavy' ? 'board-shake-heavy' : 'board-shake');
  setTimeout(() => mainBoardWrap.classList.remove('board-shake-heavy', 'board-shake'), 400);
}

const comboEl = document.getElementById('combo-display');
function showComboEffect(n) {
  clearTimeout(comboHideTimer);
  const tier = n >= 8 ? 'max' : n >= 5 ? 'high' : 'mid';
  comboEl.textContent = `${n} COMBO!`; comboEl.className = `combo-tier-${tier}`; void comboEl.offsetWidth; comboEl.classList.add('combo-pop');
  comboHideTimer = setTimeout(() => hideComboDisplay(), 8000);
}
function hideComboDisplay() { clearTimeout(comboHideTimer); comboEl.classList.add('combo-fade-out'); comboHideTimer = setTimeout(() => { comboEl.className = ''; }, 400); }

function renderBoard() {
  ctxBoard.clearRect(0, 0, canvasBoard.width, canvasBoard.height);
  ctxBoard.fillStyle = '#0a1f13'; ctxBoard.fillRect(0, 0, canvasBoard.width, canvasBoard.height);
  ctxBoard.strokeStyle = '#0f2e1d'; ctxBoard.lineWidth = 0.5;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) ctxBoard.strokeRect(c * CELL, r * CELL, CELL, CELL);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c]) drawCell(ctxBoard, c, r, board[r][c]);

  if (current && isAlive) {
    const gy = ghostY();
    if (gy !== current.y) {
      getMatrix(current).forEach((row, dr) => row.forEach((v, dc) => {
        if (v) { const nr = gy + dr, nc = current.x + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
            const x = nc * CELL, y = nr * CELL;
            ctxBoard.fillStyle = current.color + '38'; ctxBoard.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
            ctxBoard.strokeStyle = current.color + 'CC'; ctxBoard.lineWidth = 2; ctxBoard.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
            ctxBoard.fillStyle = 'rgba(255,255,255,0.25)'; ctxBoard.fillRect(x + 2, y + 2, CELL - 4, 3);
          }
        }
      }));
    }
  }

  if (current) {
    getMatrix(current).forEach((row, dr) => row.forEach((v, dc) => {
      if (v) { const nr = current.y + dr, nc = current.x + dc; if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) drawCell(ctxBoard, nc, nr, current.color); }
    }));
  }

  if (flash.alpha > 0) { ctxBoard.fillStyle = `rgba(${flash.r},${flash.g},${flash.b},${flash.alpha.toFixed(3)})`; ctxBoard.fillRect(0, 0, canvasBoard.width, canvasBoard.height); }
  if (particles.length > 0) { particles.forEach(p => { ctxBoard.globalAlpha = p.alpha; ctxBoard.fillStyle = p.color; const hs = p.size / 2; ctxBoard.fillRect(p.x - hs, p.y - hs, p.size, p.size); }); ctxBoard.globalAlpha = 1; }
}

function renderHold() {
  ctxHold.clearRect(0, 0, canvasHold.width, canvasHold.height); ctxHold.fillStyle = '#0a1f13'; ctxHold.fillRect(0, 0, canvasHold.width, canvasHold.height);
  if (!holdPiece) return;
  drawPiecePreview(ctxHold, holdPiece.type, holdPiece.color, canvasHold.width, canvasHold.height, holdUsed ? 0.4 : 1);
}

function renderNext() {
  ctxNext.clearRect(0, 0, canvasNext.width, canvasNext.height); ctxNext.fillStyle = '#0a1f13'; ctxNext.fillRect(0, 0, canvasNext.width, canvasNext.height);
  ensurePieceBag();
  pieceBag.slice(0, 3).forEach((type, i) => { drawPiecePreviewAt(ctxNext, type, PIECES[type].color, 0, i * canvasNext.height / 3, canvasNext.width, canvasNext.height / 3, 1); });
}

function drawPiecePreview(ctx, type, color, w, h, alpha = 1) { drawPiecePreviewAt(ctx, type, color, 0, 0, w, h, alpha); }
function drawPiecePreviewAt(ctx, type, color, offsetX, offsetY, w, h, alpha) {
  const matrix = PIECES[type].rotations[0]; const rows = matrix.length; const cols = matrix[0].length;
  const cs = Math.min(Math.floor(w / (cols + 1)), Math.floor(h / (rows + 1)));
  const startX = offsetX + Math.floor((w - cols * cs) / 2), startY = offsetY + Math.floor((h - rows * cs) / 2);
  ctx.globalAlpha = alpha;
  matrix.forEach((row, r) => row.forEach((v, c) => { if (!v) return; ctx.fillStyle = color; ctx.fillRect(startX + c * cs + 0.5, startY + r * cs + 0.5, cs - 1, cs - 1); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(startX + c * cs + 1, startY + r * cs + 1, cs - 2, 3); }));
  ctx.globalAlpha = 1;
}

function render() { renderBoard(); renderHold(); renderNext(); }

function renderOpponentBoard(canvas, boardData) {
  const miniC = Math.floor(CELL / 2); const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#0a1f13'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!boardData) return;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const color = boardData[r]?.[c]; if (color) { ctx.fillStyle = color; ctx.fillRect(c * miniC + 0.5, r * miniC + 0.5, miniC - 1, miniC - 1); } }
}

// ══════════════════════════════════════════════════════════════════════════════
//  UI & SOCKET
// ══════════════════════════════════════════════════════════════════════════════

const inputName      = $('player-name');
const btnCreate      = $('btn-create');
const roomListEl     = $('room-list');
const playerListEl   = $('player-list');
const btnReady       = $('btn-ready');
const btnStart       = $('btn-start');
const btnLeaveLobby  = $('btn-leave-lobby');
const waitingHint    = $('waiting-hint');
const opponentArea   = $('opponent-area');
const resultOverlay  = $('result-overlay');
const resultEmoji    = $('result-emoji');
const resultTitle    = $('result-title');
const resultSub      = $('result-sub');

let myId        = null;
let myName      = '';
let roomState   = null;
let amHost      = false;

const opponentCanvases = new Map();
const socket = io('/tetris');

initScreenManager(setChatVisible);
initChat(socket, () => myId, playerAvatarEmojis);

socket.on('connect', () => { myId = socket.id; socket.emit('get_rooms'); });

checkAuth(inputName).then(data => { if (data) myName = data.username; });

// ── Render helpers ───────────────────────────────────────────────────────────

function renderRoomList(roomList) {
  renderRoomListBase(roomListEl, roomList, socket, myName, escHtml);
}

function renderWaiting(state) {
  amHost = renderWaitingBase(state, {
    myId, socket, playerListEl, btnReady, btnStart, waitingHint,
    avatarIcons: AVATAR_ICONS, playerAvatarEmojis, nameHtml: escHtml, minPlayers: 2,
  });
}

function startLocalGame(state) {
  resetBoard(); score = lines = 0; level = 1; combo = 0;
  holdPiece = null; holdUsed = false; pieceBag = [...newBag(), ...newBag()];
  isAlive = true; gameActive = true;
  clearTimeout(dropTimer); clearTimeout(comboHideTimer);
  if (comboEl) comboEl.className = '';
  mainBoardWrap.classList.remove('dead'); deadOverlay.classList.remove('show');
  resultOverlay.classList.remove('show');
  updateStats(); setupCanvases();
  opponentArea.innerHTML = ''; opponentCanvases.clear();
  state.players.filter(p => p.id !== myId).forEach(p => createOpponentBoard(p));
  spawnPiece(); render(); resetDropTimer(); startSyncInterval();
}

function createOpponentBoard(player) {
  const miniC = Math.floor(CELL / 2);
  const wrap = document.createElement('div'); wrap.className = 'opponent-board'; wrap.dataset.pid = player.id;
  const canvas = document.createElement('canvas'); canvas.className = 'opp-canvas'; canvas.width = COLS * miniC; canvas.height = ROWS * miniC;
  const nameEl = document.createElement('div'); nameEl.className = 'opp-name'; nameEl.textContent = player.name;
  const statusEl = document.createElement('div'); statusEl.className = 'opp-status'; statusEl.textContent = '탈락';
  wrap.appendChild(nameEl); wrap.appendChild(canvas); wrap.appendChild(statusEl);
  opponentArea.appendChild(wrap);
  opponentCanvases.set(player.id, { canvas, wrap, statusEl });
}

function showResultOverlay({ winnerId, winnerName }) {
  if (isSpectator) {
    resultEmoji.textContent = '🏆'; resultTitle.textContent = winnerName ? `${winnerName} 우승!` : '무승부';
    resultTitle.className = 'result-title win'; resultSub.textContent = '관전 종료. 잠시 후 로비로 돌아갑니다.';
  } else {
    const iWon = winnerId === myId;
    resultEmoji.textContent = iWon ? '🏆' : winnerId ? '😵' : '🤝';
    resultTitle.textContent = iWon ? '승리!' : winnerId ? '패배...' : '무승부';
    resultTitle.className = 'result-title ' + (iWon ? 'win' : 'lose');
    resultSub.textContent = iWon ? '축하합니다! 마지막까지 살아남았습니다!' : winnerName ? `${winnerName}님이 승리했습니다!` : '모두 탈락했습니다!';
  }
  startReturnCountdown(6, () => {
    if (resultOverlay.classList.contains('show')) {
      resultOverlay.classList.remove('show');
      stopSyncInterval(); clearTimeout(dropTimer);
      gameActive = false; gameStarted = false; isAlive = false;
      showScreen('waiting');
      if (roomState) renderWaiting({ ...roomState, state: 'lobby', players: roomState.players.map(p => ({ ...p, ready: false, alive: true })) });
    }
  });
  resultOverlay.classList.add('show');
}

// ── Socket events ────────────────────────────────────────────────────────────
socket.on('tetris_rooms_update', renderRoomList);

socket.on('room_update', (state) => {
  roomState = state;
  if (state.state === 'lobby') {
    if (isSpectator) {
      isSpectator = false; screens['game'].classList.remove('spectating');
      clearReturnCountdown(); resultOverlay.classList.remove('show');
      showScreen('lobby');
    } else {
      stopSyncInterval(); clearTimeout(dropTimer);
      gameActive = false; gameStarted = false; isAlive = false;
      clearReturnCountdown(); resultOverlay.classList.remove('show');
      showScreen('waiting'); renderWaiting(state);
    }
  } else if (state.state === 'playing') {
    renderSpectatorList(state.spectators ?? []);
    if (!isSpectator && !gameStarted) { gameStarted = true; showScreen('game'); startLocalGame(state); }
  } else if (state.state === 'gameOver') {
    stopSyncInterval(); clearTimeout(dropTimer); gameActive = false;
    showScreen('game');
    state.players.filter(p => p.id !== myId).forEach(p => {
      const entry = opponentCanvases.get(p.id);
      if (entry) { entry.wrap.classList.toggle('is-dead', !p.alive); entry.statusEl.classList.toggle('show', !p.alive); if (p.board) renderOpponentBoard(entry.canvas, p.board); }
    });
    renderSpectatorList(state.spectators ?? []);
  }
});

socket.on('spectate_start', (state) => {
  isSpectator = true; roomState = state;
  screens['game'].classList.add('spectating'); showScreen('game');
  opponentArea.innerHTML = ''; opponentCanvases.clear();
  state.players.forEach(p => {
    createOpponentBoard(p);
    if (!p.alive) { const entry = opponentCanvases.get(p.id); if (entry) { entry.wrap.classList.add('is-dead'); entry.statusEl.classList.add('show'); } }
    if (p.board) { const entry = opponentCanvases.get(p.id); if (entry) renderOpponentBoard(entry.canvas, p.board); }
  });
  renderSpectatorList(state.spectators ?? []);
});

socket.on('member_joined', ({ name, isSpectator: asSpec }) => showJoinNotice(name, asSpec));

socket.on('garbage_lines', ({ count }) => {
  if (!isAlive) return;
  addGarbageLines(count);
  if (current) { let attempts = 0; while (!isValid(current) && attempts < ROWS) { current.y--; attempts++; } if (!isValid(current)) { triggerGameOver(); return; } }
  render(); syncBoard();
  startFlash(220, 30, 30, 0.55, 0.045); shakeBoard('normal');
});

socket.on('player_board_update', ({ playerId, board: oppBoard }) => {
  const entry = opponentCanvases.get(playerId); if (entry && oppBoard) renderOpponentBoard(entry.canvas, oppBoard);
});

socket.on('player_eliminated', ({ playerId }) => {
  const entry = opponentCanvases.get(playerId); if (entry) { entry.wrap.classList.add('is-dead'); entry.statusEl.classList.add('show'); }
});

socket.on('game_result', (result) => showResultOverlay(result));
socket.on('error_msg', ({ message }) => showError(message));

socket.on('kicked', ({ message }) => {
  showError(message); socket.disconnect(); socket.connect();
  roomState = null; gameActive = false; isAlive = false; stopSyncInterval(); clearTimeout(dropTimer); showScreen('lobby');
});

socket.on('alone_in_room', ({ message }) => {
  if (isSpectator) { isSpectator = false; screens['game'].classList.remove('spectating'); showScreen('lobby'); return; }
  showAloneOverlay(message, () => { stopSyncInterval(); clearTimeout(dropTimer); gameActive = false; isAlive = false; });
});

// ── Keyboard ─────────────────────────────────────────────────────────────────
const DAS = 160, ARR = 60;
const keyTimers = new Map();

function keyAction(code) {
  if (!gameActive || !isAlive) return;
  switch (code) {
    case 'ArrowLeft': moveLeft(); break; case 'ArrowRight': moveRight(); break;
    case 'ArrowDown': softDrop(); break; case 'ArrowUp': case 'KeyX': tryRotate(1); break;
    case 'KeyZ': tryRotate(-1); break; case 'Space': hardDrop(); break;
    case 'ControlLeft': holdCurrentPiece(); break;
  }
}

const REPEAT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown']);

window.addEventListener('keydown', e => {
  if (document.activeElement === $('chat-input')) return;
  if (e.code === 'Space') e.preventDefault();
  if (keyTimers.has(e.code)) return;
  keyAction(e.code);
  if (REPEAT_KEYS.has(e.code)) {
    const das = setTimeout(() => { const arr = setInterval(() => keyAction(e.code), ARR); const entry = keyTimers.get(e.code); if (entry) entry.arr = arr; }, DAS);
    keyTimers.set(e.code, { das, arr: null });
  } else { keyTimers.set(e.code, { das: null, arr: null }); }
});

window.addEventListener('keyup', e => { const entry = keyTimers.get(e.code); if (!entry) return; clearTimeout(entry.das); clearInterval(entry.arr); keyTimers.delete(e.code); });

// ── Mobile controls ──────────────────────────────────────────────────────────
function setupTouchBtn(id, action) {
  const btn = $(id); if (!btn) return;
  let interval = null;
  const start = () => { action(); interval = setInterval(action, 100); };
  const stop = () => { clearInterval(interval); interval = null; };
  btn.addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });
  btn.addEventListener('touchend', stop, { passive: false });
  btn.addEventListener('mousedown', start); btn.addEventListener('mouseup', stop); btn.addEventListener('mouseleave', stop);
}

setupTouchBtn('btn-left', moveLeft); setupTouchBtn('btn-right', moveRight); setupTouchBtn('btn-soft-drop', softDrop);
$('btn-rotate')?.addEventListener('click', () => tryRotate(1));
$('btn-hard-drop')?.addEventListener('click', hardDrop);
$('btn-hold')?.addEventListener('click', holdCurrentPiece);

// ── UI buttons ───────────────────────────────────────────────────────────────
btnCreate.addEventListener('click', () => {
  const name = inputName.value.trim();
  if (!name) { showError('닉네임을 입력해주세요.'); inputName.focus(); return; }
  myName = name; socket.emit('create_room', { playerName: name });
});

btnReady.addEventListener('click', () => socket.emit('toggle_ready'));
btnStart.addEventListener('click', () => socket.emit('start_game'));

const btnToggleSpectator = $('btn-toggle-spectator');
if (btnToggleSpectator) btnToggleSpectator.addEventListener('click', () => socket.emit('toggle_spectator_allowed'));

btnLeaveLobby.addEventListener('click', () => {
  isSpectator = false; screens['game'].classList.remove('spectating');
  socket.disconnect(); socket.connect(); showScreen('lobby');
  roomState = null; gameActive = false; isAlive = false; stopSyncInterval(); clearTimeout(dropTimer);
});

// ── Init ─────────────────────────────────────────────────────────────────────
pieceBag = [...newBag(), ...newBag()];
setupCanvases(); renderBoard(); renderHold(); renderNext();

window.addEventListener('resize', () => {
  const oldCell = CELL; CELL = calcCellSize();
  if (CELL !== oldCell) { setupCanvases(); render(); }
});

}
