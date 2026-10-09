(() => {
  const $ = id => document.getElementById(id);
  const state = { mode: 'login', token: localStorage.getItem('sw_token'), user: null, socket: null, partner: null, matched: false, queued: false, toastTimer: null, lastTyping: 0 };
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), 2800); }
  async function api(path, body) {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Something went wrong.'); return data;
  }
  function setMode(mode) { state.mode = mode; $('loginTab').classList.toggle('active', mode === 'login'); $('registerTab').classList.toggle('active', mode === 'register'); $('authTitle').textContent = mode === 'login' ? 'Welcome back' : 'Create your account'; $('authSubtitle').textContent = mode === 'login' ? 'Sign in to find your next conversation.' : 'Choose a username and start meeting people.'; $('authSubmit').innerHTML = mode === 'login' ? 'Sign in <span>→</span>' : 'Create account <span>→</span>'; $('confirmWrap').classList.toggle('hidden', mode !== 'register'); $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password'; $('authError').textContent = ''; }
  $('loginTab').addEventListener('click', () => setMode('login')); $('registerTab').addEventListener('click', () => setMode('register'));
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault(); $('authError').textContent = '';
    const username = $('username').value.trim(), password = $('password').value;
    if (state.mode === 'register' && password !== $('confirmPassword').value) { $('authError').textContent = 'Passwords do not match.'; return; }
    $('authSubmit').disabled = true; $('authSubmit').textContent = state.mode === 'login' ? 'Signing in…' : 'Creating account…';
    try { const data = await api(state.mode === 'login' ? '/api/login' : '/api/register', { username, password }); state.token = data.token; state.user = data.user; localStorage.setItem('sw_token', state.token); showChat(); connectSocket(); }
    catch (err) { $('authError').textContent = err.message; }
    finally { $('authSubmit').disabled = false; $('authSubmit').innerHTML = state.mode === 'login' ? 'Sign in <span>→</span>' : 'Create account <span>→</span>'; }
  });
  function showChat() { $('authView').classList.add('hidden'); $('chatView').classList.remove('hidden'); $('myUsername').textContent = state.user.username; $('myAvatar').textContent = state.user.username.slice(0,1).toUpperCase(); $('topStatus').textContent = `Signed in as ${state.user.username}`; resetChat(); }
  function showAuth() { $('chatView').classList.add('hidden'); $('authView').classList.remove('hidden'); $('topStatus').textContent = 'A world of conversations'; }
  function resetChat() { state.partner = null; state.matched = false; state.queued = false; $('chatTitle').textContent = 'Random chat'; $('chatSubtitle').textContent = 'Find someone new to talk to'; $('welcomePanel').classList.remove('hidden'); $('messages').classList.add('hidden'); $('messages').innerHTML = ''; $('messageForm').classList.add('hidden'); $('typingLine').classList.add('hidden'); $('statusPanel').classList.add('hidden'); $('nextBtn').textContent = 'Find a chat ↗'; $('reportBtn').classList.add('hidden'); $('blockBtn').classList.add('hidden'); }
  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    state.socket = io({ auth: { token: state.token } });
    state.socket.on('connect_error', err => { toast(err.message || 'Connection failed.'); if (/sign in/i.test(err.message)) logout(); });
    state.socket.on('match:waiting', () => { state.queued = true; $('statusTitle').textContent = 'Finding your next chat…'; $('statusText').textContent = 'Hang tight while we find someone available.'; $('statusPanel').classList.remove('hidden'); $('welcomePanel').classList.add('hidden'); });
    state.socket.on('match:found', data => { state.queued = false; state.matched = true; state.partner = data.partner; $('statusPanel').classList.add('hidden'); $('welcomePanel').classList.add('hidden'); $('messages').classList.remove('hidden'); $('messageForm').classList.remove('hidden'); $('chatTitle').textContent = `Chat with ${data.partner.username}`; $('chatSubtitle').textContent = 'You are connected · Say hello'; $('nextBtn').textContent = 'Next person ↗'; $('reportBtn').classList.remove('hidden'); $('blockBtn').classList.remove('hidden'); addSystem(`You are now chatting with ${data.partner.username}. Be respectful and keep personal information private.`); $('messageInput').focus(); });
    state.socket.on('chat:message', msg => addMessage(msg));
    state.socket.on('chat:typing', data => $('typingLine').classList.toggle('hidden', !data.typing));
    state.socket.on('chat:ended', data => { const wasMatched = state.matched; state.matched = false; state.partner = null; $('typingLine').classList.add('hidden'); $('messageForm').classList.add('hidden'); $('reportBtn').classList.add('hidden'); $('blockBtn').classList.add('hidden'); $('chatSubtitle').textContent = 'Conversation ended'; $('nextBtn').textContent = 'Find a chat ↗'; if (wasMatched) addSystem(data.reason || 'Your partner left the chat.'); });
    state.socket.on('chat:idle', () => { state.queued = false; $('statusPanel').classList.add('hidden'); $('welcomePanel').classList.remove('hidden'); $('messages').classList.add('hidden'); $('messageForm').classList.add('hidden'); });
  }
  function scrollMessagesToBottom() { const el = $('messages'); requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; }); }
  function addSystem(text) { const el = document.createElement('div'); el.className = 'system-message'; el.textContent = text; el.style.cssText = 'align-self:center;max-width:85%;text-align:center;color:#8b88a3;font-size:10px;line-height:1.6;padding:10px 14px;background:#171624;border:1px solid #29273b;border-radius:10px;margin:4px 0;'; $('messages').appendChild(el); scrollMessagesToBottom(); }
  function addMessage(msg) { const mine = msg.username === state.user.username; const wrap = document.createElement('div'); wrap.className = `message ${mine ? 'mine' : ''}`; const meta = document.createElement('div'); meta.className = 'message-meta'; const name = document.createElement('span'); name.textContent = mine ? 'You' : msg.username; const time = document.createElement('span'); time.className = 'message-time'; time.textContent = new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); meta.append(name, time); const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.textContent = msg.text; wrap.append(meta, bubble); $('messages').appendChild(wrap); scrollMessagesToBottom(); }
  function findChat() { if (!state.socket || !state.socket.connected) { toast('Connecting… please try again in a moment.'); return; } $('messages').innerHTML = ''; $('messages').classList.remove('hidden'); $('welcomePanel').classList.add('hidden'); $('statusPanel').classList.remove('hidden'); $('statusTitle').textContent = 'Finding your next chat…'; $('statusText').textContent = 'Hang tight while we find someone available.'; state.socket.emit('match:find'); }
  $('startBtn').addEventListener('click', findChat); $('nextBtn').addEventListener('click', findChat); $('cancelBtn').addEventListener('click', () => { if (state.socket) state.socket.emit('chat:leave'); resetChat(); });
  $('messageForm').addEventListener('submit', e => { e.preventDefault(); const text = $('messageInput').value.trim(); if (!text || !state.matched) return; state.socket.emit('chat:message', { text }); $('messageInput').value = ''; state.socket.emit('chat:typing', false); });
  $('messageInput').addEventListener('input', () => { const now = Date.now(); if (now - state.lastTyping > 700 && state.socket) { state.socket.emit('chat:typing', $('messageInput').value.length > 0); state.lastTyping = now; } });
  $('reportBtn').addEventListener('click', async () => { if (!state.partner) return; const reason = prompt('Why are you reporting this user? (Keep it brief)'); if (reason === null) return; try { await api('/api/report', { targetId: state.partner.id || state.partner.username, reason: reason || 'Other' }); toast('Report submitted.'); } catch (e) { toast(e.message); } });
  $('blockBtn').addEventListener('click', () => { if (!state.partner || !confirm(`Block ${state.partner.username} and end this chat?`)) return; state.socket.emit('chat:block', state.partner.username); toast('User blocked.'); });
  function logout() { if (state.socket) state.socket.disconnect(); state.socket = null; state.token = null; state.user = null; localStorage.removeItem('sw_token'); showAuth(); setMode('login'); }
  $('logoutBtn').addEventListener('click', logout);
  async function boot() { if (!state.token) return; try { const data = await api('/api/me'); state.user = data.user; showChat(); connectSocket(); } catch { localStorage.removeItem('sw_token'); state.token = null; } }
  boot();
})();
