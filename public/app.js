const socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 与服务端保持一致

const $ = (id) => document.getElementById(id);

// DOM
const loginPanel = $('login-panel');
const chatPanel = $('chat-panel');
const loginForm = $('login-form');
const loginHint = $('login-hint');
const usernameInput = $('username-input');
const loginError = $('login-error');
const currentUserEl = $('current-user');
const connectionStatus = $('connection-status');
const onlineCount = $('online-count');
const changeNameBtn = $('change-name-btn');
const adminLoginBtn = $('admin-login-btn');
const adminPanelBtn = $('admin-panel-btn');
const messagesEl = $('messages');
const messageForm = $('message-form');
const messageInput = $('message-input');
const typingIndicator = $('typing-indicator');
const muteBanner = $('mute-banner');
const emojiBtn = $('emoji-btn');
const emojiPanel = $('emoji-panel');
const emojiGrid = $('emoji-grid');
const stickerGrid = $('sticker-grid');
const imageBtn = $('image-btn');
const fileBtn = $('file-btn');
const imageInput = $('image-input');
const fileInput = $('file-input');
const uploadStatus = $('upload-status');

// 管理员 DOM
const adminLoginModal = $('admin-login-modal');
const adminTokenInput = $('admin-token-input');
const adminLoginError = $('admin-login-error');
const adminLoginClose = $('admin-login-close');
const adminCancelBtn = $('admin-cancel-btn');
const adminConfirmBtn = $('admin-confirm-btn');
const adminPanelModal = $('admin-panel-modal');
const adminPanelClose = $('admin-panel-close');
const adminUsersList = $('admin-users-list');
const adminBannedList = $('admin-banned-list');
const adminUserCount = $('admin-user-count');
const adminBanCount = $('admin-ban-count');

const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖',
  '😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔',
  '🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴',
  '🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖',
  '🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','🙈','🙉','🙊',
  '👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊',
  '👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟',
  '✨','🌟','⭐','🌠','🔥','💥','💫','🌈','☀️','🌤️','⛅','🌧️','⛈️','❄️','☃️','🌊','🍀','🌸','🌹','🌻',
  '🎉','🎊','🎈','🎁','🎂','🍰','🍕','🍔','🍟','🍿','☕','🍺','🍻','🥂','🚀','✈️','🚗','🚲','⚽','🏀',
  '🎮','🎯','🎲','🎸','🎹','🎤','🎧','📷','💻','📱','💡','🔔','📌','📎','✏️','📝','📚','💯','✅','❌'
];

let currentUser = null;
let pendingUsername = null;
let manualLogin = false;
let historyLoaded = false;   // 首次加载 / 重连 区分
let typingTimeout = null;
let stickers = [];
let typingUsers = new Map();
let isAdmin = false;
let adminAvailable = false;
let kickedByAdmin = false;
let bannedByAdmin = false;
let mutedUntil = 0;
let muteTimer = null;

// ===== 界面切换 =====
function enterChat() {
  loginPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  messageInput.focus();
}

function showLoginForm() {
  chatPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  loginHint.textContent = '输入一个昵称，开始聊天';
  loginError.textContent = '';
  usernameInput.disabled = false;
  loginForm.querySelector('button').disabled = false;
  usernameInput.focus();
}

// 统一管理 header 上的管理员按钮状态
function updateAdminButtons() {
  adminLoginBtn.classList.toggle('hidden', !adminAvailable || isAdmin);
  adminPanelBtn.classList.toggle('hidden', !isAdmin);
}

// ===== 手动登录 =====
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) {
    loginError.textContent = '请输入昵称';
    return;
  }
  manualLogin = true;
  pendingUsername = name;
  loginError.textContent = '';
  socket.emit('join', name);
});

socket.on('join_error', (msg) => {
  manualLogin = false;
  pendingUsername = null;
  if (msg && typeof msg === 'object' && msg.banned) {
    bannedByAdmin = true;
    loginHint.textContent = msg.message;
    usernameInput.disabled = true;
    loginForm.querySelector('button').disabled = true;
    return;
  }
  loginError.textContent = typeof msg === 'string' ? msg : '加入失败';
});

// ===== 自动登录结果 =====
socket.on('auto_login_result', (res) => {
  if (manualLogin || currentUser) return;

  if (res && res.banned) {
    bannedByAdmin = true;
    loginHint.textContent = res.until === Infinity
      ? '你的 IP 已被永久封禁'
      : `你的 IP 已被封禁，解禁时间：${new Date(res.until).toLocaleString()}`;
    usernameInput.disabled = true;
    loginForm.querySelector('button').disabled = true;
    return;
  }

  if (res && res.ok && res.username) {
    currentUser = res.username;
    currentUserEl.textContent = currentUser;
    enterChat();
  } else {
    loginHint.textContent = '输入一个昵称，开始聊天';
  }
});

// ===== 历史消息：首次加载清空，重连只补缺 =====
socket.on('history', (history) => {
  if (!currentUser && pendingUsername) {
    currentUser = pendingUsername;
    currentUserEl.textContent = currentUser;
    enterChat();
  }
  pendingUsername = null;

  if (!historyLoaded) {
    messagesEl.innerHTML = '';
    history.forEach((msg) => appendMessage(msg, false));
    historyLoaded = true;
  } else {
    const existing = new Set(
      [...messagesEl.querySelectorAll('.message[data-msg-id]')]
        .map((el) => el.dataset.msgId)
    );
    history.forEach((msg) => {
      if (!existing.has(msg.id)) appendMessage(msg, false);
    });
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// ===== 换个昵称 =====
changeNameBtn.addEventListener('click', () => {
  if (!confirm('换个昵称会退出当前身份，确定吗？')) return;
  socket.emit('reset_identity');
});

socket.on('reset_ok', () => {
  currentUser = null;
  pendingUsername = null;
  manualLogin = false;
  isAdmin = false;
  historyLoaded = false;
  mutedUntil = 0;
  applyMuteState();
  adminPanelModal.classList.add('hidden');
  adminLoginModal.classList.add('hidden');
  messageInput.value = '';
  usernameInput.value = '';
  showLoginForm();
  updateAdminButtons();   // 恢复 🔑
});

// ===== 表情包 =====
socket.on('stickers', (list) => {
  stickers = list;
  renderStickerGrid();
});

// ===== 消息 =====
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { type: 'text', text });
  messageInput.value = '';
  socket.emit('typing', false);
});

socket.on('chat_message', (msg) => appendMessage(msg, true));

function appendMessage(msg, scroll = true) {
  if (msg.id && messagesEl.querySelector(`.message[data-msg-id="${CSS.escape(msg.id)}"]`)) {
    return; // 去重，防止 history + live 重复
  }
  const div = document.createElement('div');
  if (msg.id) div.dataset.msgId = msg.id;
  const own = msg.username === currentUser;
  div.className = 'message ' + (own ? 'own' : 'other');

  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit'
  });
  meta.textContent = `${msg.username} · ${time}`;
  div.appendChild(meta);

  if (msg.type === 'sticker') {
    const s = document.createElement('div');
    s.className = 'sticker';
    s.textContent = msg.sticker;
    div.appendChild(s);
  } else if (msg.type === 'image') {
    const img = document.createElement('img');
    img.className = 'chat-image';
    img.src = msg.url;
    img.alt = msg.name || '图片';
    img.loading = 'lazy';
    img.addEventListener('click', () => window.open(msg.url, '_blank', 'noopener'));
    img.addEventListener('load', () => {
      if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    div.appendChild(img);
  } else if (msg.type === 'file') {
    div.appendChild(buildFileCard(msg));
  } else {
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = msg.text || '';
    div.appendChild(text);
  }

  messagesEl.appendChild(div);
  if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function buildFileCard(msg) {
  const a = document.createElement('a');
  a.className = 'file-card';
  a.href = msg.url;
  a.download = msg.name;
  a.target = '_blank';
  a.rel = 'noopener';

  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = '📄';

  const info = document.createElement('span');
  info.className = 'file-info';

  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = msg.name;

  const size = document.createElement('span');
  size.className = 'file-size';
  size.textContent = formatSize(msg.size);

  info.appendChild(name);
  info.appendChild(size);
  a.appendChild(icon);
  a.appendChild(info);
  return a;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 0 && n < 10 ? 1 : 0)} ${units[i]}`;
}

function formatRemaining(until) {
  if (until === Infinity || until === null) return '永久';
  const ms = until - Date.now();
  if (ms <= 0) return '即将解除';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (day > 0) return `${day} 天`;
  if (hour > 0) return `${hour} 小时 ${min % 60} 分`;
  if (min > 0) return `${min} 分`;
  return `${sec} 秒`;
}

// ===== 系统消息 / 在线用户 =====
socket.on('system', (text) => {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

socket.on('online_users', (users) => {
  onlineCount.textContent = `${users.length} 人在线`;
});

// ===== 表情面板 =====
function renderEmojiGrid() {
  const frag = document.createDocumentFragment();
  EMOJIS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.addEventListener('click', () => insertAtCursor(messageInput, emoji));
    frag.appendChild(btn);
  });
  emojiGrid.appendChild(frag);
}

function renderStickerGrid() {
  stickerGrid.innerHTML = '';
  stickers.forEach((sticker) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = sticker;
    btn.title = '发送表情';
    btn.addEventListener('click', () => {
      if (!currentUser) return;
      socket.emit('chat_message', { type: 'sticker', sticker });
    });
    stickerGrid.appendChild(btn);
  });
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

emojiBtn.addEventListener('click', () => emojiPanel.classList.toggle('hidden'));

document.querySelectorAll('.emoji-tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.emoji-tabs .tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
    });
    const isEmoji = tab.dataset.tab === 'emoji';
    emojiGrid.classList.toggle('hidden', !isEmoji);
    stickerGrid.classList.toggle('hidden', isEmoji);
  });
});

document.addEventListener('click', (e) => {
  if (emojiPanel.classList.contains('hidden')) return;
  if (emojiPanel.contains(e.target) || emojiBtn.contains(e.target)) return;
  emojiPanel.classList.add('hidden');
});

// ===== 上传 =====
imageBtn.addEventListener('click', () => imageInput.click());
fileBtn.addEventListener('click', () => fileInput.click());
imageInput.addEventListener('change', () => {
  const f = imageInput.files[0];
  if (f) handleUpload(f);
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (f) handleUpload(f);
});

async function handleUpload(file) {
  if (!currentUser) { alert('请先加入聊天'); return; }
  if (file.size > MAX_FILE_SIZE) {
    alert(`文件不能超过 ${MAX_FILE_SIZE / 1024 / 1024} MB`);
    imageInput.value = '';
    fileInput.value = '';
    return;
  }

  setUploadStatus(`正在上传 ${file.name} …`);
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上传失败 (${res.status})`);
    socket.emit('chat_message', {
      type: data.kind, url: data.url, name: data.name, size: data.size, mime: data.mime
    });
  } catch (err) {
    alert(err.message);
  } finally {
    setUploadStatus(null);
    imageInput.value = '';
    fileInput.value = '';
  }
}

function setUploadStatus(text) {
  if (!text) {
    uploadStatus.classList.add('hidden');
    uploadStatus.textContent = '';
  } else {
    uploadStatus.classList.remove('hidden');
    uploadStatus.textContent = text;
  }
}

// ===== 输入状态 =====
messageInput.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1500);
});

socket.on('typing', ({ username, isTyping }) => {
  if (username === currentUser) return;
  if (isTyping) typingUsers.set(username, Date.now());
  else typingUsers.delete(username);
  updateTypingIndicator();
});

function updateTypingIndicator() {
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

// ===== 禁言状态 =====
function applyMuteState() {
  clearTimeout(muteTimer);
  if (!mutedUntil) {
    muteBanner.classList.add('hidden');
    messageInput.disabled = false;
    messageInput.placeholder = '输入消息...';
    return;
  }
  messageInput.disabled = true;
  muteBanner.classList.remove('hidden');
  if (mutedUntil === Infinity) {
    muteBanner.textContent = '你已被永久禁言';
    messageInput.placeholder = '你已被永久禁言';
    return;
  }
  const remaining = mutedUntil - Date.now();
  if (remaining <= 0) {
    mutedUntil = 0;
    applyMuteState();
    return;
  }
  muteBanner.textContent = `你已被禁言，剩余 ${formatRemaining(mutedUntil)}`;
  messageInput.placeholder = '你已被禁言';
  muteTimer = setTimeout(() => {
    mutedUntil = 0;
    applyMuteState();
  }, remaining);
}

socket.on('you_are_muted', ({ until }) => {
  mutedUntil = until;
  applyMuteState();
});

socket.on('you_are_unmuted', () => {
  mutedUntil = 0;
  applyMuteState();
});

// ===== 被踢 / 被封 =====
socket.on('kicked', ({ reason }) => {
  kickedByAdmin = true;
  currentUser = null;
  pendingUsername = null;
  manualLogin = false;
  isAdmin = false;
  historyLoaded = false;
  socket.disconnect();
  adminPanelModal.classList.add('hidden');
  adminLoginModal.classList.add('hidden');
  chatPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  loginHint.textContent = reason || '你被管理员踢出，可以重新进入';
  loginError.textContent = '';
  updateAdminButtons();
});

socket.on('banned', ({ until }) => {
  bannedByAdmin = true;
  socket.disconnect();
  chatPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  loginHint.textContent = until === Infinity
    ? '你的 IP 已被永久封禁'
    : `你的 IP 已被封禁，解禁时间：${new Date(until).toLocaleString()}`;
  usernameInput.disabled = true;
  loginForm.querySelector('button').disabled = true;
});

// ===== 连接状态 =====
socket.on('connect', () => {
  connectionStatus.classList.remove('offline');
  connectionStatus.classList.add('online');

  if (kickedByAdmin || bannedByAdmin) {
    socket.disconnect();
    return;
  }
  if (currentUser) {
    socket.emit('join', currentUser);
  } else if (!manualLogin) {
    socket.emit('auto_login');
  }
});

socket.on('connect_error', () => {
  connectionStatus.classList.remove('online');
  connectionStatus.classList.add('offline');
  loginHint.textContent = '无法连接服务器，请稍后重试';
});

socket.on('disconnect', () => {
  connectionStatus.classList.remove('online');
  connectionStatus.classList.add('offline');
});

// ===== 管理员登录 =====
socket.on('admin_available', (available) => {
  adminAvailable = available;
  updateAdminButtons();
});

adminLoginBtn.addEventListener('click', () => {
  if (!currentUser) {
    alert('请先加入聊天');
    return;
  }
  adminTokenInput.value = '';
  adminLoginError.textContent = '';
  adminLoginModal.classList.remove('hidden');
  adminTokenInput.focus();
});

function closeAdminLogin() {
  adminLoginModal.classList.add('hidden');
}

adminLoginClose.addEventListener('click', closeAdminLogin);
adminCancelBtn.addEventListener('click', closeAdminLogin);
adminConfirmBtn.addEventListener('click', () => {
  const token = adminTokenInput.value.trim();
  if (!token) {
    adminLoginError.textContent = '请输入密码';
    return;
  }
  socket.emit('admin_login', token);
});
adminTokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    adminConfirmBtn.click();
  }
});

socket.on('admin_login_result', (res) => {
  if (res.ok) {
    isAdmin = true;
    closeAdminLogin();
    updateAdminButtons();
  } else {
    adminLoginError.textContent = res.error || '登录失败';
  }
});

socket.on('admin_error', (msg) => {
  alert(msg);
});

// ===== 管理面板 =====
adminPanelBtn.addEventListener('click', () => {
  adminPanelModal.classList.remove('hidden');
});
adminPanelClose.addEventListener('click', () => {
  adminPanelModal.classList.add('hidden');
});
adminPanelModal.addEventListener('click', (e) => {
  if (e.target === adminPanelModal) adminPanelModal.classList.add('hidden');
});

socket.on('admin_users', (data) => {
  renderAdminUsers(data.users || []);
  renderAdminBanned(data.banned || []);
});

function mkBtn(text, onClick, className = '', disabled = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'admin-action-btn' + (className ? ' ' + className : '');
  btn.textContent = text;
  btn.disabled = disabled;
  if (!disabled) btn.addEventListener('click', onClick);
  return btn;
}

function renderAdminUsers(users) {
  adminUsersList.innerHTML = '';
  adminUserCount.textContent = `(${users.length})`;
  if (users.length === 0) {
    adminUsersList.innerHTML = '<div class="admin-empty">暂无在线用户</div>';
    return;
  }

  users.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'admin-user-row';

    const top = document.createElement('div');
    top.className = 'admin-user-top';

    const info = document.createElement('div');
    info.className = 'admin-user-info';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'admin-user-name';
    const nameText = document.createElement('span');
    nameText.textContent = user.username;
    nameWrap.appendChild(nameText);

    if (user.username === currentUser) {
      const b = document.createElement('span');
      b.className = 'badge badge-you';
      b.textContent = '我';
      nameWrap.appendChild(b);
    }
    if (user.isAdmin) {
      const b = document.createElement('span');
      b.className = 'badge badge-admin';
      b.textContent = '管理员';
      nameWrap.appendChild(b);
    }
    if (user.muted) {
      const b = document.createElement('span');
      b.className = 'badge badge-muted';
      b.textContent = user.mutedUntil === Infinity
        ? '永久禁言'
        : `禁言剩 ${formatRemaining(user.mutedUntil)}`;
      nameWrap.appendChild(b);
    }

    const ipEl = document.createElement('div');
    ipEl.className = 'admin-user-ip';
    ipEl.textContent = user.ip || '(未知 IP)';

    info.appendChild(nameWrap);
    info.appendChild(ipEl);

    const actions = document.createElement('div');
    actions.className = 'admin-user-actions';

    const cannotOperate = user.isAdmin || user.username === currentUser;

    if (user.muted) {
      actions.appendChild(mkBtn('解禁', () => unmuteUser(user.username), 'danger', cannotOperate));
    } else {
      actions.appendChild(mkBtn('禁言', () => muteUser(user.username), '', cannotOperate));
    }
    actions.appendChild(mkBtn('踢出', () => kickUser(user.username), '', cannotOperate));
    actions.appendChild(mkBtn('封IP', () => banIp(user.username), 'danger', cannotOperate));

    top.appendChild(info);
    top.appendChild(actions);
    row.appendChild(top);
    adminUsersList.appendChild(row);
  });
}

function renderAdminBanned(banned) {
  adminBannedList.innerHTML = '';
  adminBanCount.textContent = `(${banned.length})`;
  if (banned.length === 0) {
    adminBannedList.innerHTML = '<div class="admin-empty">暂无封禁记录</div>';
    return;
  }
  banned.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'ban-row';

    const info = document.createElement('div');
    const ipEl = document.createElement('div');
    ipEl.className = 'ban-ip';
    ipEl.textContent = item.ip;
    const timeEl = document.createElement('div');
    timeEl.className = 'ban-time';
    timeEl.textContent = item.until === Infinity
      ? '永久封禁'
      : `解封倒计时：${formatRemaining(item.until)}`;
    info.appendChild(ipEl);
    info.appendChild(timeEl);

    row.appendChild(info);
    row.appendChild(mkBtn('解封', () => unbanIp(item.ip), 'danger'));
    adminBannedList.appendChild(row);
  });
}

// ===== 管理操作 =====
function askDuration(defaultValue, unitLabel, label) {
  const input = prompt(
    `${label}\n\n时长（${unitLabel}，0 = 永久，留空使用默认 ${defaultValue} ${unitLabel}）`,
    ''
  );
  if (input === null) return null;
  const trimmed = input.trim();
  if (trimmed === '') return defaultValue;
  const num = parseInt(trimmed, 10);
  if (isNaN(num) || num < 0) {
    alert('请输入有效数字');
    return null;
  }
  return num;
}

function muteUser(username) {
  const minutes = askDuration(10, '分钟', `禁言 ${username}`);
  if (minutes === null) return;
  const duration = minutes === 0 ? 0 : minutes * 60 * 1000;
  socket.emit('admin_mute', { username, duration });
}

function unmuteUser(username) {
  socket.emit('admin_unmute', { username });
}

function kickUser(username) {
  if (!confirm(`确定踢出 ${username}？`)) return;
  socket.emit('admin_kick', { username });
}

function banIp(username) {
  const hours = askDuration(24, '小时', `封禁 ${username} 的 IP`);
  if (hours === null) return;
  const duration = hours === 0 ? 0 : hours * 60 * 60 * 1000;
  if (!confirm(`确定封禁 ${username} 的 IP ${hours === 0 ? '（永久）' : `${hours} 小时`}？`)) return;
  socket.emit('admin_ban_ip', { username, duration });
}

function unbanIp(ip) {
  if (!confirm(`确定解封 ${ip}？`)) return;
  socket.emit('admin_unban_ip', { ip });
}

// 初始化
renderEmojiGrid();
updateAdminButtons();
