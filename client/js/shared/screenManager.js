const $ = id => document.getElementById(id);

const screens = {
  lobby:   $('screen-lobby'),
  waiting: $('screen-waiting'),
  game:    $('screen-game'),
};

let _setChatVisible = () => {};

export function initScreenManager(setChatVisible) {
  _setChatVisible = setChatVisible;
}

export function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  _setChatVisible(name !== 'lobby');
}

export { $, screens };
