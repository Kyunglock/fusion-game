import { escHtml } from '../utils.js';
import { $ } from './screenManager.js';

export function nameHtml(name) { return escHtml(name); }
export function nameText(name) { return name; }

export function triggerFlash() {
  const el = $('flash-overlay');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

export function triggerShake() {
  document.body.classList.remove('shaking');
  void document.body.offsetWidth;
  document.body.classList.add('shaking');
  setTimeout(() => document.body.classList.remove('shaking'), 600);
}

/**
 * 결과 카운트다운 (라운드 종료 후 자동 복귀)
 */
let returnCountdownInterval = null;

export function startReturnCountdown(seconds, onExpire = null) {
  const resultCountdown = $('result-countdown');
  clearInterval(returnCountdownInterval);
  let rem = seconds;
  resultCountdown.textContent = rem;
  returnCountdownInterval = setInterval(() => {
    rem--;
    if (rem <= 0) {
      clearInterval(returnCountdownInterval);
      if (onExpire) onExpire();
      return;
    }
    resultCountdown.textContent = rem;
  }, 1000);
}

export function clearReturnCountdown() {
  clearInterval(returnCountdownInterval);
  const el = $('result-countdown');
  if (el) el.textContent = '';
}

/**
 * alone overlay 표시
 */
export function showAloneOverlay(message, beforeShow = null) {
  const overlay     = $('alone-overlay');
  const msgEl       = $('alone-msg');
  const countdownEl = $('alone-countdown');

  if (beforeShow) beforeShow();
  msgEl.textContent = message;
  overlay.classList.add('show');

  let sec = 3;
  countdownEl.textContent = sec;
  const timer = setInterval(() => {
    sec -= 1;
    countdownEl.textContent = sec;
    if (sec <= 0) {
      clearInterval(timer);
      overlay.classList.remove('show');
    }
  }, 1000);
}

/**
 * kicked 처리
 */
export function handleKicked(socket, showError, message, resetFn) {
  showError(message);
  socket.disconnect();
  socket.connect();
  if (resetFn) resetFn();
}
