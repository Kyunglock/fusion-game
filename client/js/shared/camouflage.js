// 위장 배경(보호색) — 회사에서 몰래 하는 컨셉.
// 테마에 맞춰 화면 전체를 실제 업무 앱처럼 보이게 채운다. 게임 UI 뒤에 깔리는
// 순수 장식 레이어(#pg-camo, pointer-events:none, z-index:-1)라 게임 조작에는 영향이 없다.
//  - sheet/excel → 데이터가 채워진 스프레드시트(열머리글·행번호·격자·선택 셀·시트 탭)
//  - code/vscode/eclipse → 코드 에디터(사이드바 파일트리·탭·줄번호·문법 강조 코드·상태바)
//  - doc → 워드풍 문서 페이지
// 테마 전환(themeManager가 <html data-theme> 변경) 시 MutationObserver로 자동 갱신.

const KIND = {
  sheet: 'sheet', excel: 'sheet',
  code: 'editor', vscode: 'editor', eclipse: 'editor',
  doc: 'doc',
};

const CELL_W = 64;
const CELL_H = 21;

// ── 결정적 PRNG (리빌드/리사이즈해도 데이터가 흔들리지 않도록 시드 고정) ──────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function fmt(n) { return n.toLocaleString('en-US'); }
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ══════════════════════════════════════════════════════════════════════════════
// 스프레드시트
// ══════════════════════════════════════════════════════════════════════════════
function spreadsheetHTML() {
  const W = window.innerWidth, H = window.innerHeight;
  const cols = Math.ceil(W / CELL_W) + 1;
  const rows = Math.ceil(H / CELL_H) + 1;

  const colhdr = Array.from({ length: cols }, (_, i) =>
    `<div class="xl-ch">${colName(i)}</div>`).join('');
  const rowhdr = Array.from({ length: rows }, (_, i) =>
    `<div class="xl-rh">${i + 1}</div>`).join('');

  // 가짜 업무 데이터 (분기 손익 표) — 실제 시트처럼 보이게 좌상단에 채운다.
  const rng = makeRng(20260721);
  const heads = ['구분', '1분기', '2분기', '3분기', '4분기', '합계', '비중'];
  const rowsData = ['매출액', '매출원가', '매출총이익', '판관비', '영업이익', '인건비',
    '마케팅비', '연구개발', '감가상각', '금융수익', '금융비용', '법인세', '당기순이익',
    '유동자산', '고정자산', '부채총계', '자본총계'];

  const cells = [];
  // 표 헤더 (2행부터, B열부터)
  heads.forEach((h, c) => cells.push(place(c + 1, 1, h, 'xl-th')));
  rowsData.forEach((label, r) => {
    const row = r + 2;
    cells.push(place(1, row, label, 'xl-lbl'));
    const base = 200 + Math.floor(rng() * 1800);
    let sum = 0;
    for (let q = 0; q < 4; q++) {
      const v = base * (10 + Math.floor(rng() * 90));
      sum += v;
      const neg = /원가|판관비|비용|상각|법인세|부채/.test(label);
      cells.push(place(q + 2, row, (neg ? '-' : '') + fmt(v), neg ? 'xl-num xl-neg' : 'xl-num'));
    }
    cells.push(place(6, row, fmt(sum), 'xl-num xl-bold'));
    cells.push(place(7, row, (5 + Math.floor(rng() * 90)) + '%', 'xl-num xl-muted'));
  });

  // 선택 셀 (엑셀 초록/파랑 테두리 + 채우기 핸들)
  const selC = 3, selR = 5;
  const sel = `<div class="xl-sel" style="left:${selC * CELL_W}px;top:${selR * CELL_H}px"><span class="xl-handle"></span></div>`;

  return `
    <div class="xl">
      <div class="xl-fbar">
        <div class="xl-namebox">${colName(selC)}${selR + 1}</div>
        <div class="xl-fx">fx</div>
        <div class="xl-finput">=SUM(C7:F7)</div>
      </div>
      <div class="xl-grid">
        <div class="xl-corner"><i></i></div>
        <div class="xl-colhdr">${colhdr}</div>
        <div class="xl-rowhdr">${rowhdr}</div>
        <div class="xl-cells">
          <div class="xl-lines"></div>
          ${cells.join('')}
          ${sel}
        </div>
      </div>
      <div class="xl-tabs">
        <span class="xl-tab active">손익계산서</span>
        <span class="xl-tab">재무상태표</span>
        <span class="xl-tab">현금흐름</span>
        <span class="xl-tab">Sheet4</span>
        <span class="xl-plus">＋</span>
      </div>
    </div>`;

  function place(c, r, text, cls) {
    return `<div class="${cls}" style="left:${c * CELL_W}px;top:${r * CELL_H}px">${esc(text)}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 코드 에디터
// ══════════════════════════════════════════════════════════════════════════════
const SYNTAX = {
  code:    { line: '#858585', kw: '#569cd6', str: '#ce9178', com: '#6a9955', fn: '#dcdcaa', num: '#b5cea8', type: '#4ec9b0', vr: '#9cdcfe', plain: '#d4d4d4', kwBold: false },
  vscode:  { line: '#237893', kw: '#0000ff', str: '#a31515', com: '#008000', fn: '#795e26', num: '#098658', type: '#267f99', vr: '#001080', plain: '#1f1f1f', kwBold: false },
  eclipse: { line: '#787878', kw: '#7f0055', str: '#2a00ff', com: '#3f7f5f', fn: '#000000', num: '#1e1e22', type: '#000000', vr: '#0000c0', plain: '#000000', kwBold: true },
};

const FILES = ['StoreService.js', 'useAuth.js', 'router.js', 'ContentView.vue',
  'BoardList.vue', 'FormLayout.vue', 'apiClient.js', 'constants.js', 'index.js', 'main.js'];

// 토큰: [type, value]. type: kw/str/com/fn/num/type/vr/plain
const CODE = [
  [['com', '// 콘텐츠 목록을 종류별로 분류해 반환한다']],
  [['kw', 'import'], ['plain', ' { '], ['vr', 'ref'], ['plain', ', '], ['vr', 'computed'], ['plain', ' } '], ['kw', 'from'], ['plain', ' '], ['str', "'vue'"]],
  [['kw', 'import'], ['plain', ' '], ['vr', 'apiClient'], ['plain', ' '], ['kw', 'from'], ['plain', ' '], ['str', "'@/api/apiClient'"]],
  [],
  [['kw', 'const'], ['plain', ' '], ['vr', 'fileList'], ['plain', ' = '], ['fn', 'ref'], ['plain', '([])']],
  [['kw', 'const'], ['plain', ' '], ['vr', 'isLoading'], ['plain', ' = '], ['fn', 'ref'], ['plain', '('], ['kw', 'false'], ['plain', ')']],
  [],
  [['kw', 'const'], ['plain', ' '], ['fn', 'filterFilesByType'], ['plain', ' = ('], ['vr', 'list'], ['plain', ', '], ['vr', 'type'], ['plain', ') => {']],
  [['plain', '  '], ['kw', 'return'], ['plain', ' '], ['vr', 'list'], ['plain', '.'], ['fn', 'filter'], ['plain', '(('], ['vr', 'item'], ['plain', ') => '], ['vr', 'item'], ['plain', '.'], ['vr', 'fileType'], ['plain', ' === '], ['vr', 'type'], ['plain', ')']],
  [['plain', '}']],
  [],
  [['kw', 'async'], ['plain', ' '], ['kw', 'function'], ['plain', ' '], ['fn', 'loadContents'], ['plain', '('], ['vr', 'menuId'], ['plain', ') {']],
  [['plain', '  '], ['vr', 'isLoading'], ['plain', '.'], ['vr', 'value'], ['plain', ' = '], ['kw', 'true']],
  [['plain', '  '], ['kw', 'const'], ['plain', ' '], ['vr', 'res'], ['plain', ' = '], ['kw', 'await'], ['plain', ' '], ['vr', 'apiClient'], ['plain', '.'], ['fn', 'get'], ['plain', '('], ['str', '`/contents/${'], ['vr', 'menuId'], ['str', '}`'], ['plain', ')']],
  [['plain', '  '], ['vr', 'fileList'], ['plain', '.'], ['vr', 'value'], ['plain', ' = '], ['vr', 'res'], ['plain', '.'], ['vr', 'data'], ['plain', '.'], ['fn', 'map'], ['plain', '(('], ['vr', 'item'], ['plain', ') => ({']],
  [['plain', '    ...'], ['vr', 'item'], ['plain', ', '], ['vr', 'prgrmType'], ['plain', ': '], ['str', "'CONTS'"]],
  [['plain', '  }))']],
  [['plain', '  '], ['vr', 'isLoading'], ['plain', '.'], ['vr', 'value'], ['plain', ' = '], ['kw', 'false']],
  [['plain', '}']],
  [],
  [['kw', 'const'], ['plain', ' '], ['vr', 'vodFiles'], ['plain', ' = '], ['fn', 'computed'], ['plain', '(() => '], ['fn', 'filterFilesByType'], ['plain', '('], ['vr', 'fileList'], ['plain', '.'], ['vr', 'value'], ['plain', ', '], ['str', "'vod'"], ['plain', '))']],
  [['kw', 'const'], ['plain', ' '], ['vr', 'imgFiles'], ['plain', ' = '], ['fn', 'computed'], ['plain', '(() => '], ['fn', 'filterFilesByType'], ['plain', '('], ['vr', 'fileList'], ['plain', '.'], ['vr', 'value'], ['plain', ', '], ['str', "'img'"], ['plain', '))']],
  [],
  [['kw', 'export'], ['plain', ' '], ['kw', 'default'], ['plain', ' { '], ['vr', 'loadContents'], ['plain', ', '], ['vr', 'vodFiles'], ['plain', ', '], ['vr', 'imgFiles'], ['plain', ' }']],
];

function editorHTML(theme) {
  const p = SYNTAX[theme] || SYNTAX.code;
  const tree = FILES.map((f, i) =>
    `<div class="ed-file${i === 3 ? ' active' : ''}"><span class="ed-fi">${f.endsWith('.vue') ? '🟩' : '🟨'}</span>${esc(f)}</div>`).join('');

  const lines = CODE.map((toks, i) => {
    const code = toks.map(([t, v]) => {
      const col = p[t] || p.plain;
      const bold = (t === 'kw' && p.kwBold) ? ';font-weight:700' : '';
      return `<span style="color:${col}${bold}">${esc(v)}</span>`;
    }).join('');
    return `<div class="ed-line"><span class="ed-ln">${i + 1}</span><span class="ed-code">${code || '&nbsp;'}</span></div>`;
  }).join('');

  return `
    <div class="ed" style="--ln:${p.line}">
      <div class="ed-activity">
        <span class="ed-ai active">🗂</span><span class="ed-ai">🔍</span>
        <span class="ed-ai">⑂</span><span class="ed-ai">🐞</span><span class="ed-ai">🧩</span>
      </div>
      <div class="ed-side">
        <div class="ed-side-t">탐색기</div>
        <div class="ed-side-p">CNEDU-FRONT</div>
        ${tree}
      </div>
      <div class="ed-main">
        <div class="ed-tabs">
          <span class="ed-tab">StoreService.js</span>
          <span class="ed-tab active">ContentView.vue</span>
          <span class="ed-tab">FormLayout.vue</span>
        </div>
        <div class="ed-body">${lines}</div>
      </div>
      <div class="ed-status"><span>⑂ main</span><span>Ln 24, Col 18</span><span>UTF-8</span><span>JavaScript</span></div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 문서 (워드풍)
// ══════════════════════════════════════════════════════════════════════════════
function documentHTML() {
  const paras = [
    { h: '1. 개요', lines: [95, 88, 72] },
    { h: '2. 추진 배경 및 목적', lines: [90, 96, 84, 60] },
    { h: '3. 세부 추진 계획', lines: [93, 80, 91, 70, 88] },
    { h: '4. 기대 효과', lines: [86, 74] },
  ];
  const body = paras.map(p => `
    <h3 class="dc-h">${p.h}</h3>
    ${p.lines.map(w => `<div class="dc-l" style="width:${w}%"></div>`).join('')}
  `).join('');
  return `
    <div class="dc-ribbon">
      <span class="dc-rt active">홈</span><span class="dc-rt">삽입</span>
      <span class="dc-rt">레이아웃</span><span class="dc-rt">참조</span><span class="dc-rt">검토</span>
    </div>
    <div class="dc-scroll">
      <div class="dc-page">
        <div class="dc-title">2026년 상반기 사업 추진 계획(안)</div>
        <div class="dc-sub">교육콘텐츠사업팀 · 2026-07-21</div>
        ${body}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 스타일
// ══════════════════════════════════════════════════════════════════════════════
const style = document.createElement('style');
style.textContent = `
#pg-camo {
  position: fixed; inset: 0; z-index: -1; overflow: hidden;
  pointer-events: none; user-select: none;
  font-family: 'Segoe UI', 'Apple SD Gothic Neo', sans-serif;
}
body.pg-camo-on { background: transparent; }

/* ── 스프레드시트 ── */
.pg-camo-sheet #pg-camo, #pg-camo .xl { height: 100%; }
.xl { display: flex; flex-direction: column; background: var(--card); }
.xl-fbar { display: flex; align-items: center; height: 24px; flex-shrink: 0;
  background: var(--bg); border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text); }
.xl-namebox { width: 92px; height: 100%; display: flex; align-items: center; padding: 0 8px;
  border-right: 1px solid var(--border); color: var(--gray); }
.xl-fx { width: 34px; text-align: center; font-style: italic; color: var(--muted); border-right: 1px solid var(--border); }
.xl-finput { padding: 0 10px; color: var(--text); }
.xl-grid { flex: 1; display: grid; grid-template-columns: 42px 1fr; grid-template-rows: 22px 1fr; min-height: 0; }
.xl-corner { background: var(--bg); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); position: relative; }
.xl-corner i { position: absolute; right: 3px; bottom: 3px; width: 0; height: 0;
  border-left: 6px solid transparent; border-bottom: 6px solid var(--muted); }
.xl-colhdr { display: flex; overflow: hidden; background: var(--bg); border-bottom: 1px solid var(--border); }
.xl-ch { width: ${CELL_W}px; flex-shrink: 0; height: 22px; line-height: 22px; text-align: center;
  font-size: 11px; color: var(--gray); border-right: 1px solid var(--border); }
.xl-rowhdr { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); border-right: 1px solid var(--border); }
.xl-rh { height: ${CELL_H}px; line-height: ${CELL_H}px; text-align: center; font-size: 11px;
  color: var(--gray); border-bottom: 1px solid var(--border); }
.xl-cells { position: relative; overflow: hidden; }
.xl-lines { position: absolute; inset: 0;
  background-image:
    linear-gradient(to right, var(--border) 1px, transparent 1px),
    linear-gradient(to bottom, var(--border) 1px, transparent 1px);
  background-size: ${CELL_W}px ${CELL_H}px; opacity: 0.6; }
.xl-cells > div:not(.xl-lines):not(.xl-sel) {
  position: absolute; width: ${CELL_W}px; height: ${CELL_H}px; line-height: ${CELL_H}px;
  padding: 0 4px; font-size: 11px; color: var(--text); white-space: nowrap; overflow: hidden; }
.xl-th { font-weight: 700; text-align: center; background: color-mix(in srgb, var(--green-mid) 16%, var(--card)); color: var(--green-dark); }
.xl-lbl { font-weight: 600; }
.xl-num { text-align: right; font-variant-numeric: tabular-nums; }
.xl-bold { font-weight: 700; }
.xl-neg { color: var(--red); }
.xl-muted { color: var(--muted); }
.xl-sel { position: absolute; width: ${CELL_W + 1}px; height: ${CELL_H + 1}px;
  border: 2px solid var(--green-mid); background: color-mix(in srgb, var(--green-mid) 8%, transparent); box-sizing: border-box; }
.xl-handle { position: absolute; right: -3px; bottom: -3px; width: 6px; height: 6px;
  background: var(--green-mid); border: 1px solid var(--card); }
.xl-tabs { display: flex; align-items: center; gap: 2px; height: 26px; flex-shrink: 0; padding: 0 6px;
  background: var(--bg); border-top: 1px solid var(--border); font-size: 11px; }
.xl-tab { padding: 3px 12px; color: var(--muted); border: 1px solid transparent; border-bottom: none; }
.xl-tab.active { background: var(--card); color: var(--green-dark); font-weight: 700;
  border-color: var(--border); border-radius: 3px 3px 0 0; }
.xl-plus { color: var(--muted); padding: 0 6px; }

/* ── 코드 에디터 ── */
.ed { display: grid; grid-template-columns: 48px 232px 1fr; grid-template-rows: 1fr 24px;
  grid-template-areas: 'act side main' 'status status status'; height: 100%; background: var(--card); font-size: 12.5px; }
.ed-activity { grid-area: act; background: var(--bg); display: flex; flex-direction: column; align-items: center;
  gap: 16px; padding-top: 12px; border-right: 1px solid var(--border); }
.ed-ai { font-size: 18px; opacity: 0.5; filter: grayscale(0.3); }
.ed-ai.active { opacity: 1; }
.ed-side { grid-area: side; background: var(--bg); border-right: 1px solid var(--border); overflow: hidden; padding-top: 4px; }
.ed-side-t { font-size: 10.5px; letter-spacing: 1px; color: var(--muted); text-transform: uppercase; padding: 6px 12px 2px; }
.ed-side-p { font-size: 11px; font-weight: 700; color: var(--text); padding: 4px 12px; }
.ed-file { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); padding: 3px 12px 3px 22px; }
.ed-file .ed-fi { font-size: 10px; }
.ed-file.active { background: color-mix(in srgb, var(--green-mid) 20%, transparent); }
.ed-main { grid-area: main; display: flex; flex-direction: column; overflow: hidden; background: var(--card); }
.ed-tabs { display: flex; height: 34px; flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border); }
.ed-tab { display: flex; align-items: center; padding: 0 16px; font-size: 12px; color: var(--muted);
  border-right: 1px solid var(--border); }
.ed-tab.active { background: var(--card); color: var(--text); }
.ed-body { flex: 1; overflow: hidden; padding: 6px 0;
  font-family: 'Consolas', 'D2Coding', 'Courier New', monospace; }
.ed-line { display: flex; height: 19px; line-height: 19px; }
.ed-ln { width: 44px; flex-shrink: 0; text-align: right; padding-right: 14px; color: var(--ln); opacity: 0.85; }
.ed-code { white-space: pre; }
.ed-status { grid-area: status; display: flex; align-items: center; gap: 18px; padding: 0 14px;
  background: var(--green-mid); color: #fff; font-size: 11px; }

/* ── 문서 ── */
#pg-camo .dc-ribbon { display: flex; align-items: center; gap: 4px; height: 40px; padding: 0 14px;
  background: var(--card); border-bottom: 1px solid var(--border); }
.dc-rt { font-size: 12px; color: var(--muted); padding: 4px 12px; }
.dc-rt.active { color: var(--green-dark); font-weight: 700; border-bottom: 2px solid var(--green-mid); height: 40px; display: flex; align-items: center; }
.dc-scroll { position: absolute; inset: 40px 0 0; overflow: hidden; display: flex; justify-content: center; padding-top: 28px; }
.dc-page { width: min(780px, 82vw); background: var(--card); box-shadow: 0 4px 18px var(--shadow);
  border: 1px solid var(--border); padding: 64px 72px; }
.dc-title { font-size: 22px; font-weight: 800; color: var(--text); text-align: center; }
.dc-sub { font-size: 12px; color: var(--muted); text-align: center; margin: 8px 0 30px; }
.dc-h { font-size: 15px; font-weight: 700; color: var(--green-dark); margin: 20px 0 10px; }
.dc-l { height: 9px; background: color-mix(in srgb, var(--text) 16%, transparent); border-radius: 2px; margin: 9px 0; }
`;
document.head.appendChild(style);

// ══════════════════════════════════════════════════════════════════════════════
// 빌드 / 갱신
// ══════════════════════════════════════════════════════════════════════════════
let layer = null;
function ensureLayer() {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.id = 'pg-camo';
  layer.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(layer, document.body.firstChild);
  return layer;
}

function currentTheme() { return document.documentElement.dataset.theme || 'green'; }

let raf = 0;
function build() {
  const kind = KIND[currentTheme()];
  if (!kind) {
    document.body.classList.remove('pg-camo-on');
    if (layer) { layer.remove(); layer = null; }
    return;
  }
  document.body.classList.add('pg-camo-on');
  const el = ensureLayer();
  el.className = 'pg-camo-' + kind;
  if (kind === 'sheet') el.innerHTML = spreadsheetHTML();
  else if (kind === 'editor') el.innerHTML = editorHTML(currentTheme());
  else el.innerHTML = documentHTML();
}
function scheduleBuild() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(build);
}

// 테마 변경 감지
new MutationObserver(scheduleBuild).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
// 리사이즈 시 시트/에디터를 뷰포트에 다시 맞춤
let rt = 0;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(scheduleBuild, 150); });

if (document.body) build();
else document.addEventListener('DOMContentLoaded', build);
