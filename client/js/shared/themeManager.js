// 테마 매니저 — 회사에서 몰래 하는 컨셉의 위장 테마 전환 위젯.
// data-theme 를 <html> 에 설정하고 localStorage('pg-theme') 에 저장한다.
// (첫 페인트 전 적용은 각 페이지 head 의 인라인 스크립트가 담당해 깜빡임을 막는다.)

const STORAGE_KEY = 'pg-theme';

const THEMES = [
  { key: 'green', label: '기본 (그린)', icon: '🌿' },
  { key: 'doc',   label: '문서',        icon: '📄' },
  { key: 'sheet', label: '스프레드시트', icon: '📊' },
  { key: 'code',  label: '코드 에디터',  icon: '💻' },
];

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return THEMES.some(x => x.key === t) ? t : 'green';
}

function applyTheme(key) {
  if (key === 'green') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = key;
  try { localStorage.setItem(STORAGE_KEY, key); } catch (e) {}
  render();
}

// ── 스타일 ─────────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
#tw-wrap {
  position: fixed;
  bottom: 64px;
  right: 20px;
  z-index: 999;
  font-family: inherit;
}
#tw-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--sunken);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 7px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--green-pale);
  transition: border-color 0.2s, box-shadow 0.2s;
  white-space: nowrap;
}
#tw-pill:hover { border-color: var(--green-light); }
#tw-panel {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 190px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 8px;
  box-shadow: 0 8px 24px var(--shadow);
}
#tw-panel.open { display: block; }
.tw-panel-title {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 1px;
  text-transform: uppercase;
  margin: 2px 6px 8px;
}
.tw-opt {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  transition: background 0.15s;
}
.tw-opt:hover { background: var(--sunken); }
.tw-opt.active { background: var(--green-dark); color: var(--white); }
.tw-opt .tw-ic { font-size: 1rem; flex-shrink: 0; }
.tw-opt .tw-check { margin-left: auto; font-size: 0.85rem; opacity: 0; }
.tw-opt.active .tw-check { opacity: 1; }
`;
document.head.appendChild(style);

// ── DOM ────────────────────────────────────────────────────────────────────────
const wrap = document.createElement('div');
wrap.id = 'tw-wrap';
wrap.innerHTML = `
  <div id="tw-panel">
    <div class="tw-panel-title">테마</div>
    <div id="tw-list"></div>
  </div>
  <div id="tw-pill">
    <span id="tw-pill-ic">🌿</span>
    <span id="tw-pill-label">테마</span>
  </div>
`;
document.body.appendChild(wrap);

const pill      = wrap.querySelector('#tw-pill');
const panel     = wrap.querySelector('#tw-panel');
const listEl    = wrap.querySelector('#tw-list');
const pillIc    = wrap.querySelector('#tw-pill-ic');
const pillLabel = wrap.querySelector('#tw-pill-label');

function render() {
  const cur = currentTheme();
  const meta = THEMES.find(t => t.key === cur);
  pillIc.textContent = meta.icon;
  pillLabel.textContent = '테마';
  listEl.innerHTML = THEMES.map(t => `
    <div class="tw-opt${t.key === cur ? ' active' : ''}" data-key="${t.key}">
      <span class="tw-ic">${t.icon}</span>
      <span>${t.label}</span>
      <span class="tw-check">✓</span>
    </div>
  `).join('');
  listEl.querySelectorAll('.tw-opt').forEach(el => {
    el.addEventListener('click', () => { applyTheme(el.dataset.key); panel.classList.remove('open'); });
  });
}

pill.addEventListener('click', () => panel.classList.toggle('open'));
document.addEventListener('click', e => { if (!wrap.contains(e.target)) panel.classList.remove('open'); });

render();
