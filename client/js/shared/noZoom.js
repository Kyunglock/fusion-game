// 모바일 확대(줌) 방지.
//
// meta viewport 의 user-scalable=no 는 iOS Safari 10 부터 무시되므로,
// 핀치 줌(gesture 이벤트)과 더블탭 줌을 스크립트로 함께 막아야 한다.
// (더블탭 줌은 CSS touch-action: manipulation 이 대부분 처리하지만,
//  버튼 밖의 빈 영역을 빠르게 두 번 누르는 경우까지 잡으려면 이 폴백이 필요하다)

// 핀치 줌 (iOS Safari)
['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
});

// 두 손가락 이상 터치로 시작하는 확대
document.addEventListener('touchstart', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// 더블탭 줌 — 300ms 안에 들어온 두 번째 탭을 취소한다.
// 입력 요소는 커서 이동/선택을 방해하지 않도록 건드리지 않는다.
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300 && !e.target.closest?.('input, textarea, select')) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, { passive: false });
