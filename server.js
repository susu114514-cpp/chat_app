const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
app.set('trust proxy', true); // Render 反向代理后取真实 IP

const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''; // 未设置则禁用管理员功能
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_HISTORY = 100;
const MAX_TEXT = 1000;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : '*';

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6
});

// ===== 上传 =====
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif'
};
const DANGEROUS_EXT = ['.exe', '.bat', '.cmd', '.sh', '.js', '.mjs', '.html', '.htm', '.svg', '.php', '.jar'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      let ext = path.extname(file.originalname).toLowerCase();
      if (!/^\.[a-z0-9]{1,10}$/.test(ext)) ext = '';
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (DANGEROUS_EXT.includes(ext)) return cb(new Error('不允许上传该类型的文件'));
    cb(null, true);
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到文件' });
  const ext = path.extname(req.file.filename).toLowerCase();
  const isImage = !!IMAGE_MIME[ext];
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname.slice(0, 100),
    size: req.file.size,
    mime: req.file.mimetype,
    kind: isImage ? 'image' : 'file'
  });
});

app.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename) return res.status(400).end();
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  const ext = path.extname(filename).toLowerCase();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (IMAGE_MIME[ext]) {
    res.setHeader('Content-Type', IMAGE_MIME[ext]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
  }
  res.sendFile(filePath);
});

app.use(express.static(path.join(__dirname, 'public')));

// ===== 状态 =====
const messageHistory = [];
const onlineUsers = new Map();       // socketId -> { username, ip }
const ipUserMap = new Map();         // ip -> username
const mutedUsers = new Map();        // username -> expiresAt (Infinity = 永久)
const bannedIps = new Map();         // ip -> expiresAt (Infinity = 永久)

const STICKERS = [
  '😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😴',
  '😭','😡','🥳','🤯','😱','👍','👎','👏','🙏','💪',
  '❤️','💔','🔥','🎉','💯','✨','🌈','🚀','🍕','☕',
  '🐶','🐱','🦄','👻','🎃','🌸','⭐','💡','🍀','🎁'
];
const STICKER_SET = new Set(STICKERS);

// ===== 工具 =====
function getClientIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return socket.handshake.address || '';
}

function isNameTakenByOtherIp(name, ip) {
  for (const u of onlineUsers.values()) {
    if (u.username === name && u.ip !== ip) return true;
  }
  return false;
}

function isUserOnline(username) {
  for (const info of onlineUsers.values()) {
    if (info.username === username) return true;
  }
  return false;
}

function isMuted(username) {
  const exp = mutedUsers.get(username);
  if (exp === undefined) return false;
  if (exp !== Infinity && exp < Date.now()) {
    mutedUsers.delete(username);
    return false;
  }
  return true;
}

function isBanned(ip) {
  const exp = bannedIps.get(ip);
  if (exp === undefined) return false;
  if (exp !== Infinity && exp < Date.now()) {
    bannedIps.delete(ip);
    return false;
  }
  return true;
}

// ===== 广播 =====
function broadcastPresence() {
  // 在线用户名（去重）
  const names = [...new Set([...onlineUsers.values()].map(u => u.username))];
  io.emit('online_users', names);

  // 管理员额外数据（去重按用户名，多标签页只显示一次）
  const userMap = new Map();
  for (const [sid, info] of onlineUsers) {
    if (userMap.has(info.username)) continue;
    const s = io.sockets.sockets.get(sid);
    userMap.set(info.username, {
      username: info.username,
      ip: info.ip,
      isAdmin: s ? s.isAdmin === true : false,
      muted: isMuted(info.username),
      mutedUntil: mutedUsers.has(info.username) ? mutedUsers.get(info.username) : 0
    });
  }
  const payload = {
    users: [...userMap.values()],
    banned: [...bannedIps.entries()].map(([ip, until]) => ({ ip, until }))
  };
  for (const [sid] of onlineUsers) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.isAdmin) io.to(sid).emit('admin_users', payload);
  }
}

function joinChat(socket, name, ip) {
  onlineUsers.set(socket.id, { username: name, ip });
  socket.username = name;
  socket.userIp = ip;
  ipUserMap.set(ip, name);
  socket.emit('history', messageHistory);
  io.emit('system', `${name} 加入了聊天`);

  // 若该用户此前被禁言，join 后立即通知（重连/刷新场景）
  if (isMuted(name)) {
    socket.emit('you_are_muted', { until: mutedUsers.get(name) });
  }
  broadcastPresence();
}

// ===== 连接 =====
io.on('connection', (socket) => {
  const ip = getClientIp(socket);
  console.log(`[connect] ${socket.id} ip=${ip}`);
  socket.emit('stickers', STICKERS);
  socket.emit('admin_available', !!ADMIN_TOKEN);

  // 自动登录
  socket.on('auto_login', () => {
    const ip = getClientIp(socket);
    if (!ip || onlineUsers.has(socket.id)) {
      return socket.emit('auto_login_result', { ok: false });
    }
    if (isBanned(ip)) {
      return socket.emit('auto_login_result', {
        ok: false, banned: true, until: bannedIps.get(ip)
      });
    }
    const name = ipUserMap.get(ip);
    if (!name) return socket.emit('auto_login_result', { ok: false });
    if (isNameTakenByOtherIp(name, ip)) {
      return socket.emit('auto_login_result', { ok: false });
    }
    joinChat(socket, name, ip);
    socket.emit('auto_login_result', { ok: true, username: name });
  });

  // 手动加入
  socket.on('join', (username) => {
    const ip = getClientIp(socket);

    if (isBanned(ip)) {
      const until = bannedIps.get(ip);
      return socket.emit('join_error', {
        banned: true, until,
        message: until === Infinity
          ? '你的 IP 已被永久封禁'
          : `你的 IP 已被封禁至 ${new Date(until).toLocaleString()}`
      });
    }

    const name = String(username || '').trim().slice(0, 20);
    if (!name) return;

    if (onlineUsers.has(socket.id) && socket.username === name) {
      socket.emit('history', messageHistory);
      if (isMuted(name)) {
        socket.emit('you_are_muted', { until: mutedUsers.get(name) });
      }
      return;
    }
    if (isNameTakenByOtherIp(name, ip)) {
      return socket.emit('join_error', '该用户名已被使用，请换一个');
    }
    joinChat(socket, name, ip);
  });

  // 换个昵称
  socket.on('reset_identity', () => {
    const ip = socket.userIp || getClientIp(socket);
    if (ip) ipUserMap.delete(ip);
    const info = onlineUsers.get(socket.id);
    if (info) {
      onlineUsers.delete(socket.id);
      socket.broadcast.emit('system', `${info.username} 离开了聊天`);
      broadcastPresence();
    }
    socket.username = null;
    socket.userIp = null;
    socket.emit('reset_ok');
  });

  // ===== 管理员登录 =====
  socket.on('admin_login', (token) => {
    if (!ADMIN_TOKEN) {
      return socket.emit('admin_login_result', { ok: false, error: '服务器未启用管理员功能' });
    }
    if (typeof token !== 'string' || token !== ADMIN_TOKEN) {
      return socket.emit('admin_login_result', { ok: false, error: '管理员密码错误' });
    }
    if (!onlineUsers.has(socket.id)) {
      return socket.emit('admin_login_result', { ok: false, error: '请先加入聊天' });
    }
    socket.isAdmin = true;
    socket.emit('admin_login_result', { ok: true });
    broadcastPresence();
  });

  // ===== 管理员操作 =====
  socket.on('admin_mute', ({ username, duration }) => {
    if (!socket.isAdmin) return;
    if (!isUserOnline(username)) return socket.emit('admin_error', '用户不在线');
    const until = duration === 0 ? Infinity : Date.now() + duration;
    mutedUsers.set(username, until);
    io.emit('system', `${username} 被管理员禁言${until === Infinity ? '（永久）' : ''}`);
    for (const [sid, info] of onlineUsers) {
      if (info.username === username) io.to(sid).emit('you_are_muted', { until });
    }
    broadcastPresence();
  });

  socket.on('admin_unmute', ({ username }) => {
    if (!socket.isAdmin) return;
    if (!mutedUsers.has(username)) return;
    mutedUsers.delete(username);
    io.emit('system', `${username} 被解除禁言`);
    for (const [sid, info] of onlineUsers) {
      if (info.username === username) io.to(sid).emit('you_are_unmuted');
    }
    broadcastPresence();
  });

  socket.on('admin_kick', ({ username }) => {
    if (!socket.isAdmin) return;
    const sids = [];
    for (const [sid, info] of onlineUsers) {
      if (info.username === username) sids.push(sid);
    }
    if (sids.length === 0) return socket.emit('admin_error', '用户不在线');
    io.emit('system', `${username} 被管理员踢出`);
    for (const sid of sids) {
      io.to(sid).emit('kicked', { reason: '被管理员踢出' });
      const s = io.sockets.sockets.get(sid);
      if (s) s.disconnect(true);
    }
    broadcastPresence();
  });

  socket.on('admin_ban_ip', ({ username, duration }) => {
    if (!socket.isAdmin) return;
    const ips = new Set();
    let targetIsAdmin = false;
    for (const [sid, info] of onlineUsers) {
      if (info.username === username) {
        ips.add(info.ip);
        const s = io.sockets.sockets.get(sid);
        if (s && s.isAdmin) targetIsAdmin = true;
      }
    }
    if (ips.size === 0) return socket.emit('admin_error', '用户不在线，无法获取 IP');
    if (targetIsAdmin) return socket.emit('admin_error', '不能封禁管理员');

    const until = duration === 0 ? Infinity : Date.now() + duration;
    for (const ip of ips) bannedIps.set(ip, until);
    io.emit('system', `${username} 及其 IP 被管理员封禁${until === Infinity ? '（永久）' : ''}`);

    // 先收集再断开，避免遍历中被修改
    const toDisconnect = [];
    for (const [sid, info] of onlineUsers) {
      if (ips.has(info.ip)) toDisconnect.push(sid);
    }
    for (const sid of toDisconnect) {
      io.to(sid).emit('banned', { until });
      const s = io.sockets.sockets.get(sid);
      if (s) s.disconnect(true);
    }
    broadcastPresence();
  });

  socket.on('admin_unban_ip', ({ ip }) => {
    if (!socket.isAdmin) return;
    if (!bannedIps.has(ip)) return;
    bannedIps.delete(ip);
    io.emit('system', `IP ${ip} 已被解除封禁`);
    broadcastPresence();
  });

  // ===== 消息 =====
  socket.on('chat_message', (payload) => {
    const info = onlineUsers.get(socket.id);
    if (!info) return;

    // 禁言检查（管理员不受影响）
    if (!socket.isAdmin && isMuted(info.username)) {
      return socket.emit('you_are_muted', { until: mutedUsers.get(info.username) });
    }

    if (typeof payload === 'string') payload = { type: 'text', text: payload };
    if (!payload || typeof payload !== 'object') return;

    const base = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username: info.username,
      timestamp: Date.now()
    };
    let msg;

    switch (payload.type) {
      case 'text': {
        const text = String(payload.text || '').trim().slice(0, MAX_TEXT);
        if (!text) return;
        msg = { ...base, type: 'text', text };
        break;
      }
      case 'sticker': {
        if (!STICKER_SET.has(payload.sticker)) return;
        msg = { ...base, type: 'sticker', sticker: payload.sticker };
        break;
      }
      case 'image':
      case 'file': {
        const url = String(payload.url || '');
        const m = url.match(/^\/uploads\/([A-Za-z0-9._-]{1,100})$/);
        if (!m) return;
        if (!fs.existsSync(path.join(UPLOAD_DIR, m[1]))) return;
        const ext = path.extname(m[1]).toLowerCase();
        const isImage = !!IMAGE_MIME[ext];
        if (payload.type === 'image' && !isImage) return;
        msg = {
          ...base, type: payload.type, url,
          name: String(payload.name || '文件').slice(0, 100),
          size: Number(payload.size) || 0,
          mime: String(payload.mime || '')
        };
        break;
      }
      default: return;
    }

    messageHistory.push(msg);
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
    io.emit('chat_message', msg);
  });

  // 输入状态
  socket.on('typing', (isTyping) => {
    const info = onlineUsers.get(socket.id);
    if (!info) return;
    socket.broadcast.emit('typing', { username: info.username, isTyping });
  });

  // 断开
  socket.on('disconnect', () => {
    const info = onlineUsers.get(socket.id);
    if (info) {
      onlineUsers.delete(socket.id);
      io.emit('system', `${info.username} 离开了聊天`);
      broadcastPresence();
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

// 上传错误处理
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `文件不能超过 ${MAX_FILE_SIZE / 1024 / 1024} MB` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message || '上传失败' });
  next();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat server listening on 0.0.0.0:${PORT}`);
  console.log(`Admin: ${ADMIN_TOKEN ? 'enabled' : 'disabled (set ADMIN_TOKEN to enable)'}`);
});
