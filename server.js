const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Render 会自动注入 PORT，本地默认 3000
const PORT = process.env.PORT || 3000;

// 如果你有自定义域名或前端单独部署，把前端 URL 加到环境变量 ALLOWED_ORIGINS，
// 多个用逗号分隔。留空则允许所有来源（适合前后端同源部署的简单场景）。
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : '*';

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  },
  // 同时允许 websocket 和 polling，兼容性更好
  transports: ['websocket', 'polling']
});

// 托管前端静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 内存消息记录，保留最近 100 条（重启后丢失，适合演示）
const messageHistory = [];
const MAX_HISTORY = 100;

// 在线用户：socket.id -> username
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // 用户加入聊天
  socket.on('join', (username) => {
    if (!username || typeof username !== 'string') return;
    const name = username.trim().slice(0, 20);
    if (!name) return;

    // 防止重名（简单处理）
    const exists = Array.from(onlineUsers.values()).includes(name);
    if (exists) {
      socket.emit('join_error', '该用户名已被使用，请换一个');
      return;
    }

    onlineUsers.set(socket.id, name);
    socket.username = name;

    // 发送历史消息
    socket.emit('history', messageHistory);

    // 广播系统消息：新用户加入
    io.emit('system', `${name} 加入了聊天`);
    io.emit('online_users', Array.from(onlineUsers.values()));
  });

  // 收到消息
  socket.on('chat_message', (text) => {
    const username = onlineUsers.get(socket.id);
    if (!username) {
      socket.emit('error_msg', '请先加入聊天');
      return;
    }
    if (!text || typeof text !== 'string') return;
    const content = text.trim().slice(0, 1000);
    if (!content) return;

    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username,
      text: content,
      timestamp: Date.now()
    };

    messageHistory.push(msg);
    if (messageHistory.length > MAX_HISTORY) {
      messageHistory.shift();
    }

    io.emit('chat_message', msg);
  });

  // 正在输入
  socket.on('typing', (isTyping) => {
    const username = onlineUsers.get(socket.id);
    if (!username) return;
    socket.broadcast.emit('typing', { username, isTyping });
  });

  // 断开连接
  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    if (username) {
      onlineUsers.delete(socket.id);
      io.emit('system', `${username} 离开了聊天`);
      io.emit('online_users', Array.from(onlineUsers.values()));
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

// 关键：Render 要求监听 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat server listening on 0.0.0.0:${PORT}`);
});