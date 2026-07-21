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

  // 가짜 업무 데이터 (개발 산출물 — 테스트케이스 관리대장) — 시트를 끝까지 꽉 채워 덜 티나게.
  const rng = makeRng(20260721);
  const pick = a => a[Math.floor(rng() * a.length)];
  const heads = ['TC ID', '기능 모듈', '테스트 항목', '기대 결과', '우선순위', '담당자', '결과', '수행일', '재현', '결함 ID', '비고'];
  const modules = ['로그인', '콘텐츠 목록', '상세 보기', '파일 업로드', '검색', '권한 관리',
    '알림', '마이페이지', '게시판', '통계 대시보드', '환경 설정', '회원가입', '결제', '댓글', 'SSO 연동'];
  const items = ['정상 입력 검증', '필수값 누락 처리', '중복 등록 차단', '확장자 화이트리스트',
    '최대 용량 초과', '페이지네이션', '정렬 옵션 적용', '권한 없음 접근', '세션 만료 처리',
    '반응형 레이아웃', '에러 토스트 노출', '로딩 상태 표시', 'XSS 이스케이프', '캐시 무효화', '동시성 처리'];
  const expects = ['정상 처리', '에러 메시지 노출', '목록 즉시 갱신', '업로드 성공', '요청 차단됨',
    '정상 페이지 이동', '필터 정상 적용', '403 반환', '재로그인 유도', '정상 렌더링'];
  const prios = ['P1', 'P2', 'P2', 'P3'];
  const names = ['김민수', '이서연', '박지훈', '최유진', '정우성', '한도윤'];
  const stats = ['Pass', 'Pass', 'Pass', 'Pass', 'Pass', 'Fail', '진행', '보류'];
  const notes = ['', '', '', '재확인 필요', '', '핫픽스 반영', '', '리그레션', '', 'QA 승인', ''];

  const cells = [];
  // 표 헤더 (2행부터, B열부터)
  heads.forEach((h, c) => cells.push(place(c + 1, 1, h, 'xl-th')));
  // 화면 높이에 맞춰 행을 끝까지 채운다
  const N = Math.max(24, Math.ceil((window.innerHeight - 46) / CELL_H) - 1);
  let passCnt = 0;
  for (let r = 0; r < N; r++) {
    const row = r + 2;
    const st = pick(stats);
    if (st === 'Pass') passCnt++;
    // 결과 열에 엑셀 조건부 서식 채우기 색 (Good=연녹/Bad=연빨강/Neutral=연노랑)
    // → 배경 곳곳에 초록·노랑이 깔려 게임 보드의 색칠 셀이 그냥 조건부 서식처럼 묻힌다.
    const stFill = st === 'Pass' ? 'xl-fill-good' : st === 'Fail' ? 'xl-fill-bad' : 'xl-fill-neutral';
    const day = 8 + (r % 12);
    cells.push(place(1, row, 'TC-' + String(r + 1).padStart(3, '0'), 'xl-lbl'));
    cells.push(place(2, row, pick(modules), 'xl-txt'));
    cells.push(place(3, row, pick(items), 'xl-txt'));
    cells.push(place(4, row, pick(expects), 'xl-txt'));
    cells.push(place(5, row, pick(prios), 'xl-mid'));
    cells.push(place(6, row, pick(names), 'xl-mid'));
    cells.push(place(7, row, st, 'xl-mid xl-bold ' + stFill));
    cells.push(place(8, row, '07-' + String(day).padStart(2, '0'), 'xl-mid xl-muted'));
    cells.push(place(9, row, st === 'Fail' ? '3/10' : '10/10', 'xl-mid ' + (st === 'Fail' ? 'xl-fill-bad' : 'xl-fill-good')));
    cells.push(place(10, row, st === 'Fail' ? 'DEF-' + String(100 + r).slice(-3) : '-', 'xl-mid xl-muted'));
    cells.push(place(11, row, pick(notes), 'xl-txt xl-muted'));
  }
  // 우측 요약 블록
  const pct = Math.round((passCnt / N) * 100);
  cells.push(place(13, 1, '합격률', 'xl-th'));
  cells.push(place(13, 2, pct + '%', 'xl-num xl-ok xl-bold'));
  cells.push(place(13, 3, '총 ' + N + '건', 'xl-num xl-muted'));

  // 선택 셀 (엑셀 초록 테두리 + 채우기 핸들) — 합격률 요약 셀
  const selC = 13, selR = 2;
  const sel = `<div class="xl-sel" style="left:${selC * CELL_W}px;top:${selR * CELL_H}px"><span class="xl-handle"></span></div>`;

  return `
    <div class="xl">
      <div class="xl-fbar">
        <div class="xl-namebox">${colName(selC)}${selR + 1}</div>
        <div class="xl-fx">fx</div>
        <div class="xl-finput">=COUNTIF(H3:H19,"Pass")/COUNTA(H3:H19)</div>
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
        <span class="xl-tab active">테스트케이스</span>
        <span class="xl-tab">결함관리대장</span>
        <span class="xl-tab">요구사항추적</span>
        <span class="xl-tab">배포이력</span>
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
  code:    { line: '#858585', kw: '#569cd6', str: '#ce9178', com: '#6a9955', fn: '#dcdcaa', num: '#b5cea8', type: '#4ec9b0', vr: '#9cdcfe', plain: '#d4d4d4', kwBold: false, term: '#181818', termTx: '#cccccc', prompt: '#4ec9b0', warn: '#dcb665', path: '#569cd6', dim: '#7a7a7a' },
  vscode:  { line: '#237893', kw: '#0000ff', str: '#a31515', com: '#008000', fn: '#795e26', num: '#098658', type: '#267f99', vr: '#001080', plain: '#1f1f1f', kwBold: false, term: '#ffffff', termTx: '#333333', prompt: '#0a7c2f', warn: '#a6791a', path: '#005fb8', dim: '#9a9a9a' },
  eclipse: { line: '#787878', kw: '#7f0055', str: '#2a00ff', com: '#3f7f5f', fn: '#000000', num: '#1e1e22', type: '#000000', vr: '#0000c0', plain: '#000000', kwBold: true, term: '#ffffff', termTx: '#333333', prompt: '#3f7f5f', warn: '#a6791a', path: '#4b3f8f', dim: '#9a9a9a' },
};

// 파일트리 (depth, 아이콘, 이름) — 사이드바를 꽉 채운다
const TREE = [
  [0, '📂', 'src'], [1, '📂', 'api'], [2, '🟨', 'apiClient.js'], [2, '🟨', 'StoreService.js'],
  [1, '📂', 'views'], [2, '📂', 'cmnBoard'], [3, '🟩', 'CmnBoardView.vue'], [3, '🟩', 'CmnBoardList.vue'],
  [3, '🟩', 'CmnBoardUpdate.vue'], [2, '📂', 'contsMvGllry'], [3, '🟩', 'ContsMvGllryList.vue'],
  [3, '🟩', 'ContsMvGllryView.vue'], [3, '🟩', 'ContentView.vue'], [2, '📂', 'contsPhtMvGllry'],
  [3, '🟩', 'PhtMvGllryForm.vue'], [3, '🟩', 'FormLayout.vue'], [1, '📂', 'store'], [2, '🟨', 'index.js'],
  [2, '🟨', 'useAuth.js'], [1, '📂', 'router'], [2, '🟨', 'router.js'], [1, '🟨', 'main.js'],
  [1, '🟦', 'vite.config.js'], [0, '🟧', 'package.json'],
];

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
  [],
  [['com', '// 첨부 파일을 확장자 화이트리스트로 검증한다']],
  [['kw', 'const'], ['plain', ' '], ['vr', 'WHITELIST'], ['plain', ' = ['], ['str', "'jpg'"], ['plain', ', '], ['str', "'png'"], ['plain', ', '], ['str', "'mp4'"], ['plain', ', '], ['str', "'pdf'"], ['plain', ']']],
  [['kw', 'const'], ['plain', ' '], ['vr', 'MAX_SIZE'], ['plain', ' = '], ['num', '1024'], ['plain', ' * '], ['num', '1024'], ['plain', ' * '], ['num', '300']],
  [],
  [['kw', 'function'], ['plain', ' '], ['fn', 'validateFile'], ['plain', '('], ['vr', 'file'], ['plain', ') {']],
  [['plain', '  '], ['kw', 'const'], ['plain', ' '], ['vr', 'ext'], ['plain', ' = '], ['vr', 'file'], ['plain', '.'], ['vr', 'name'], ['plain', '.'], ['fn', 'split'], ['plain', '('], ['str', "'.'"], ['plain', ').'], ['fn', 'pop'], ['plain', '()']],
  [['plain', '  '], ['kw', 'if'], ['plain', ' (!'], ['vr', 'WHITELIST'], ['plain', '.'], ['fn', 'includes'], ['plain', '('], ['vr', 'ext'], ['plain', ')) '], ['kw', 'return'], ['plain', ' '], ['kw', 'false']],
  [['plain', '  '], ['kw', 'return'], ['plain', ' '], ['vr', 'file'], ['plain', '.'], ['vr', 'size'], ['plain', ' <= '], ['vr', 'MAX_SIZE']],
  [['plain', '}']],
  [],
  [['kw', 'const'], ['plain', ' '], ['vr', 'goUpdate'], ['plain', ' = () => {']],
  [['plain', '  '], ['fn', 'namedPageLink'], ['plain', '('], ['str', "'ContsPhtMvGllryUpdate'"], ['plain', ', { '], ['vr', 'menuId'], ['plain', ': '], ['vr', 'route'], ['plain', '.'], ['vr', 'params'], ['plain', '.'], ['vr', 'menuId'], ['plain', ' })']],
  [['plain', '}']],
  [],
  [['kw', 'watch'], ['plain', '(() => '], ['vr', 'props'], ['plain', '.'], ['vr', 'contsId'], ['plain', ', ('], ['vr', 'id'], ['plain', ') => '], ['fn', 'loadContents'], ['plain', '('], ['vr', 'id'], ['plain', '))']],
  [['fn', 'onMounted'], ['plain', '(() => '], ['fn', 'loadContents'], ['plain', '('], ['vr', 'route'], ['plain', '.'], ['vr', 'params'], ['plain', '.'], ['vr', 'menuId'], ['plain', '))']],
];

function tokspan(toks, p) {
  return toks.map(([t, v]) => {
    const col = p[t] || p.plain;
    const bold = (t === 'kw' && p.kwBold) ? ';font-weight:700' : '';
    return `<span style="color:${col}${bold}">${esc(v)}</span>`;
  }).join('');
}

function editorHTML(theme) {
  const p = SYNTAX[theme] || SYNTAX.code;

  // 뷰포트 높이에 맞춰 코드 줄 수를 계산 — 항상 화면 끝까지 꽉 채운다.
  const TERM_H = Math.max(120, Math.min(220, Math.round(window.innerHeight * 0.26)));
  const bodyH = Math.max(200, window.innerHeight - 34 /*tabs*/ - 26 /*crumb*/ - TERM_H - 24 /*status*/);
  const nLines = Math.ceil(bodyH / 19) + 1;

  const tree = TREE.map(([d, ic, n]) => {
    const active = n === 'ContentView.vue';
    return `<div class="ed-file${active ? ' active' : ''}" style="padding-left:${8 + d * 13}px"><span class="ed-fi">${ic}</span>${esc(n)}</div>`;
  }).join('');

  const lines = Array.from({ length: nLines }, (_, i) => {
    const code = tokspan(CODE[i % CODE.length], p);
    return `<div class="ed-line"><span class="ed-ln">${i + 1}</span><span class="ed-code">${code || '&nbsp;'}</span></div>`;
  }).join('');

  // 미니맵: 같은 코드를 아주 작게 렌더
  const miniN = Math.ceil(bodyH / 3.4) + 4;
  const mini = Array.from({ length: miniN }, (_, i) =>
    `<div class="ed-mini-line">${tokspan(CODE[i % CODE.length], p) || '&nbsp;'}</div>`).join('');

  // 터미널 출력 (npm run dev + sass deprecation) — 레퍼런스와 같은 분위기
  const T = (c, s) => `<span style="color:${c}">${esc(s)}</span>`;
  const term = [
    T(p.dim, 'PS D:\\workspace\\cnedu-front\\cnedu-front-edunet> ') + T(p.termTx, 'npm run dev'),
    '',
    T(p.dim, '> cnedu-front-edunet@1.0.0 dev'),
    T(p.dim, '> vite --host'),
    '',
    '  ' + T(p.prompt, 'VITE v5.4.2') + T(p.termTx, '  ready in 842 ms'),
    '',
    '  ' + T(p.prompt, '➜') + T(p.termTx, '  Local:   ') + T(p.path, 'http://localhost:5173/'),
    '  ' + T(p.prompt, '➜') + T(p.termTx, '  Network: ') + T(p.path, 'http://192.168.0.14:5173/'),
    '',
    T(p.warn, '[sass] Deprecation Warning [import]: Sass @import rules are deprecated and will be removed in Dart Sass 3.0.0.'),
    '  ' + T(p.dim, '┌──> src/assets/css/common/config.scss'),
    T(p.dim, '3 │ ') + T(p.termTx, '@import "base_path";'),
    '  ' + T(p.dim, '│         ^^^^^^^^^^^^'),
    '',
    T(p.dim, '  page reload ') + T(p.termTx, 'src/views/contsMvGllry/ContentView.vue'),
  ].map(l => `<div>${l || '&nbsp;'}</div>`).join('');

  return `
    <div class="ed" style="--ln:${p.line};--term-bg:${p.term};--term-tx:${p.termTx}">
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
          <span class="ed-tab">PhtMvGllryForm.vue</span>
          <span class="ed-tab">FormLayout.vue</span>
        </div>
        <div class="ed-crumb">src <b>›</b> views <b>›</b> contsMvGllry <b>›</b> ContentView.vue <b>›</b> template <b>›</b> div.board_view_box</div>
        <div class="ed-editor">
          <div class="ed-body">${lines}</div>
          <div class="ed-minimap"><div class="ed-mini-vp"></div>${mini}</div>
        </div>
        <div class="ed-term" style="height:${TERM_H}px">
          <div class="ed-term-tabs"><span>문제</span><span>출력</span><span>디버그 콘솔</span><span class="active">터미널</span><span>포트</span></div>
          <div class="ed-term-body">${term}</div>
        </div>
      </div>
      <div class="ed-status"><span>⑂ main</span><span>⊘ 0 △ 1</span><span>Ln 24, Col 18</span><span>UTF-8</span><span>Vue</span></div>
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
.xl-txt { text-align: left; }
.xl-mid { text-align: center; }
.xl-bold { font-weight: 700; }
.xl-neg { color: var(--red); }
.xl-ok { color: #217346; }
.xl-muted { color: var(--muted); }
/* 엑셀 조건부 서식 채우기 (Good/Bad/Neutral) — 게임 보드 색과 동일 팔레트로 배경에 깔림 */
.xl-fill-good { background: #c6efce; color: #006100; }
.xl-fill-bad { background: #ffc7ce; color: #9c0006; }
.xl-fill-neutral { background: #ffeb9c; color: #9c6500; }
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
.ed-crumb { display: flex; align-items: center; gap: 6px; height: 26px; flex-shrink: 0; padding: 0 16px;
  font-size: 11.5px; color: var(--muted); background: var(--card); border-bottom: 1px solid var(--border);
  white-space: nowrap; overflow: hidden; }
.ed-crumb b { color: var(--muted); font-weight: 400; opacity: 0.7; }
.ed-editor { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.ed-body { flex: 1; overflow: hidden; padding: 6px 0;
  font-family: 'Consolas', 'D2Coding', 'Courier New', monospace; }
.ed-line { display: flex; height: 19px; line-height: 19px; }
.ed-ln { width: 44px; flex-shrink: 0; text-align: right; padding-right: 14px; color: var(--ln); opacity: 0.85; }
.ed-code { white-space: pre; }
.ed-minimap { width: 66px; flex-shrink: 0; position: relative; overflow: hidden; padding: 6px 3px;
  background: var(--card); border-left: 1px solid var(--border); opacity: 0.72;
  font-family: 'Consolas', monospace; }
.ed-mini-line { height: 3.4px; line-height: 3.4px; font-size: 2.7px; white-space: pre; overflow: hidden; }
.ed-mini-vp { position: absolute; left: 0; right: 0; top: 0; height: 140px;
  background: color-mix(in srgb, var(--text) 9%, transparent); pointer-events: none; }
.ed-term { flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden;
  background: var(--term-bg); border-top: 1px solid var(--border); }
.ed-term-tabs { display: flex; align-items: center; gap: 16px; height: 28px; flex-shrink: 0; padding: 0 16px;
  font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.5px; }
.ed-term-tabs .active { color: var(--term-tx); border-bottom: 2px solid var(--green-mid); height: 28px; display: flex; align-items: center; }
.ed-term-body { flex: 1; overflow: hidden; padding: 6px 14px; white-space: pre; color: var(--term-tx);
  font-family: 'Consolas', 'D2Coding', monospace; font-size: 11.5px; line-height: 16px; }
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
