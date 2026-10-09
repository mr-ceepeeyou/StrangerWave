
(() => {
  const $ = id => document.getElementById(id);

  const state = {
    mode: 'login',
    token: localStorage.getItem('sw_token'),
    user: null,
    socket: null,
    partner: null,
    matched: false,
    queued: false,
    toastTimer: null,
    lastTyping: 0,
    friends: { friends: [], incoming: [], outgoing: [] },
    friendsPanel: null,
    friendsButton: null
  };

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(
      () => $('toast').classList.remove('show'),
      2800
    );
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token
          ? { Authorization: `Bearer ${state.token}` }
          : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong.');
    }

    return data;
  }

  function setMode(mode) {
    state.mode = mode;

    $('loginTab').classList.toggle('active', mode === 'login');
    $('registerTab').classList.toggle('active', mode === 'register');

    $('authTitle').textContent =
      mode === 'login' ? 'Welcome back' : 'Create your account';

    $('authSubtitle').textContent =
      mode === 'login'
        ? 'Sign in to find your next conversation.'
        : 'Choose a username and start meeting people.';

    $('authSubmit').innerHTML =
      mode === 'login'
        ? 'Sign in <span>→</span>'
        : 'Create account <span>→</span>';

    $('confirmWrap').classList.toggle('hidden', mode !== 'register');

    $('password').autocomplete =
      mode === 'login' ? 'current-password' : 'new-password';

    $('authError').textContent = '';
  }

  $('loginTab').addEventListener('click', () => setMode('login'));
  $('registerTab').addEventListener('click', () => setMode('register'));

  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('authError').textContent = '';

    const username = $('username').value.trim();
    const password = $('password').value;

    if (
      state.mode === 'register' &&
      password !== $('confirmPassword').value
    ) {
      $('authError').textContent = 'Passwords do not match.';
      return;
    }

    $('authSubmit').disabled = true;
    $('authSubmit').textContent =
      state.mode === 'login' ? 'Signing in…' : 'Creating account…';

    try {
      const data = await api(
        state.mode === 'login' ? '/api/login' : '/api/register',
        { username, password }
      );

      state.token = data.token;
      state.user = data.user;

      localStorage.setItem('sw_token', state.token);

      showChat();
      connectSocket();
      await refreshFriends();
    } catch (err) {
      $('authError').textContent = err.message;
    } finally {
      $('authSubmit').disabled = false;
      $('authSubmit').innerHTML =
        state.mode === 'login'
          ? 'Sign in <span>→</span>'
          : 'Create account <span>→</span>';
    }
  });

  // ---------- FRIENDS INTERFACE ----------

  function styleElement(el, styles) {
    Object.assign(el.style, styles);
    return el;
  }

  function makeButton(text, action, secondary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;

    styleElement(button, {
      border: secondary ? '1px solid #353249' : '1px solid #7655ed',
      background: secondary ? '#201e30' : '#7655ed',
      color: '#fff',
      borderRadius: '10px',
      padding: '9px 12px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '600'
    });

    button.addEventListener('click', action);
    return button;
  }

  function makeSection(title) {
    const section = document.createElement('section');

    styleElement(section, {
      marginTop: '18px',
      paddingTop: '14px',
      borderTop: '1px solid #29273b'
    });

    const heading = document.createElement('div');
    heading.textContent = title;

    styleElement(heading, {
      fontSize: '12px',
      fontWeight: '700',
      color: '#aaa5c5',
      marginBottom: '10px',
      textTransform: 'uppercase',
      letterSpacing: '1px'
    });

    section.appendChild(heading);
    return section;
  }

  function makeUserRow(username, actions = []) {
    const row = document.createElement('div');

    styleElement(row, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px',
      marginBottom: '7px',
      borderRadius: '12px',
      background: '#191725',
      border: '1px solid #29273b',
      flexWrap: 'wrap'
    });

    const avatar = document.createElement('div');
    avatar.textContent = username.slice(0, 1).toUpperCase();

    styleElement(avatar, {
      width: '34px',
      height: '34px',
      borderRadius: '11px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#30264f',
      color: '#c9b9ff',
      fontWeight: '700',
      flexShrink: '0'
    });

    const name = document.createElement('div');
    name.textContent = username;

    styleElement(name, {
      flex: '1',
      minWidth: '80px',
      color: '#f2f0ff',
      fontSize: '13px',
      fontWeight: '600',
      overflowWrap: 'anywhere'
    });

    row.append(avatar, name);

    const actionWrap = document.createElement('div');

    styleElement(actionWrap, {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap'
    });

    for (const item of actions) {
      actionWrap.appendChild(item);
    }

    row.appendChild(actionWrap);
    return row;
  }

  function createFriendsInterface() {
    if (state.friendsPanel) return;

    // Floating friends button.
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '♧ Friends';

    styleElement(button, {
      position: 'fixed',
      right: '22px',
      bottom: '22px',
      zIndex: '9998',
      border: '1px solid #8b70ff',
      background: '#7655ed',
      color: '#fff',
      borderRadius: '14px',
      padding: '13px 18px',
      fontSize: '13px',
      fontWeight: '700',
      cursor: 'pointer',
      boxShadow: '0 8px 30px #0005'
    });

    // Friends panel.
    const panel = document.createElement('div');

    styleElement(panel, {
      display: 'none',
      position: 'fixed',
      right: '22px',
      bottom: '82px',
      zIndex: '9999',
      width: 'min(390px, calc(100vw - 32px))',
      maxHeight: 'min(690px, calc(100vh - 115px))',
      overflowY: 'auto',
      boxSizing: 'border-box',
      padding: '20px',
      background: '#11101b',
      color: '#f2f0ff',
      border: '1px solid #302c45',
      borderRadius: '20px',
      boxShadow: '0 18px 65px #0009',
      fontFamily: 'inherit'
    });

    const header = document.createElement('div');

    styleElement(header, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      marginBottom: '18px'
    });

    const headingWrap = document.createElement('div');

    const title = document.createElement('div');
    title.textContent = 'Your friends';

    styleElement(title, {
      fontSize: '20px',
      fontWeight: '800',
      letterSpacing: '-0.5px'
    });

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Meet people and stay connected';

    styleElement(subtitle, {
      fontSize: '11px',
      color: '#918ca9',
      marginTop: '4px'
    });

    headingWrap.append(title, subtitle);

    const close = makeButton('✕', () => {
      panel.style.display = 'none';
    }, true);

    header.append(headingWrap, close);

    const searchSection = makeSection('Add someone');

    const searchRow = document.createElement('div');

    styleElement(searchRow, {
      display: 'flex',
      gap: '8px'
    });

    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.placeholder = 'Enter their username';
    usernameInput.maxLength = 20;
    usernameInput.autocomplete = 'off';

    styleElement(usernameInput, {
      minWidth: '0',
      flex: '1',
      boxSizing: 'border-box',
      padding: '12px',
      color: '#fff',
      background: '#191725',
      border: '1px solid #353249',
      borderRadius: '10px',
      outline: 'none',
      fontSize: '12px'
    });

    const sendButton = makeButton('Send request', async () => {
      const username = usernameInput.value.trim();

      if (!username) {
        toast('Enter a username first.');
        return;
      }

      sendButton.disabled = true;

      try {
        const result = await api('/api/friends/request', { username });
        toast(result.message || 'Friend request sent.');
        usernameInput.value = '';
        await refreshFriends();
      } catch (err) {
        toast(err.message);
      } finally {
        sendButton.disabled = false;
      }
    });

    usernameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendButton.click();
    });

    searchRow.append(usernameInput, sendButton);
    searchSection.appendChild(searchRow);

    const hint = document.createElement('div');
    hint.textContent =
      'Tip: you can add the person you are chatting with using the button below.';

    styleElement(hint, {
      marginTop: '9px',
      color: '#85809e',
      fontSize: '10px',
      lineHeight: '1.6'
    });

    searchSection.appendChild(hint);

    const currentChatButton = makeButton(
      '＋ Add current chat partner',
      async () => {
        if (!state.partner || !state.matched) {
          toast('You are not in a chat right now.');
          return;
        }

        try {
          const result = await api('/api/friends/request', {
            username: state.partner.username
          });

          toast(result.message || 'Friend request sent.');
          await refreshFriends();
        } catch (err) {
          toast(err.message);
        }
      },
      true
    );

    styleElement(currentChatButton, {
      width: '100%',
      marginTop: '10px'
    });

    searchSection.appendChild(currentChatButton);

    const content = document.createElement('div');

    panel.append(header, searchSection, content);
    document.body.append(button, panel);

    button.addEventListener('click', async () => {
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';

      if (opening) {
        await refreshFriends();
        usernameInput.focus();
      }
    });

    state.friendsButton = button;
    state.friendsPanel = panel;
    state.friendsContent = content;
  }

  async function refreshFriends() {
    if (!state.token || !state.user) return;

    try {
      state.friends = await api('/api/friends');
      renderFriends();
    } catch (err) {
      if (/sign in/i.test(err.message)) {
        toast('Please sign in again.');
      }
    }
  }

  async function friendAction(endpoint, body, successMessage) {
    try {
      const result = await api(endpoint, body);
      toast(result.message || successMessage);
      await refreshFriends();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderFriends() {
    if (!state.friendsContent) return;

    const content = state.friendsContent;
    content.replaceChildren();

    const incomingSection = makeSection(
      `Incoming requests (${state.friends.incoming.length})`
    );

    if (!state.friends.incoming.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No incoming requests right now.';
      empty.style.cssText = 'color:#85809e;font-size:12px;padding:6px 0;';
      incomingSection.appendChild(empty);
    }

    state.friends.incoming.forEach(request => {
      const accept = makeButton('Accept', () =>
        friendAction(
          '/api/friends/accept',
          { requestId: request.id },
          'Friend request accepted.'
        )
      );

      const decline = makeButton('Decline', () =>
        friendAction(
          '/api/friends/decline',
          { requestId: request.id },
          'Request declined.'
        ),
        true
      );

      incomingSection.appendChild(
        makeUserRow(request.user.username, [accept, decline])
      );
    });

    const outgoingSection = makeSection(
      `Sent requests (${state.friends.outgoing.length})`
    );

    if (!state.friends.outgoing.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No pending outgoing requests.';
      empty.style.cssText = 'color:#85809e;font-size:12px;padding:6px 0;';
      outgoingSection.appendChild(empty);
    }

    state.friends.outgoing.forEach(request => {
      const pending = document.createElement('span');
      pending.textContent = 'Pending';

      styleElement(pending, {
        color: '#b9a8ff',
        fontSize: '11px',
        padding: '6px 8px',
        background: '#29213f',
        borderRadius: '8px'
      });

      outgoingSection.appendChild(
        makeUserRow(request.user.username, [pending])
      );
    });

    const friendsSection = makeSection(
      `Friends (${state.friends.friends.length})`
    );

    if (!state.friends.friends.length) {
      const empty = document.createElement('div');
      empty.textContent =
        'Your friends will appear here when they accept your requests.';
      empty.style.cssText =
        'color:#85809e;font-size:12px;padding:6px 0;line-height:1.6;';
      friendsSection.appendChild(empty);
    }

    state.friends.friends.forEach(friend => {
      const remove = makeButton('Remove', async () => {
        if (!confirm(`Remove ${friend.username} from your friends?`)) {
          return;
        }

        await friendAction(
          '/api/friends/remove',
          { friendId: friend.id },
          'Friend removed.'
        );
      }, true);

      friendsSection.appendChild(
        makeUserRow(friend.username, [remove])
      );
    });

    content.append(incomingSection, outgoingSection, friendsSection);
  }

  function showChat() {
    $('authView').classList.add('hidden');
    $('chatView').classList.remove('hidden');

    $('myUsername').textContent = state.user.username;
    $('myAvatar').textContent =
      state.user.username.slice(0, 1).toUpperCase();

    $('topStatus').textContent = `Signed in as ${state.user.username}`;

    createFriendsInterface();
    resetChat();
  }

  function showAuth() {
    $('chatView').classList.add('hidden');
    $('authView').classList.remove('hidden');
    $('topStatus').textContent = 'A world of conversations';

    if (state.friendsButton) state.friendsButton.remove();
    if (state.friendsPanel) state.friendsPanel.remove();

    state.friendsButton = null;
    state.friendsPanel = null;
    state.friendsContent = null;
  }

  function resetChat() {
    state.partner = null;
    state.matched = false;
    state.queued = false;

    $('chatTitle').textContent = 'Random chat';
    $('chatSubtitle').textContent = 'Find someone new to talk to';

    $('welcomePanel').classList.remove('hidden');
    $('messages').classList.add('hidden');
    $('messages').innerHTML = '';
    $('messageForm').classList.add('hidden');
    $('typingLine').classList.add('hidden');
    $('statusPanel').classList.add('hidden');

    $('nextBtn').textContent = 'Find a chat ↗';
    $('reportBtn').classList.add('hidden');
    $('blockBtn').classList.add('hidden');
  }

  // ---------- CHAT SOCKET ----------

  function connectSocket() {
    if (state.socket) state.socket.disconnect();

    state.socket = io({
      auth: { token: state.token }
    });

    state.socket.on('connect_error', err => {
      toast(err.message || 'Connection failed.');

      if (/sign in/i.test(err.message)) logout();
    });

    state.socket.on('match:waiting', () => {
      state.queued = true;

      $('statusTitle').textContent = 'Finding your next chat…';
      $('statusText').textContent =
        'Hang tight while we find someone available.';

      $('statusPanel').classList.remove('hidden');
      $('welcomePanel').classList.add('hidden');
    });

    state.socket.on('match:found', data => {
      state.queued = false;
      state.matched = true;
      state.partner = data.partner;

      $('statusPanel').classList.add('hidden');
      $('welcomePanel').classList.add('hidden');
      $('messages').classList.remove('hidden');
      $('messageForm').classList.remove('hidden');

      $('chatTitle').textContent =
        `Chat with ${data.partner.username}`;

      $('chatSubtitle').textContent = 'You are connected · Say hello';
      $('nextBtn').textContent = 'Next person ↗';

      $('reportBtn').classList.remove('hidden');
      $('blockBtn').classList.remove('hidden');

      addSystem(
        `You are now chatting with ${data.partner.username}. Be respectful and keep personal information private.`
      );

      $('messageInput').focus();
    });

    state.socket.on('chat:message', msg => addMessage(msg));

    state.socket.on('chat:typing', data => {
      $('typingLine').classList.toggle('hidden', !data.typing);
    });

    state.socket.on('chat:ended', data => {
      const wasMatched = state.matched;

      state.matched = false;
      state.partner = null;

      $('typingLine').classList.add('hidden');
      $('messageForm').classList.add('hidden');
      $('reportBtn').classList.add('hidden');
      $('blockBtn').classList.add('hidden');

      $('chatSubtitle').textContent = 'Conversation ended';
      $('nextBtn').textContent = 'Find a chat ↗';

      if (wasMatched) {
        addSystem(data.reason || 'Your partner left the chat.');
      }
    });

    state.socket.on('chat:idle', () => {
      state.queued = false;

      $('statusPanel').classList.add('hidden');
      $('welcomePanel').classList.remove('hidden');
      $('messages').classList.add('hidden');
      $('messageForm').classList.add('hidden');
    });
  }

  function scrollMessagesToBottom() {
    const el = $('messages');

    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  function addSystem(text) {
    const el = document.createElement('div');
    el.className = 'system-message';
    el.textContent = text;

    el.style.cssText =
      'align-self:center;max-width:85%;text-align:center;color:#8b88a3;font-size:10px;line-height:1.6;padding:10px 14px;background:#171624;border:1px solid #29273b;border-radius:10px;margin:4px 0;';

    $('messages').appendChild(el);
    scrollMessagesToBottom();
  }

  function addMessage(msg) {
    const mine = msg.username === state.user.username;

    const wrap = document.createElement('div');
    wrap.className = `message ${mine ? 'mine' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const name = document.createElement('span');
    name.textContent = mine ? 'You' : msg.username;

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Date(msg.sentAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    meta.append(name, time);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = msg.text;

    wrap.append(meta, bubble);
    $('messages').appendChild(wrap);

    scrollMessagesToBottom();
  }

  function findChat() {
    if (!state.socket || !state.socket.connected) {
      toast('Connecting… please try again in a moment.');
      return;
    }

    $('messages').innerHTML = '';
    $('messages').classList.remove('hidden');
    $('welcomePanel').classList.add('hidden');
    $('statusPanel').classList.remove('hidden');

    $('statusTitle').textContent = 'Finding your next chat…';
    $('statusText').textContent =
      'Hang tight while we find someone available.';

    state.socket.emit('match:find');
  }

  $('startBtn').addEventListener('click', findChat);
  $('nextBtn').addEventListener('click', findChat);

  $('cancelBtn').addEventListener('click', () => {
    if (state.socket) state.socket.emit('chat:leave');
    resetChat();
  });

  $('messageForm').addEventListener('submit', e => {
    e.preventDefault();

    const text = $('messageInput').value.trim();

    if (!text || !state.matched) return;

    state.socket.emit('chat:message', { text });
    $('messageInput').value = '';
    state.socket.emit('chat:typing', false);
  });

  $('messageInput').addEventListener('input', () => {
    const now = Date.now();

    if (now - state.lastTyping > 700 && state.socket) {
      state.socket.emit(
        'chat:typing',
        $('messageInput').value.length > 0
      );

      state.lastTyping = now;
    }
  });

  $('reportBtn').addEventListener('click', async () => {
    if (!state.partner) return;

    const reason = prompt(
      'Why are you reporting this user? (Keep it brief)'
    );

    if (reason === null) return;

    try {
      await api('/api/report', {
        targetId: state.partner.id || state.partner.username,
        reason: reason || 'Other'
      });

      toast('Report submitted.');
    } catch (e) {
      toast(e.message);
    }
  });

  $('blockBtn').addEventListener('click', () => {
    if (
      !state.partner ||
      !confirm(`Block ${state.partner.username} and end this chat?`)
    ) {
      return;
    }

    state.socket.emit('chat:block', state.partner.username);
    toast('User blocked.');
  });

  function logout() {
    if (state.socket) state.socket.disconnect();

    state.socket = null;
    state.token = null;
    state.user = null;

    localStorage.removeItem('sw_token');

    showAuth();
    setMode('login');
  }

  $('logoutBtn').addEventListener('click', logout);

  async function boot() {
    if (!state.token) return;

    try {
      const data = await api('/api/me');

      state.user = data.user;

      showChat();
      connectSocket();
      await refreshFriends();
    } catch {
      localStorage.removeItem('sw_token');
      state.token = null;
    }
  }

  // Refresh periodically while signed in so incoming requests appear.
  setInterval(() => {
    if (state.token && state.user) refreshFriends();
  }, 30000);

  boot();
})();
