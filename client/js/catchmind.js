import { escHtml, showError } from './utils.js';
import { tierLabel } from './shared/myRank.js';

/**
 * 캐치마인드 — 방 없이 굴러가는 비동기 그림 게임.
 *
 * 다른 게임과 달리 소켓을 쓰지 않는다. 제시어를 받아 그린 그림을 서버에 올려두면,
 * 다른 사람이 아무 때나 들어와 그 그림을 맞힌다. 그래서 이 파일은 전부 평범한
 * fetch 호출이고, 무거운 쪽은 그리기/재생을 맡는 캔버스 엔진이다.
 */

// 서버(src/game/catchmind/drawingLogic.js)와 같은 값이어야 한다.
const CANVAS_W = 1000;
const CANVAS_H = 750;
const PALETTE = [
  '#1f2328', '#e63946', '#f4a261', '#f5c842',
  '#2a9d5c', '#2b6cb0', '#7c5cff', '#c2185b',
];
const SIZES = [4, 10, 22];
/** 종이는 테마와 무관하게 항상 흰색이다 — 그린 사람과 맞히는 사람이 같은 그림을 봐야 한다. */
const PAPER = '#ffffff';

const $ = id => document.getElementById(id);

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
const SCREENS = ['home', 'draw', 'quiz', 'board', 'mine'];

function showScreen(name) {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle('active', s === name);
}

// ── HTTP 헬퍼 ─────────────────────────────────────────────────────────────────
async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body:    body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/'; throw new Error('로그인이 필요합니다.'); }
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

// ══════════════════════════════════════════════════════════════════════════════
// 캔버스 엔진
//
// 그림은 이미지가 아니라 **획 좌표 배열**로 들고 있는다. 그래야 되돌리기가 공짜고,
// 화면 크기가 바뀌어도 다시 그리면 되고, 무엇보다 맞히기 화면에서 그린 순서대로
// 재생할 수 있다 (그려지는 걸 보는 게 캐치마인드의 절반이다).
//
// 좌표계는 항상 1000×750 논리 좌표. 실제 픽셀 크기와의 환산은 여기서만 한다.
// ══════════════════════════════════════════════════════════════════════════════
function createCanvas(el, { interactive = false, onChange = () => {} } = {}) {
  const ctx = el.getContext('2d');
  let strokes = [];
  let current = null;
  /** 재생 중이면 '몇 번째 점까지 그릴지', 아니면 null(전부 그리기) */
  let replayLimit = null;
  let replayTimer = null;

  const tool = { color: 0, size: 1, eraser: false };

  // ── 크기 맞추기 ─────────────────────────────────────────────────────────────
  function resize() {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width  = Math.round(rect.width * dpr);
    el.height = Math.round(rect.width * dpr * CANVAS_H / CANVAS_W);
    render();
  }

  // ── 그리기 ──────────────────────────────────────────────────────────────────
  function strokeStyleOf(s) {
    return s.e ? PAPER : (PALETTE[s.c] ?? PALETTE[0]);
  }

  /** 획 하나를 그린다. limit 을 주면 그 개수만큼의 점까지만 (재생용). */
  function paintStroke(s, limit = Infinity) {
    const n = Math.min(s.p.length / 2, limit);
    if (n <= 0) return;

    ctx.strokeStyle = strokeStyleOf(s);
    ctx.lineWidth   = SIZES[s.s] ?? SIZES[1];
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (n === 1) {
      // 점 하나만 찍은 획도 보이게 (탭 한 번으로 점을 찍는 경우)
      ctx.beginPath();
      ctx.arc(s.p[0], s.p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeStyleOf(s);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(s.p[0], s.p[1]);
    // 중점을 지나는 2차 곡선으로 이어 손떨림을 부드럽게 편다.
    for (let i = 1; i < n - 1; i++) {
      const x = s.p[i * 2], y = s.p[i * 2 + 1];
      const nx = s.p[(i + 1) * 2], ny = s.p[(i + 1) * 2 + 1];
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    ctx.lineTo(s.p[(n - 1) * 2], s.p[(n - 1) * 2 + 1]);
    ctx.stroke();
  }

  function render() {
    const scale = el.width / CANVAS_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    let budget = replayLimit ?? Infinity;
    const list = current ? [...strokes, current] : strokes;

    for (const s of list) {
      if (budget <= 0) break;
      paintStroke(s, budget);
      budget -= s.p.length / 2;
    }
  }

  // ── 포인터 입력 ─────────────────────────────────────────────────────────────
  function toLogical(e) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / rect.width  * CANVAS_W),
      y: Math.round((e.clientY - rect.top)  / rect.height * CANVAS_H),
    };
  }

  function onDown(e) {
    if (!interactive) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const { x, y } = toLogical(e);
    current = { c: tool.color, s: tool.size, e: tool.eraser ? 1 : 0, p: [x, y] };
    render();
  }

  function onMove(e) {
    if (!current) return;
    e.preventDefault();
    const { x, y } = toLogical(e);
    const len  = current.p.length;
    const lastX = current.p[len - 2], lastY = current.p[len - 1];
    // 1px 단위로 다 담으면 데이터가 금방 불어난다. 어느 정도 움직였을 때만 점을 찍는다.
    if (Math.abs(x - lastX) + Math.abs(y - lastY) < 4) return;
    current.p.push(x, y);
    render();
  }

  function onUp() {
    if (!current) return;
    strokes.push(current);
    current = null;
    render();
    onChange(strokes.length);
  }

  if (interactive) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);
    // 캔버스 위에서는 스크롤/확대가 아니라 그리기가 되어야 한다.
    el.style.touchAction = 'none';
  }

  new ResizeObserver(resize).observe(el);

  return {
    get strokes() { return strokes; },
    get isEmpty() { return strokes.length === 0; },
    tool,

    setStrokes(next) {
      this.stopReplay();
      strokes = Array.isArray(next) ? next : [];
      current = null;
      render();
    },
    clear() {
      this.stopReplay();
      strokes = [];
      current = null;
      render();
      onChange(0);
    },
    undo() {
      strokes.pop();
      render();
      onChange(strokes.length);
    },
    resize,
    render,

    /** 그린 순서대로 다시 그려 보여준다 (총 길이와 무관하게 대략 2.5초 안에 끝난다). */
    replay(duration = 2500) {
      this.stopReplay();
      const total = strokes.reduce((n, s) => n + s.p.length / 2, 0);
      if (total === 0) { render(); return; }

      const started = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - started) / duration);
        replayLimit = Math.ceil(total * t);
        render();
        if (t < 1) {
          replayTimer = requestAnimationFrame(step);
        } else {
          replayLimit = null;
          replayTimer = null;
        }
      };
      replayTimer = requestAnimationFrame(step);
    },
    stopReplay() {
      if (replayTimer) cancelAnimationFrame(replayTimer);
      replayTimer = null;
      replayLimit = null;
    },
  };
}

/** 목록용 작은 그림 (상호작용 없음, 한 번만 그리면 된다) */
function renderThumb(canvas, strokes) {
  const view = createCanvas(canvas);
  view.setStrokes(strokes);
  return view;
}

// ══════════════════════════════════════════════════════════════════════════════
// 그리기 화면
// ══════════════════════════════════════════════════════════════════════════════
const drawCanvas = createCanvas($('draw-canvas'), {
  interactive: true,
  onChange: (count) => {
    $('draw-save').disabled = count === 0;
    $('draw-hint').hidden   = count > 0;
  },
});

let assignedWord = null;

function renderTools() {
  const palette = $('draw-palette');
  palette.innerHTML = PALETTE.map((c, i) =>
    `<button class="cm-swatch" data-color="${i}" style="--swatch:${c}" aria-label="색 ${i + 1}"></button>`
  ).join('');

  $('draw-sizes').innerHTML = SIZES.map((px, i) =>
    `<button class="cm-size" data-size="${i}"><span style="width:${px}px;height:${px}px"></span></button>`
  ).join('');

  syncToolUI();
}

function syncToolUI() {
  for (const b of $('draw-palette').children) {
    b.classList.toggle('active', !drawCanvas.tool.eraser && Number(b.dataset.color) === drawCanvas.tool.color);
  }
  for (const b of $('draw-sizes').children) {
    b.classList.toggle('active', Number(b.dataset.size) === drawCanvas.tool.size);
  }
  $('tool-eraser').classList.toggle('active', drawCanvas.tool.eraser);
}

$('draw-palette').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-color]');
  if (!btn) return;
  drawCanvas.tool.color  = Number(btn.dataset.color);
  drawCanvas.tool.eraser = false;
  syncToolUI();
});

$('draw-sizes').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-size]');
  if (!btn) return;
  drawCanvas.tool.size = Number(btn.dataset.size);
  syncToolUI();
});

$('tool-eraser').addEventListener('click', () => {
  drawCanvas.tool.eraser = !drawCanvas.tool.eraser;
  syncToolUI();
});
$('tool-undo').addEventListener('click', () => drawCanvas.undo());
$('tool-clear').addEventListener('click', () => {
  if (drawCanvas.isEmpty || confirm('그린 것을 모두 지울까요?')) drawCanvas.clear();
});

async function loadWord(refresh = false) {
  try {
    const data = await api(`/api/catchmind/word${refresh ? '?refresh=1' : ''}`);
    assignedWord = data.word;
    $('draw-word').textContent     = data.word;
    $('draw-category').textContent = data.category ? `${data.category.emoji} ${data.category.label}` : '';
  } catch (e) {
    showError(e.message);
  }
}

async function openDraw() {
  drawCanvas.clear();
  $('draw-note').textContent = '올린 그림은 다른 사람에게 문제로 나갑니다';
  showScreen('draw');
  drawCanvas.resize();
  await loadWord();
}

$('draw-reroll').addEventListener('click', () => {
  if (!drawCanvas.isEmpty && !confirm('제시어를 바꾸면 그리던 그림이 지워집니다. 계속할까요?')) return;
  drawCanvas.clear();
  loadWord(true);
});

$('draw-save').addEventListener('click', async () => {
  if (drawCanvas.isEmpty) return;
  const btn = $('draw-save');
  btn.disabled = true;
  btn.textContent = '올리는 중…';

  try {
    await api('/api/catchmind/drawings', { method: 'POST', body: { strokes: drawCanvas.strokes } });
    $('draw-note').textContent = `✅ '${assignedWord}' 그림을 올렸습니다! 다음 제시어를 받았어요`;
    drawCanvas.clear();
    await loadWord();
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
  } finally {
    btn.textContent = '이 그림 올리기';
  }
});

$('draw-exit').addEventListener('click', () => goHome());

// ══════════════════════════════════════════════════════════════════════════════
// 맞히기 화면
// ══════════════════════════════════════════════════════════════════════════════
const quizCanvas = createCanvas($('quiz-canvas'));

/** 지금 화면에 떠 있는 문제 */
let quiz = null;
/** 이번 문제가 이미 끝났는지 (맞혔거나 시도를 다 썼거나 포기) */
let quizDone = false;

/**
 * 글자 수 칸. 처음에는 빈 칸만 보여주고, 정해진 횟수만큼 틀리면 서버가 초성을
 * 내려주므로 그때부터 칸 안에 초성이 들어찬다.
 */
function renderSlots() {
  const chosung = quiz.chosung ? [...quiz.chosung] : null;
  $('quiz-slots').innerHTML = Array.from({ length: quiz.length }, (_, i) =>
    `<span class="cm-slot${chosung ? ' has-hint' : ''}">${chosung ? escHtml(chosung[i] ?? '') : ''}</span>`
  ).join('');
}

/** 추천 · 비추천 버튼 (내가 던진 표는 눌린 상태로 보인다) */
function renderVotes() {
  const { likes, dislikes, mine } = quiz.votes;
  const like = $('quiz-like');
  const dis  = $('quiz-dislike');

  like.querySelector('.cm-vote-n').textContent = likes;
  dis .querySelector('.cm-vote-n').textContent = dislikes;
  like.classList.toggle('active', mine === 1);
  dis .classList.toggle('active', mine === -1);
}

function renderQuizMeta() {
  const meta = [`시도 ${quiz.attempts}/${quiz.maxAttempts}`];
  if (quiz.chosung) {
    meta.push('초성 공개됨');
  } else if (quiz.hintAfter > quiz.attempts) {
    meta.push(`${quiz.hintAfter - quiz.attempts}번 더 틀리면 초성 공개`);
  }
  $('quiz-attempts').textContent  = meta.join(' · ');
  $('quiz-remaining').textContent = quiz.replay
    ? '복습 중 (전적에 반영되지 않아요)'
    : `안 푼 그림 ${quiz.remaining}장`;
}

function setQuizBanner(text, kind) {
  const el = $('quiz-banner');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  el.className = `cm-banner ${kind ?? ''}`;
}

function setQuizFinished(answer, { won }) {
  quizDone = true;
  $('quiz-input').disabled  = true;
  $('quiz-submit').disabled = true;
  $('quiz-giveup').hidden   = true;
  $('quiz-next').hidden     = false;

  $('quiz-slots').innerHTML = [...answer].map(ch =>
    `<span class="cm-slot revealed">${escHtml(ch)}</span>`
  ).join('');

  if (!won) setQuizBanner(`정답은 '${answer}' 였습니다`, 'lose');
}

async function loadQuiz() {
  setQuizBanner(null);
  $('quiz-empty').hidden    = true;
  $('quiz-input').disabled  = false;
  $('quiz-submit').disabled = false;
  $('quiz-giveup').hidden   = false;
  $('quiz-next').hidden     = true;
  $('quiz-input').value     = '';
  quizDone = false;

  let data;
  try {
    data = await api('/api/catchmind/quiz');
  } catch (e) {
    showError(e.message);
    return;
  }

  if (data.empty) {
    quiz = null;
    $('quiz-empty').hidden = false;
    $('quiz-answer-box').hidden = true;
    quizCanvas.setStrokes([]);
    return;
  }

  quiz = data;
  $('quiz-answer-box').hidden = false;

  const av = data.author.avatar
    ? `<img src="${escHtml(data.author.avatar)}" alt="" />`
    : '<span class="cm-author-emoji">🎨</span>';
  $('quiz-author').innerHTML =
    `${av}<span class="cm-author-name">${escHtml(data.author.name)}</span>님의 그림`;

  renderSlots();
  renderVotes();
  renderQuizMeta();

  quizCanvas.setStrokes(data.strokes);
  quizCanvas.resize();
  quizCanvas.replay();

  if (!('ontouchstart' in window)) $('quiz-input').focus();
}

async function openQuiz() {
  showScreen('quiz');
  await loadQuiz();
}

$('quiz-submit').addEventListener('click', async () => {
  if (!quiz || quizDone) return;
  const guess = $('quiz-input').value.trim();
  if (!guess) return;

  try {
    const r = await api(`/api/catchmind/quiz/${quiz.id}/guess`, { method: 'POST', body: { guess } });
    quiz.attempts = r.attempts;
    renderQuizMeta();
    $('quiz-input').value = '';

    if (r.correct) {
      setQuizBanner(
        r.recorded ? `정답! 🎉 +${r.score}점` : '정답! 🎉 (복습이라 전적에는 반영되지 않아요)',
        'win',
      );
      setQuizFinished(r.answer, { won: true });
    } else if (r.finished) {
      setQuizFinished(r.answer, { won: false });
    } else {
      // 이번 시도로 초성 공개 조건을 채웠으면 서버가 초성을 함께 보내준다.
      const justRevealed = !quiz.chosung && r.chosung;
      if (r.chosung) { quiz.chosung = r.chosung; renderSlots(); renderQuizMeta(); }

      setQuizBanner(
        justRevealed
          ? `땡! 초성을 공개할게요 → ${r.chosung} (마지막 ${r.remainingAttempts}번)`
          : `땡! ${r.remainingAttempts}번 더 시도할 수 있어요`,
        justRevealed ? 'info' : 'miss',
      );
    }
  } catch (e) {
    showError(e.message);
  }
});

$('quiz-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('quiz-submit').click();
});

$('quiz-votes').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-value]');
  if (!btn || !quiz) return;

  // 이미 같은 표를 던졌다면 취소(0)로 보낸다.
  const value = quiz.votes.mine === Number(btn.dataset.value) ? 0 : Number(btn.dataset.value);
  try {
    quiz.votes = await api(`/api/catchmind/quiz/${quiz.id}/vote`, { method: 'POST', body: { value } });
    renderVotes();
  } catch (err) {
    showError(err.message);
  }
});

$('quiz-giveup').addEventListener('click', async () => {
  if (!quiz || quizDone) return;
  if (!confirm('포기하면 이 그림은 패로 기록됩니다. 정답을 볼까요?')) return;
  try {
    const r = await api(`/api/catchmind/quiz/${quiz.id}/giveup`, { method: 'POST' });
    setQuizFinished(r.answer, { won: false });
  } catch (e) {
    showError(e.message);
  }
});

$('quiz-report').addEventListener('click', async () => {
  if (!quiz) return;
  if (!confirm('제시어와 무관하거나 부적절한 그림인가요? 신고가 쌓이면 출제에서 제외됩니다.')) return;
  try {
    const r = await api(`/api/catchmind/quiz/${quiz.id}/report`, { method: 'POST' });
    setQuizBanner(
      r.hidden ? '신고가 접수되어 이 그림은 출제에서 제외됩니다.' : `신고했습니다 (${r.reports}/${r.needed})`,
      'info',
    );
    if (r.hidden) loadQuiz();
  } catch (e) {
    showError(e.message);
  }
});

$('quiz-replay').addEventListener('click', () => quizCanvas.replay());
$('quiz-next').addEventListener('click', () => loadQuiz());
$('quiz-empty-draw').addEventListener('click', () => openDraw());
$('quiz-exit').addEventListener('click', () => goHome());

// ══════════════════════════════════════════════════════════════════════════════
// 그림 랭킹
//
// 그림과 통계(추천·오답 수)는 모두에게 보이지만 **제시어는 내가 맞힌 것만** 보인다.
// 서버가 아직 못 푼 그림의 word 를 아예 내려주지 않으므로 여기서는 있는 그대로 그린다.
// ══════════════════════════════════════════════════════════════════════════════
let boardSort = 'likes';

/** 카드 오른쪽에 크게 띄울 숫자 — 지금 정렬 기준이 되는 값 */
const BOARD_STAT = {
  likes:    d => `👍 ${d.likes}`,
  dislikes: d => `👎 ${d.dislikes}`,
  misses:   d => `😵 ${d.misses}`,
};

/** 정답 자리 — 맞힌 그림은 제시어를, 아직 못 푼 그림은 글자 수만 */
function boardWordHtml(d) {
  if (d.word) {
    return `<span class="cm-card-word">${escHtml(d.word)}</span>`;
  }
  const blanks = '○'.repeat(d.length);
  return `<span class="cm-card-word is-masked" title="맞히면 공개됩니다">${blanks}</span>`;
}

async function loadBoard() {
  $('board-grid').innerHTML = '<p class="cm-loading">불러오는 중…</p>';

  let data;
  try {
    data = await api(`/api/catchmind/board?sort=${boardSort}`);
  } catch (e) {
    showError(e.message);
    return;
  }

  for (const b of $('board-tabs').children) {
    b.classList.toggle('active', b.dataset.sort === boardSort);
  }

  $('board-empty').hidden = data.items.length > 0;
  $('board-grid').innerHTML = data.items.map((d, i) => `
    <div class="cm-card cm-board-card">
      <span class="cm-rank${i < 3 ? ' top' : ''}">${i + 1}</span>
      <canvas class="cm-thumb" data-board-thumb="${d.id}"></canvas>
      <div class="cm-card-body">
        ${boardWordHtml(d)}
        <span class="cm-card-stat">${(BOARD_STAT[boardSort] ?? BOARD_STAT.likes)(d)}</span>
      </div>
      <div class="cm-board-meta">
        <span class="cm-board-author">${escHtml(d.author.name)}</span>
        <span>👍 ${d.likes} · 👎 ${d.dislikes} · 😵 ${d.misses} · ✅ ${d.solved}</span>
      </div>
      ${d.mine ? '<span class="cm-card-flag">내 그림</span>' : ''}
      ${!d.mine && d.solvedByMe ? '<span class="cm-card-flag ok">맞힘</span>' : ''}
    </div>
  `).join('');

  for (const d of data.items) {
    const c = $('board-grid').querySelector(`[data-board-thumb="${d.id}"]`);
    if (c) renderThumb(c, d.strokes);
  }
}

async function openBoard() {
  showScreen('board');
  await loadBoard();
}

$('board-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sort]');
  if (!btn || btn.dataset.sort === boardSort) return;
  boardSort = btn.dataset.sort;
  loadBoard();
});

$('board-exit').addEventListener('click', () => goHome());
$('board-quiz').addEventListener('click', () => openQuiz());
$('board-empty-draw').addEventListener('click', () => openDraw());

// ══════════════════════════════════════════════════════════════════════════════
// 내 그림
// ══════════════════════════════════════════════════════════════════════════════
async function openMine() {
  showScreen('mine');
  $('mine-grid').innerHTML = '<p class="cm-loading">불러오는 중…</p>';

  let data;
  try {
    data = await api('/api/catchmind/mine');
  } catch (e) {
    showError(e.message);
    return;
  }

  const { drawn, seen, solved, likes, dislikes } = data.summary;
  $('mine-summary').innerHTML =
    `<b>${drawn}</b>장 · 👀 <b>${seen}</b> · ✅ <b>${solved}</b> · 👍 <b>${likes}</b> · 👎 <b>${dislikes}</b>`;

  $('mine-empty').hidden = data.drawings.length > 0;
  $('mine-grid').innerHTML = data.drawings.map(d => `
    <div class="cm-card${d.hidden ? ' is-hidden' : ''}" data-id="${d.id}">
      <canvas class="cm-thumb" data-thumb="${d.id}"></canvas>
      <div class="cm-card-body">
        <span class="cm-card-word">${escHtml(d.word)}</span>
        <span class="cm-card-stat">👀 ${d.seen} · ✅ ${d.solved} · 👍 ${d.likes} · 👎 ${d.dislikes}</span>
      </div>
      ${d.hidden ? '<span class="cm-card-flag">내려감</span>' : ''}
      ${!d.hidden && d.reports > 0 ? `<span class="cm-card-flag warn">신고 ${d.reports}/${data.reportsToHide}</span>` : ''}
      ${d.hidden ? '' : `<button class="cm-card-del" data-del="${d.id}" title="내리기">✕</button>`}
    </div>
  `).join('');

  for (const d of data.drawings) {
    const c = $('mine-grid').querySelector(`[data-thumb="${d.id}"]`);
    if (c) renderThumb(c, d.strokes);
  }
}

$('mine-grid').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  if (!confirm('이 그림을 내릴까요? 더 이상 문제로 나오지 않습니다.')) return;

  try {
    await api(`/api/catchmind/drawings/${btn.dataset.del}`, { method: 'DELETE' });
    openMine();
  } catch (err) {
    showError(err.message);
  }
});

$('mine-exit').addEventListener('click', () => goHome());
$('mine-draw').addEventListener('click', () => openDraw());
$('mine-empty-draw').addEventListener('click', () => openDraw());

// ══════════════════════════════════════════════════════════════════════════════
// 홈
// ══════════════════════════════════════════════════════════════════════════════
async function goHome() {
  quizCanvas.stopReplay();
  showScreen('home');
  refreshHomeCounts();
}

async function refreshHomeCounts() {
  // 조회 전용 요약을 쓴다 — 홈에서 /quiz 를 부르면 그림이 열람 처리되어 버린다.
  try {
    const s = await api('/api/catchmind/summary');
    $('cm-quiz-desc').textContent = s.remaining > 0
      ? `아직 안 푼 그림 ${s.remaining}장이 기다리고 있어요`
      : '남은 새 그림이 없어요 — 그림을 그려 문제를 만들어보세요';
    $('cm-mine-desc').textContent = s.drawn === 0
      ? '내가 그린 그림이 얼마나 맞혀졌는지 보기'
      : `${s.drawn}장 올림 · ${s.solved}번 맞혀짐 · 추천 ${s.likes}`;
  } catch { /* 홈 안내문일 뿐이라 실패해도 그냥 둔다 */ }
}

$('btn-go-draw').addEventListener('click', () => openDraw());
$('btn-go-quiz').addEventListener('click', () => openQuiz());
$('btn-go-board').addEventListener('click', () => openBoard());
$('btn-go-mine').addEventListener('click', () => openMine());

// ── 진입: 세션 확인 ───────────────────────────────────────────────────────────
const me = await fetch('/api/me').then(r => (r.ok ? r.json() : null)).catch(() => null);
if (!me?.username) {
  window.location.href = '/';
} else {
  $('cm-nick').textContent = me.username;
  if (me.avatar) {
    $('cm-avatar').innerHTML = `<img src="${escHtml(me.avatar)}" alt="avatar" />`;
  }
  if (me.rank) {
    const badge = $('cm-tier');
    badge.textContent  = tierLabel(me.rank);
    badge.dataset.tier = me.rank.tier.key;
    badge.hidden       = false;
  }
  renderTools();
  refreshHomeCounts();
}
