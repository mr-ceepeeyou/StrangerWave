
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET to a random secret at least 32 characters long.');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('Set DATABASE_URL to your Neon PostgreSQL connection string.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

const db = {
  users: [],
  blocks: [],
  reports: [],
  friendRequests: [],
  friendships: [],
  privateMessages: []
};

let saveQueue = Promise.resolve();

function ensureArrays(data) {
  data.users ||= [];
  data.blocks ||= [];
  data.reports ||= [];
  data.friendRequests ||= [];
  data.friendships ||= [];
  data.privateMessages ||= [];
  return data;
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS strangerwave_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO strangerwave_state (id, data)
    VALUES (1, $1::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [JSON.stringify(db)]);

  const result = await pool.query(
    'SELECT data FROM strangerwave_state WHERE id = 1'
  );

  if (result.rows.length) {
    Object.assign(db, ensureArrays(result.rows[0].data));
  }

  console.log(
    `Database ready. Loaded ${db.users.length} user account(s).`
  );
}

function saveData() {
  // Take a snapshot now so later changes don't alter this queued save.
  const snapshot = JSON.stringify(db);

  saveQueue = saveQueue
    .then(() => pool.query(`
      INSERT INTO strangerwave_state (id, data, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [snapshot]))
    .catch(error => {
      console.error('Could not save StrangerWave data to PostgreSQL:', error);
    });

  return saveQueue;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    bio: user.bio || '',
    avatar: user.avatar || '🟣',
    interests: Array.isArray(user.interests) ? user.interests.slice(0, 8) : [],
    accent: ['purple', 'pink', 'blue', 'green', 'orange'].includes(user.accent) ? user.accent : 'purple'
  };
}

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function userFromToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return db.users.find(u => u.id === payload.sub) || null;
  } catch {
    return null;
  }
}

function getAuthenticatedUser(req) {
  const token = String(req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '');
  return userFromToken(token);
}

function areFriends(a, b) {
  return db.friendships.some(f =>
    (f.userA === a && f.userB === b) ||
    (f.userA === b && f.userB === a)
  );
}

function isBlocked(a, b) {
  return db.blocks.some(x =>
    (x.ownerId === a && x.blockedId === b) ||
    (x.ownerId === b && x.blockedId === a)
  );
}

const onlineSockets = new Map();
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 1e5
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    res.status(503).json({ ok: false, database: 'disconnected' });
  }
});

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3–20 characters: letters, numbers or underscores.'
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: 'Password must be 8–128 characters.'
      });
    }

    if (db.users.some(u =>
      u.username.toLowerCase() === username.toLowerCase()
    )) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      displayName: username,
      bio: '',
      avatar: '🟣',
      passwordHash: await bcrypt.hash(password, 12),
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    await saveData();

    res.json({ token: tokenFor(user), user: publicUser(user) });
  } catch (error) {
    console.error('Registration failed:', error);
    res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const user = db.users.find(u =>
      u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user || !user.passwordHash ||
        !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    res.json({ token: tokenFor(user), user: publicUser(user) });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

// CURRENT USER
app.get('/api/me', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  res.json({ user: publicUser(user) });
});

// PUBLIC PROFILE
app.get('/api/profile/:username', (req, res) => {
  const viewer = getAuthenticatedUser(req);
  if (!viewer) return res.status(401).json({ error: 'Sign in first.' });

  const username = String(req.params.username || '');
  const target = db.users.find(u =>
    u.username.toLowerCase() === username.toLowerCase()
  );

  if (!target) return res.status(404).json({ error: 'User not found.' });

  res.json({
    profile: {
      ...publicUser(target),
      online: onlineSockets.has(target.id),
      isFriend: areFriends(viewer.id, target.id)
    }
  });
});

// UPDATE PROFILE
app.post('/api/profile', async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const displayName = String(req.body.displayName || '').trim();
  const bio = String(req.body.bio || '').trim();
  const allowedAvatars = [
    '🟣', '🦊', '🐸', '🐼', '🐱', '👾', '👻', '🐺',
    '🌙', '⭐', '🔥', '💜', '🎧'
  ];

  if (displayName.length < 1 || displayName.length > 24) {
    return res.status(400).json({
      error: 'Display name must be between 1 and 24 characters.'
    });
  }

  if (bio.length > 160) {
    return res.status(400).json({
      error: 'Your bio must be 160 characters or fewer.'
    });
  }

  const avatar = String(req.body.avatar || '🟣');
  if (!allowedAvatars.includes(avatar)) {
    return res.status(400).json({ error: 'Choose an available avatar.' });
  }
  const allowedInterests = ['Gaming', 'Music', 'Anime', 'Movies', 'Art', 'Sports', 'Memes', 'Tech', 'Travel', 'Books', 'Fitness', 'Animals'];
  const interests = Array.isArray(req.body.interests) ? [...new Set(req.body.interests.map(x => String(x)))].filter(x => allowedInterests.includes(x)).slice(0, 8) : [];
  const accent = ['purple', 'pink', 'blue', 'green', 'orange'].includes(String(req.body.accent)) ? String(req.body.accent) : 'purple';

  user.displayName = displayName;
  user.bio = bio;
  user.avatar = avatar;
  user.interests = interests;
  user.accent = accent;
  user.profileUpdatedAt = new Date().toISOString();

  await saveData();
  res.json({ user: publicUser(user), message: 'Profile updated.' });
});

// FRIENDS AND REQUESTS
app.get('/api/friends', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const friends = db.friendships
    .filter(f => f.userA === user.id || f.userB === user.id)
    .map(f => {
      const otherId = f.userA === user.id ? f.userB : f.userA;
      const other = db.users.find(u => u.id === otherId);
      return other ? {
        ...publicUser(other),
        online: onlineSockets.has(other.id)
      } : null;
    }).filter(Boolean);

  const incoming = db.friendRequests
    .filter(r => r.toId === user.id)
    .map(r => {
      const sender = db.users.find(u => u.id === r.fromId);
      return sender ? {
        id: r.id, user: publicUser(sender), createdAt: r.createdAt
      } : null;
    }).filter(Boolean);

  const outgoing = db.friendRequests
    .filter(r => r.fromId === user.id)
    .map(r => {
      const receiver = db.users.find(u => u.id === r.toId);
      return receiver ? {
        id: r.id, user: publicUser(receiver), createdAt: r.createdAt
      } : null;
    }).filter(Boolean);

  res.json({ friends, incoming, outgoing });
});

// SEND FRIEND REQUEST
app.post('/api/friends/request', async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const username = String(req.body.username || '').trim();
  const target = db.users.find(u =>
    u.username.toLowerCase() === username.toLowerCase()
  );

  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === user.id) {
    return res.status(400).json({ error: 'You cannot add yourself.' });
  }
  if (areFriends(user.id, target.id)) {
    return res.status(409).json({ error: 'You are already friends.' });
  }
  if (isBlocked(user.id, target.id)) {
    return res.status(403).json({ error: 'You cannot send this request.' });
  }

  const pending = db.friendRequests.some(r =>
    (r.fromId === user.id && r.toId === target.id) ||
    (r.fromId === target.id && r.toId === user.id)
  );

  if (pending) {
    return res.status(409).json({ error: 'A request is already pending.' });
  }

  db.friendRequests.push({
    id: crypto.randomUUID(),
    fromId: user.id,
    toId: target.id,
    createdAt: new Date().toISOString()
  });

  await saveData();
  res.json({ ok: true, message: 'Friend request sent.' });
});

// ACCEPT REQUEST
app.post('/api/friends/accept', async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const requestId = String(req.body.requestId || '');
  const request = db.friendRequests.find(r =>
    r.id === requestId && r.toId === user.id
  );

  if (!request) {
    return res.status(404).json({ error: 'Friend request not found.' });
  }

  if (isBlocked(user.id, request.fromId)) {
    db.friendRequests = db.friendRequests.filter(r => r.id !== request.id);
    await saveData();
    return res.status(403).json({ error: 'This request cannot be accepted.' });
  }

  if (!areFriends(user.id, request.fromId)) {
    db.friendships.push({
      userA: request.fromId,
      userB: request.toId,
      createdAt: new Date().toISOString()
    });
  }

  db.friendRequests = db.friendRequests.filter(r =>
    !(
      (r.fromId === request.fromId && r.toId === request.toId) ||
      (r.fromId === request.toId && r.toId === request.fromId)
    )
  );

  await saveData();
  res.json({ ok: true, message: 'Friend request accepted.' });
});

// DECLINE REQUEST
app.post('/api/friends/decline', async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const requestId = String(req.body.requestId || '');
  const index = db.friendRequests.findIndex(r =>
    r.id === requestId && r.toId === user.id
  );

  if (index === -1) {
    return res.status(404).json({ error: 'Friend request not found.' });
  }

  db.friendRequests.splice(index, 1);
  await saveData();
  res.json({ ok: true, message: 'Friend request declined.' });
});

// REMOVE FRIEND
app.post('/api/friends/remove', async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const friendId = String(req.body.friendId || '');
  const before = db.friendships.length;

  db.friendships = db.friendships.filter(f =>
    !(
      (f.userA === user.id && f.userB === friendId) ||
      (f.userB === user.id && f.userA === friendId)
    )
  );

  if (before === db.friendships.length) {
    return res.status(404).json({ error: 'Friendship not found.' });
  }

  await saveData();
  res.json({ ok: true, message: 'Friend removed.' });
});

// PRIVATE MESSAGE HISTORY
app.get('/api/private/:friendId', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const friendId = String(req.params.friendId || '');

  if (!areFriends(user.id, friendId) || isBlocked(user.id, friendId)) {
    return res.status(403).json({
      error: 'Private messages are only available between unblocked friends.'
    });
  }

  const messages = db.privateMessages
    .filter(m =>
      (m.fromId === user.id && m.toId === friendId) ||
      (m.fromId === friendId && m.toId === user.id)
    )
    .slice(-100);

  res.json({ messages });
});

// REPORT USER
app.post('/api/report', async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });

  const targetId = String(req.body.targetId || '');
  const reason = String(req.body.reason || 'Other').slice(0, 200);

  if (!targetId || targetId === user.id) {
    return res.status(400).json({ error: 'Invalid report.' });
  }

  db.reports.push({
    id: crypto.randomUUID(),
    reporterId: user.id,
    targetId,
    reason,
    createdAt: new Date().toISOString()
  });

  await saveData();
  res.json({ ok: true });
});

// RANDOM CHAT
const waiting = [];
const active = new Map();
const socketByUser = new Map();

function leaveChat(socket, tellPeer = true) {
  const session = active.get(socket.id);
  if (!session) return;

  active.delete(socket.id);
  socket.leave(session.room);

  const peer = io.sockets.sockets.get(session.peerId);
  if (peer) {
    active.delete(peer.id);
    peer.leave(session.room);
    if (tellPeer) {
      peer.emit('chat:ended', { reason: 'Your partner left the chat.' });
    }
  }
}

function removeFromQueue(socketId) {
  const index = waiting.findIndex(x => x.socketId === socketId);
  if (index >= 0) waiting.splice(index, 1);
}

function findPartner(socket, user) {
  removeFromQueue(socket.id);
  if (active.has(socket.id)) leaveChat(socket, true);

  let candidateIndex = -1;

  for (let i = 0; i < waiting.length; i++) {
    const candidate = waiting[i];
    const candidateSocket = io.sockets.sockets.get(candidate.socketId);

    if (
      !candidateSocket ||
      !candidateSocket.connected ||
      candidate.userId === user.id ||
      candidate.mode !== (socket.data.chatMode || 'text') ||
      isBlocked(candidate.userId, user.id)
    ) continue;

    candidateIndex = i;
    break;
  }

  if (candidateIndex < 0) {
    waiting.push({ socketId: socket.id, userId: user.id, mode: socket.data.chatMode || 'text', since: Date.now() });
    socket.emit('match:waiting');
    return;
  }

  const candidate = waiting.splice(candidateIndex, 1)[0];
  const peer = io.sockets.sockets.get(candidate.socketId);

  if (!peer) {
    waiting.push({ socketId: socket.id, userId: user.id, mode: socket.data.chatMode || 'text', since: Date.now() });
    socket.emit('match:waiting');
    return;
  }

  const room = crypto.randomUUID();
  socket.join(room);
  peer.join(room);

  active.set(socket.id, { peerId: peer.id, room, userId: user.id, mode: socket.data.chatMode || 'text' });
  active.set(peer.id, { peerId: socket.id, room, userId: candidate.userId, mode: candidate.mode || 'text' });

  const otherUser = db.users.find(u => u.id === candidate.userId);
  const currentUser = db.users.find(u => u.id === user.id);

  socket.emit('match:found', {
    partner: otherUser ? publicUser(otherUser) : { id: '', username: 'Stranger' },
    videoMode: (socket.data.chatMode || 'text') === 'video',
    isInitiator: socket.id.localeCompare(peer.id) < 0
  });

  peer.emit('match:found', {
    partner: currentUser ? publicUser(currentUser) : { id: '', username: 'Stranger' },
    videoMode: (peer.data.chatMode || 'text') === 'video',
    isInitiator: peer.id.localeCompare(socket.id) < 0
  });
}

// SOCKET AUTHENTICATION
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const user = userFromToken(String(token || ''));

  if (!user) return next(new Error('Please sign in again.'));
  socket.user = publicUser(user);
  next();
});

io.on('connection', socket => {
  socketByUser.set(socket.user.id, socket.id);
  onlineSockets.set(socket.user.id, socket.id);
  io.emit('presence:update', { userId: socket.user.id, online: true });
  socket.emit('server:ready');

  socket.on('match:find', options => {
    if (active.has(socket.id)) leaveChat(socket, true);
    socket.data.chatMode = options && options.mode === 'video' ? 'video' : 'text';
    findPartner(socket, socket.user);
  });

  // WebRTC signaling is relayed only to the currently matched video-chat partner.
  socket.on('video:offer', data => {
    const session = active.get(socket.id);
    if (!session || session.mode !== 'video' || !data || typeof data.sdp !== 'object') return;
    const peer = io.sockets.sockets.get(session.peerId);
    if (peer) peer.emit('video:offer', { sdp: data.sdp });
  });

  socket.on('video:answer', data => {
    const session = active.get(socket.id);
    if (!session || session.mode !== 'video' || !data || typeof data.sdp !== 'object') return;
    const peer = io.sockets.sockets.get(session.peerId);
    if (peer) peer.emit('video:answer', { sdp: data.sdp });
  });

  socket.on('video:ice-candidate', data => {
    const session = active.get(socket.id);
    if (!session || session.mode !== 'video' || !data || typeof data.candidate !== 'object') return;
    const peer = io.sockets.sockets.get(session.peerId);
    if (peer) peer.emit('video:ice-candidate', { candidate: data.candidate });
  });

  socket.on('chat:message', raw => {
    const session = active.get(socket.id);
    if (!session || !raw || typeof raw.text !== 'string') return;

    const text = raw.text.trim().slice(0, 1000);
    if (!text) return;

    const message = {
      id: crypto.randomUUID(),
      text,
      username: socket.user.username,
      sentAt: new Date().toISOString()
    };

    socket.emit('chat:message', message);
    const peer = io.sockets.sockets.get(session.peerId);
    if (peer) peer.emit('chat:message', message);
  });

  socket.on('chat:typing', value => {
    const session = active.get(socket.id);
    if (!session) return;
    const peer = io.sockets.sockets.get(session.peerId);
    if (peer) peer.emit('chat:typing', { typing: Boolean(value) });
  });

  socket.on('chat:next', () => {
    leaveChat(socket, true);
    findPartner(socket, socket.user);
  });

  socket.on('chat:leave', () => {
    removeFromQueue(socket.id);
    leaveChat(socket, true);
    socket.emit('chat:idle');
  });

  socket.on('chat:block', async targetUsername => {
    const session = active.get(socket.id);
    if (!session) return;

    const target = db.users.find(u =>
      u.username.toLowerCase() === String(targetUsername).toLowerCase()
    );

    if (target && target.id !== socket.user.id &&
        !isBlocked(socket.user.id, target.id)) {
      db.blocks.push({
        ownerId: socket.user.id,
        blockedId: target.id,
        createdAt: new Date().toISOString()
      });

      db.friendRequests = db.friendRequests.filter(r =>
        !(
          (r.fromId === socket.user.id && r.toId === target.id) ||
          (r.fromId === target.id && r.toId === socket.user.id)
        )
      );

      db.friendships = db.friendships.filter(f =>
        !(
          (f.userA === socket.user.id && f.userB === target.id) ||
          (f.userA === target.id && f.userB === socket.user.id)
        )
      );

      await saveData();
    }

    leaveChat(socket, true);
    socket.emit('chat:idle');
  });

  // PRIVATE MESSAGE
  socket.on('private:message', async raw => {
    if (!raw || typeof raw.toId !== 'string' || typeof raw.text !== 'string') return;

    const toId = raw.toId;
    const text = raw.text.trim().slice(0, 1000);
    if (!text || toId === socket.user.id) return;

    if (!areFriends(socket.user.id, toId) || isBlocked(socket.user.id, toId)) {
      socket.emit('private:error', {
        error: 'You can only message an unblocked friend.'
      });
      return;
    }

    const target = db.users.find(u => u.id === toId);
    if (!target) return;

    const message = {
      id: crypto.randomUUID(),
      fromId: socket.user.id,
      toId,
      fromUsername: socket.user.username,
      toUsername: target.username,
      text,
      sentAt: new Date().toISOString()
    };

    db.privateMessages.push(message);
    if (db.privateMessages.length > 5000) {
      db.privateMessages.splice(0, db.privateMessages.length - 5000);
    }

    await saveData();
    socket.emit('private:message', message);

    const targetSocketId = onlineSockets.get(toId);
    const targetSocket = targetSocketId && io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.emit('private:message', message);
  });

  socket.on('private:typing', raw => {
    if (!raw || typeof raw.toId !== 'string') return;

    const toId = raw.toId;
    if (!areFriends(socket.user.id, toId) || isBlocked(socket.user.id, toId)) return;

    const targetSocketId = onlineSockets.get(toId);
    const targetSocket = targetSocketId && io.sockets.sockets.get(targetSocketId);

    if (targetSocket) {
      targetSocket.emit('private:typing', {
        fromId: socket.user.id,
        typing: Boolean(raw.typing)
      });
    }
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    leaveChat(socket, true);

    if (socketByUser.get(socket.user.id) === socket.id) {
      socketByUser.delete(socket.user.id);
    }

    if (onlineSockets.get(socket.user.id) === socket.id) {
      onlineSockets.delete(socket.user.id);
      io.emit('presence:update', { userId: socket.user.id, online: false });
    }
  });
});

async function startServer() {
  try {
    await initializeDatabase();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`StrangerWave running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Could not start StrangerWave or connect to PostgreSQL:', error);
    process.exit(1);
  }
}

startServer();
