import { io }      from '/socket.io/socket.io.esm.min.js';
import { escHtml } from './utils.js';

// ── 스타일 주입 ───────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
#ow-wrap {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999;
  font-family: inherit;
}

#ow-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--sunken);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 7px 14px;
  cursor: pointer;
  user-select: none;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--green-pale);
  transition: border-color 0.2s, box-shadow 0.2s;
  white-space: nowrap;
}

#ow-pill:hover {
  border-color: var(--green-light);
}

.ow-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--green-light);
  box-shadow: 0 0 6px var(--green-light);
  animation: ow-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes ow-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

#ow-panel {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 220px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 8px 24px var(--shadow);
}

#ow-panel.open { display: block; }

.ow-panel-title {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.ow-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.ow-user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ow-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--green-mid), var(--green-dark));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--white);
  flex-shrink: 0;
  overflow: hidden;
}

.ow-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ow-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--green-pale);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;
document.head.appendChild(style);

// ── DOM 생성 ──────────────────────────────────────────────────────────────────
const wrap = document.createElement('div');
wrap.id = 'ow-wrap';
wrap.innerHTML = `
  <div id="ow-panel">
    <div class="ow-panel-title">현재 접속자</div>
    <div class="ow-list" id="ow-list"></div>
  </div>
  <div id="ow-pill">
    <span class="ow-dot"></span>
    <span id="ow-count">-</span>명 접속 중
  </div>
`;
document.body.appendChild(wrap);

const pill    = document.getElementById('ow-pill');
const panel   = document.getElementById('ow-panel');
const countEl = document.getElementById('ow-count');
const listEl  = document.getElementById('ow-list');

pill.addEventListener('click', () => panel.classList.toggle('open'));
document.addEventListener('click', e => {
  if (!wrap.contains(e.target)) panel.classList.remove('open');
});

// ── 소켓 ──────────────────────────────────────────────────────────────────────
const socket = io();

socket.on('online_users', (users) => {
  countEl.textContent = users.length;
  listEl.innerHTML = users.map(u => {
    const avatarHtml = u.avatar
      ? `<img src="${u.avatar}" />`
      : escHtml(u.username?.[0] ?? '?');
    return `
      <div class="ow-user">
        <div class="ow-avatar">${avatarHtml}</div>
        <span class="ow-name">${escHtml(u.username)}</span>
      </div>`;
  }).join('');
});
