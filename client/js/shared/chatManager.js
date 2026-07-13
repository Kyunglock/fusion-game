import { escHtml } from '../utils.js';
import { $ } from './screenManager.js';

let chatUnread = 0;
let myId       = null;
let socket     = null;

const chatWrap     = $('chat-wrap');
const chatPanel    = $('chat-panel');
const chatMessages = $('chat-messages');
const chatInput    = $('chat-input');
const chatBadge    = $('chat-badge');

/** playerAvatarEmojis Map 참조를 외부에서 주입 */
let avatarEmojis = new Map();

export function initChat(sock, myIdGetter, avatarMap) {
  socket       = sock;
  myId         = myIdGetter;
  avatarEmojis = avatarMap;

  $('chat-fab').addEventListener('click', () => {
    const closing = !chatPanel.classList.contains('collapsed');
    chatPanel.classList.toggle('collapsed', closing);
    if (!closing) {
      chatUnread = 0;
      chatBadge.textContent = '';
      chatBadge.classList.remove('show');
      chatMessages.scrollTop = chatMessages.scrollHeight;
      chatInput.focus();
    }
  });

  $('chat-close').addEventListener('click', () => chatPanel.classList.add('collapsed'));

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
  });

  $('chat-send').addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  socket.on('chat_history', (history) => {
    chatMessages.innerHTML = '';
    history.forEach(msg => appendChatMessage(msg, false));
  });

  socket.on('chat_message', (msg) => appendChatMessage(msg, true));
}

export function setChatVisible(visible) {
  const wasVisible = chatWrap.classList.contains('visible');
  chatWrap.classList.toggle('visible', visible);
  if (visible) {
    if (!wasVisible) chatPanel.classList.remove('collapsed');
  } else {
    chatMessages.innerHTML = '';
    chatUnread = 0;
    chatBadge.textContent = '';
    chatBadge.classList.remove('show');
  }
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { text });
  chatInput.value = '';
  chatInput.style.height = 'auto';
}

export function appendChatMessage({ senderId, senderName, senderAvatar, text }, notify = true) {
  const id   = typeof myId === 'function' ? myId() : myId;
  const isMe = senderId === id;
  const div  = document.createElement('div');
  div.className = `chat-msg${isMe ? ' is-me' : ''}`;

  const safeText      = escHtml(text).replace(/\n/g, '<br>');
  const fallbackEmoji = avatarEmojis.get(senderId) ?? '💬';
  const avatarHtml    = senderAvatar
    ? `<div class="chat-avatar"><img src="${senderAvatar}" alt="" /></div>`
    : `<div class="chat-avatar">${fallbackEmoji}</div>`;

  div.innerHTML = `
    ${avatarHtml}
    <div class="chat-bubble">
      ${!isMe ? `<div class="chat-name">${escHtml(senderName)}</div>` : ''}
      <div class="chat-text">${safeText}</div>
    </div>
  `;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (notify && !isMe && chatPanel.classList.contains('collapsed')) {
    chatUnread++;
    chatBadge.textContent = chatUnread > 9 ? '9+' : chatUnread;
    chatBadge.classList.add('show');
  }
}

export function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-system-msg';
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function showJoinNotice(name, isSpec) {
  appendSystemMessage(isSpec ? `👀 ${name}님이 관전을 시작했습니다` : `🎉 ${name}님이 입장했습니다`);
}
