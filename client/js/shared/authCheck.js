import { $ } from './screenManager.js';

/**
 * /api/me 호출 → 세션 정보 표시, 미인증 시 홈으로 리다이렉트
 * @returns {Promise<{username, avatar}>}
 */
export function checkAuth(inputName) {
  return fetch('/api/me')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) { window.location.href = '/'; return null; }

      inputName.value = data.username;

      const userBar  = $('user-info-bar');
      const nameWrap = $('name-input-wrap');
      const avatarEl = $('session-avatar');

      $('session-nick-name').textContent = data.username;

      if (data.avatar) {
        avatarEl.innerHTML = `<img src="${data.avatar}" alt="avatar" style="width:100%;height:100%;object-fit:cover;" />`;
      }
      userBar.style.display  = 'flex';
      nameWrap.style.display = 'none';

      return data;
    })
    .catch(() => { window.location.href = '/'; return null; });
}
