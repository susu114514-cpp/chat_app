const socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

// DOM 元素
const loginPanel = document.getElementById('login-panel');
const chatPanel = document.getElementById('chat-panel');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const loginError = document.getElementById('login-error');
const currentUserEl = document.getElementById('current-user');
const connectionStatus = document.getElementById('connection-status');
const onlineCount = document.getElementById('online-count');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const typingIndicator = document.getElementById('typing-indicator');

let currentUser = null;
let typingTimeout = null;

// ===== 登录 =====
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) {
    loginError.textContent = '请输入昵称';
    return;
  }
  loginError.textContent = '';
  socket.emit('join', name);
});

// 登录成功（收到历史消息即视为成功）
socket.on('history', (history) => {
  if (currentUser) return; // 避免重复
  currentUser = usernameInput.value.trim();
  currentUserEl.textContent = currentUser;
  loginPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  messageInput.focus();

  // 渲染历史消息
  messagesEl.innerHTML = '';
  history.forEach(msg => appendMessage(msg, false));
});

socket.on('join_error', (msg) => {
  loginError.textContent = msg;
});

// ===== 消息收发 =====
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', text);
  messageInput.value = '';
  socket.emit('typing', false);
});

socket.on('chat_message', (msg) => {
  appendMessage(msg, true);
});

function appendMessage(msg, scroll = true) {
  const div = document.createElement('div');
  div.className = 'message ' + (msg.username === currentUser ? 'own' : 'other');

  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  meta.textContent = `${msg.username} · ${time}`;

  const text = document.createElement('div');
  text.textContent = msg.text;

  div.appendChild(meta);
  div.appendChild(text);
  messagesEl.appendChild(div);

  if (scroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// ===== 系统消息 =====
socket.on('system', (text) => {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// ===== 在线用户 =====
socket.on('online_users', (users) => {
  onlineCount.textContent = `${users.length} 人在线`;
});

// ===== 输入状态 =====
let typingUsers = new Map();

messageInput.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', false);
  }, 1500);
});

socket.on('typing', ({ username, isTyping }) => {
  if (username === currentUser) return;
  if (isTyping) {
    typingUsers.set(username, Date.now());
  } else {
    typingUsers.delete(username);
  }
  updateTypingIndicator();
});

function updateTypingIndicator() {
  // 清理超过 3 秒的输入状态
  const now = Date.now();
  for (const [name, ts] of typingUsers) {
    if (now - ts > 3000) typingUsers.delete(name);
  }
  const names = Array.from(typingUsers.keys());
  if (names.length === 0) {
    typingIndicator.classList.add('hidden');
  } else {
    typingIndicator.classList.remove('hidden');
    typingIndicator.textContent = `${names.join('、')} 正在输入…`;
  }
}

setInterval(updateTypingIndicator, 1000);

// ===== 连接状态 =====
socket.on('connect', () => {
  connectionStatus.classList.remove('offline');
  connectionStatus.classList.add('online');
});

socket.on('disconnect', () => {
  connectionStatus.classList.remove('online');
  connectionStatus.classList.add('offline');
});

// 心跳保活（Render 建议的 keepalive 实践）
setInterval(() => {
  if (socket.connected) {
    socket.emit('ping');
  }
}, 25000);