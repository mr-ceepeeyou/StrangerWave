const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET to a random secret at least 32 characters long. See README.md.');
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, 'data.json');
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { users: [], blocks: [], reports: [] }; }
}
let db = loadData();
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function publicUser(user) { return { id: user.id, username: user.username }; }
function tokenFor(user) { return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' }); }
function userFromToken(token) {
  try { const payload = jwt.verify(token, JWT_SECRET); return db.users.find(u => u.id === payload.sub) || null; }
  catch { return null; }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: false }, maxHttpBufferSize: 1e5 });
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–20 characters: letters, numbers or underscores.' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8–128 characters.' });
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is already taken.' });
  const user = { id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
  db.users.push(user); saveData();
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Incorrect username or password.' });
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.get('/api/me', (req, res) => {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = userFromToken(auth);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  res.json({ user: publicUser(user) });
});
app.post('/api/report', (req, res) => {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = userFromToken(auth);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  const targetId = String(req.body.targetId || '');
  const reason = String(req.body.reason || 'Other').slice(0, 200);
  if (!targetId || targetId === user.id) return res.status(400).json({ error: 'Invalid report.' });
  db.reports.push({ id: crypto.randomUUID(), reporterId: user.id, targetId, reason, createdAt: new Date().toISOString() });
  saveData();
  res.json({ ok: true });
});

const waiting = [];
const active = new Map(); // socketId -> { peerId, room, userId }
const socketByUser = new Map();
function isBlocked(a, b) { return db.blocks.some(x => (x.ownerId === a && x.blockedId === b) || (x.ownerId === b && x.blockedId === a)); }
function leaveChat(socket, tellPeer = true) {
  const session = active.get(socket.id);
  if (!session) return;
  active.delete(socket.id);
  socket.leave(session.room);
  const peer = io.sockets.sockets.get(session.peerId);
  if (peer) {
    active.delete(peer.id);
    peer.leave(session.room);
    if (tellPeer) peer.emit('chat:ended', { reason: 'Your partner left the chat.' });
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
    if (!candidateSocket || !candidateSocket.connected || candidate.userId === user.id || isBlocked(candidate.userId, user.id)) continue;
    candidateIndex = i; break;
  }
  if (candidateIndex < 0) {
    waiting.push({ socketId: socket.id, userId: user.id, since: Date.now() });
    socket.emit('match:waiting');
    return;
  }
  const candidate = waiting.splice(candidateIndex, 1)[0];
  const peer = io.sockets.sockets.get(candidate.socketId);
  if (!peer) { waiting.push({ socketId: socket.id, userId: user.id, since: Date.now() }); socket.emit('match:waiting'); return; }
  const room = crypto.randomUUID();
  socket.join(room); peer.join(room);
  active.set(socket.id, { peerId: peer.id, room, userId: user.id });
  active.set(peer.id, { peerId: socket.id, room, userId: candidate.userId });
  const otherUser = db.users.find(u => u.id === candidate.userId);
  const currentUser = db.users.find(u => u.id === user.id);
  socket.emit('match:found', { partner: { id: otherUser ? otherUser.id : '', username: otherUser ? otherUser.username : 'Stranger' } });
  peer.emit('match:found', { partner: { id: currentUser ? currentUser.id : '', username: currentUser ? currentUser.username : 'Stranger' } });
}

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const user = userFromToken(String(token || ''));
  if (!user) return next(new Error('Please sign in again.'));
  socket.user = publicUser(user);
  next();
});
io.on('connection', socket => {
  socketByUser.set(socket.user.id, socket.id);
  socket.emit('server:ready');
  socket.on('match:find', () => {
    if (active.has(socket.id)) leaveChat(socket, true);
    findPartner(socket, socket.user);
  });
  socket.on('chat:message', raw => {
    const session = active.get(socket.id);
    if (!session || !raw || typeof raw.text !== 'string') return;
    const text = raw.text.trim().slice(0, 1000);
    if (!text) return;
    const message = { id: crypto.randomUUID(), text, username: socket.user.username, sentAt: new Date().toISOString() };
    socket.emit('chat:message', message);
    const peer = io.sockets.sockets.get(session.peerId);
    if (peer) peer.emit('chat:message', message);
  });
  socket.on('chat:typing', value => {
    const session = active.get(socket.id); if (!session) return;
    const peer = io.sockets.sockets.get(session.peerId);
    if (peer) peer.emit('chat:typing', { typing: Boolean(value) });
  });
  socket.on('chat:next', () => { leaveChat(socket, true); findPartner(socket, socket.user); });
  socket.on('chat:leave', () => { removeFromQueue(socket.id); leaveChat(socket, true); socket.emit('chat:idle'); });
  socket.on('chat:block', targetUsername => {
    const session = active.get(socket.id); if (!session) return;
    const target = db.users.find(u => u.username === targetUsername);
    if (target && target.id !== socket.user.id && !db.blocks.some(x => x.ownerId === socket.user.id && x.blockedId === target.id)) {
      db.blocks.push({ ownerId: socket.user.id, blockedId: target.id, createdAt: new Date().toISOString() }); saveData();
    }
    leaveChat(socket, true); socket.emit('chat:idle');
  });
  socket.on('disconnect', () => {
    removeFromQueue(socket.id); leaveChat(socket, true);
    if (socketByUser.get(socket.user.id) === socket.id) socketByUser.delete(socket.user.id);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`StrangerWave running at http://localhost:${PORT}`));
