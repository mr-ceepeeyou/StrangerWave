
(() => {
  const $ = id => document.getElementById(id);

  const state = {
    mode: 'login',
    token: localStorage.getItem('sw_token'),
    user: null,
    socket: null,
    videoCallActive: false,
    localStream: null,
    peerConnection: null,
    currentChatMode: 'text',
    partner: null,
    matched: false,
    queued: false,
    toastTimer: null,
    lastTyping: 0,
    friends: { friends: [], incoming: [], outgoing: [] },
    friendsPanel: null,
    friendsButton: null,
    socialModal: null,
    privateFriend: null,
    privateTypingTimer: null,
    friendsContent: null
  };

  const AVATARS = ['🟣', '🦊', '🐸', '🐼', '🐱', '👾', '👻', '🐺', '🌙', '⭐', '🔥', '💜', '🎧'];

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function setMode(mode) {
    state.mode = mode;
    $('loginTab').classList.toggle('active', mode === 'login');
    $('registerTab').classList.toggle('active', mode === 'register');
    $('authTitle').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
    $('authSubtitle').textContent = mode === 'login'
      ? 'Sign in to find your next conversation.'
      : 'Choose a username and start meeting people.';
    $('authSubmit').innerHTML = mode === 'login'
      ? 'Sign in <span>→</span>'
      : 'Create account <span>→</span>';
    $('confirmWrap').classList.toggle('hidden', mode !== 'register');
    $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('authError').textContent = '';
  }

  $('loginTab').addEventListener('click', () => setMode('login'));
  $('registerTab').addEventListener('click', () => setMode('register'));

  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('authError').textContent = '';

    const username = $('username').value.trim();
    const password = $('password').value;

    if (state.mode === 'register' && password !== $('confirmPassword').value) {
      $('authError').textContent = 'Passwords do not match.';
      return;
    }

    $('authSubmit').disabled = true;
    $('authSubmit').textContent = state.mode === 'login' ? 'Signing in…' : 'Creating account…';

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
      $('authSubmit').innerHTML = state.mode === 'login'
        ? 'Sign in <span>→</span>'
        : 'Create account <span>→</span>';
    }
  });

  // ---------- PURPLE UI HELPERS ----------

  function style(el, styles) {
    Object.assign(el.style, styles);
    return el;
  }

  function button(text, action, secondary = false) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;

    style(el, {
      border: secondary ? '1px solid #39344f' : '1px solid #8b70ff',
      background: secondary ? '#201d30' : '#7655ed',
      color: '#fff',
      borderRadius: '11px',
      padding: '9px 12px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '700',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent'
    });

    el.addEventListener('click', action);
    return el;
  }

  function field(placeholder, value = '', maxLength = 160) {
    const el = document.createElement('input');
    el.placeholder = placeholder;
    el.value = value;
    el.maxLength = maxLength;

    style(el, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '11px 12px',
      color: '#fff',
      background: '#191725',
      border: '1px solid #39344f',
      borderRadius: '11px',
      outline: 'none',
      font: 'inherit',
      fontSize: '16px'
    });

    return el;
  }

  function textArea(placeholder, value = '', maxLength = 160) {
    const el = document.createElement('textarea');
    el.placeholder = placeholder;
    el.value = value;
    el.maxLength = maxLength;
    el.rows = 3;

    style(el, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '11px 12px',
      color: '#fff',
      background: '#191725',
      border: '1px solid #39344f',
      borderRadius: '11px',
      resize: 'vertical',
      font: 'inherit',
      fontSize: '16px'
    });

    return el;
  }

  function section(title) {
    const wrap = document.createElement('section');

    style(wrap, {
      marginTop: '18px',
      paddingTop: '14px',
      borderTop: '1px solid #29273b'
    });

    const heading = document.createElement('div');
    heading.textContent = title;

    style(heading, {
      color: '#b8afd9',
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '1px',
      textTransform: 'uppercase',
      marginBottom: '10px'
    });

    wrap.appendChild(heading);
    return wrap;
  }

  function userRow(user, actions = []) {
    const row = document.createElement('div');

    style(row, {
      display: 'flex',
      alignItems: 'center',
      gap: '9px',
      padding: '10px',
      marginBottom: '8px',
      borderRadius: '13px',
      background: '#191725',
      border: '1px solid #29273b',
      flexWrap: 'wrap'
    });

    const avatar = document.createElement('div');
    avatar.textContent = user.avatar || (user.username || '?').slice(0, 1).toUpperCase();

    style(avatar, {
      width: '38px',
      height: '38px',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#30264f',
      fontSize: '20px',
      flexShrink: '0'
    });

    const info = document.createElement('div');
    style(info, { flex: '1', minWidth: '80px' });

    const name = document.createElement('div');
    name.textContent = user.displayName || user.username;

    style(name, {
      color: '#f2f0ff',
      fontSize: '13px',
      fontWeight: '700',
      overflowWrap: 'anywhere'
    });

    const sub = document.createElement('div');
    sub.textContent = user.username ? `@${user.username}` : '';

    style(sub, {
      color: '#8d87a7',
      fontSize: '11px',
      marginTop: '3px'
    });

    info.append(name, sub);

    const actionWrap = document.createElement('div');
    style(actionWrap, {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap'
    });

    actions.forEach(a => actionWrap.appendChild(a));
    row.append(avatar, info, actionWrap);

    return row;
  }

  function emptyText(message) {
    const el = document.createElement('div');
    el.textContent = message;

    style(el, {
      color: '#85809e',
      fontSize: '12px',
      padding: '7px 0',
      lineHeight: '1.6'
    });

    return el;
  }

  // ---------- MODAL ----------

  function closeModal() {
    if (state.socialModal) state.socialModal.remove();

    state.socialModal = null;
    state.privateFriend = null;

    clearInterval(state.privateTypingTimer);
    state.privateTypingTimer = null;
  }

  function openModal(titleText, width = 520) {
    closeModal();

    const overlay = document.createElement('div');

    style(overlay, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      background: '#080710e8',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '12px',
      paddingTop: 'max(12px, env(safe-area-inset-top))',
      paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
      boxSizing: 'border-box'
    });

    const panel = document.createElement('div');

    style(panel, {
      width: `min(${width}px, 100%)`,
      maxHeight: 'min(760px, 90dvh)',
      overflow: 'auto',
      boxSizing: 'border-box',
      background: '#11101b',
      color: '#f2f0ff',
      border: '1px solid #39344f',
      borderRadius: '20px',
      padding: '20px',
      boxShadow: '0 25px 90px #000a',
      fontFamily: 'inherit',
      overscrollBehavior: 'contain'
    });

    const header = document.createElement('div');

    style(header, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '18px'
    });

    const title = document.createElement('div');
    title.textContent = titleText;

    style(title, { fontSize: '20px', fontWeight: '800' });

    const close = button('✕', closeModal, true);
    header.append(title, close);
    panel.appendChild(header);
    overlay.appendChild(panel);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });

    document.body.appendChild(overlay);
    state.socialModal = overlay;

    return panel;
  }

  // ---------- PROFILE FEATURES ----------

  async function openMyProfile() {
    let current = state.user;

    try {
      const result = await api(`/api/profile/${encodeURIComponent(state.user.username)}`);
      current = result.profile;
    } catch (err) {
      toast(err.message);
      return;
    }

    const panel = openModal('Edit your profile', 480);

    const label = document.createElement('div');
    label.textContent = 'Avatar';

    style(label, { color: '#aaa5c5', fontSize: '12px', marginBottom: '8px' });
    panel.appendChild(label);

    const avatarRow = document.createElement('div');

    style(avatarRow, {
      display: 'flex',
      gap: '7px',
      flexWrap: 'wrap',
      marginBottom: '18px'
    });

    let selectedAvatar = AVATARS.includes(current.avatar) ? current.avatar : '🟣';
    const avatarButtons = [];

    AVATARS.forEach(avatar => {
      const b = button(avatar, () => {
        selectedAvatar = avatar;

        avatarButtons.forEach(item => {
          item.style.outline = item.textContent === selectedAvatar ? '2px solid #a994ff' : 'none';
        });
      }, true);

      style(b, {
        fontSize: '20px',
        padding: '8px',
        outline: avatar === selectedAvatar ? '2px solid #a994ff' : 'none'
      });

      avatarButtons.push(b);
      avatarRow.appendChild(b);
    });

    panel.appendChild(avatarRow);

    const displayLabel = document.createElement('div');
    displayLabel.textContent = 'Display name';

    style(displayLabel, { color: '#aaa5c5', fontSize: '12px', marginBottom: '7px' });
    panel.appendChild(displayLabel);

    const displayInput = field('Your display name', current.displayName || current.username, 24);
    panel.appendChild(displayInput);

    const bioLabel = document.createElement('div');
    bioLabel.textContent = 'About you (160 characters max)';

    style(bioLabel, { color: '#aaa5c5', fontSize: '12px', margin: '15px 0 7px' });
    panel.appendChild(bioLabel);

    const bioInput = textArea('Tell people a little about yourself…', current.bio || '', 160);
    panel.appendChild(bioInput);

    const photoHeading = document.createElement('div');
    photoHeading.textContent = '✨ Public profile photos';
    style(photoHeading, { color: '#eee8ff', fontWeight: '800', marginTop: '18px', marginBottom: '5px' });
    panel.appendChild(photoHeading);
    const photoHelp = document.createElement('div');
    photoHelp.textContent = 'Add up to 3 photos everyone can see, even before a mutual profile reveal. Only upload photos you are comfortable sharing publicly.';
    style(photoHelp, { color: '#aaa5c5', fontSize: '12px', lineHeight: '1.5', marginBottom: '10px' });
    panel.appendChild(photoHelp);
    let publicPhotos = Array.isArray(current.publicPhotos) ? [...current.publicPhotos] : [];
    const photoPreview = document.createElement('div');
    style(photoPreview, { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' });
    const renderPhotoPreview = () => {
      photoPreview.replaceChildren();
      publicPhotos.forEach((src, index) => {
        const wrap = document.createElement('div');
        style(wrap, { position: 'relative', width: '76px', height: '76px' });
        const img = document.createElement('img'); img.src = src; img.alt = `Public profile photo ${index + 1}`;
        style(img, { width: '76px', height: '76px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #6e49b8' });
        const remove = button('×', () => { publicPhotos.splice(index, 1); renderPhotoPreview(); }, true);
        style(remove, { position: 'absolute', top: '-5px', right: '-5px', padding: '2px 7px', borderRadius: '50%' });
        wrap.append(img, remove); photoPreview.appendChild(wrap);
      });
    };
    renderPhotoPreview(); panel.appendChild(photoPreview);
    const photoInput = document.createElement('input');
    photoInput.type = 'file'; photoInput.accept = 'image/png,image/jpeg,image/webp,image/gif'; photoInput.multiple = true;
    photoInput.setAttribute('aria-label', 'Choose public profile photos');
    style(photoInput, { width: '100%', color: '#c9c1e8', fontSize: '12px', marginBottom: '6px' });
    photoInput.addEventListener('change', async () => {
      for (const file of Array.from(photoInput.files || [])) {
        if (publicPhotos.length >= 3) { toast('You can add up to 3 public photos.'); break; }
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 200 * 1024) { toast('Each photo must be PNG, JPG, WEBP or GIF and under 200 KB.'); continue; }
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        publicPhotos.push(data);
      }
      photoInput.value = ''; renderPhotoPreview();
    });
    panel.appendChild(photoInput);
    const comingSoon = document.createElement('div');
    style(comingSoon, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '14px' });
    ['🖼️ Avatar frames & badges', '🌌 Animated backgrounds'].forEach(labelText => {
      const item = document.createElement('div'); item.textContent = `${labelText} · COMING SOON`;
      style(item, { padding: '11px', border: '1px solid #4d337f', borderRadius: '12px', color: '#b7a1ee', background: 'rgba(125,70,220,.09)', fontSize: '11px', fontWeight: '700', textAlign: 'center' });
      comingSoon.appendChild(item);
    });
    panel.appendChild(comingSoon);

    const save = button('Save profile', async () => {
      try {
        const result = await api('/api/profile', {
          displayName: displayInput.value,
          bio: bioInput.value,
          avatar: selectedAvatar,
          publicPhotos
        });

        state.user = result.user;
        $('myUsername').textContent = state.user.displayName || state.user.username;
        $('myAvatar').textContent = state.user.avatar || state.user.username.slice(0, 1).toUpperCase();

        toast('Profile updated.');
        closeModal();
        await refreshFriends();
      } catch (err) {
        toast(err.message);
      }
    });

    style(save, { width: '100%', marginTop: '16px', padding: '12px' });
    panel.appendChild(save);
  }

  async function openProfile(username) {
    try {
      const result = await api(`/api/profile/${encodeURIComponent(username)}`);
      const profile = result.profile;
      const panel = openModal('Profile', 430);

      const avatar = document.createElement('div');
      avatar.textContent = profile.avatar || '🟣';

      style(avatar, {
        width: '76px',
        height: '76px',
        margin: '0 auto 12px',
        borderRadius: '24px',
        background: '#30264f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '40px'
      });

      const name = document.createElement('div');
      name.textContent = profile.displayName || profile.username;

      style(name, { textAlign: 'center', fontSize: '22px', fontWeight: '800' });

      const handle = document.createElement('div');
      handle.textContent = `@${profile.username}`;

      style(handle, {
        textAlign: 'center',
        color: '#a49bbf',
        fontSize: '12px',
        marginTop: '5px'
      });

      const status = document.createElement('div');
      status.textContent = profile.online ? '● Online' : '○ Offline';

      style(status, {
        textAlign: 'center',
        color: profile.online ? '#76e0a0' : '#8d87a7',
        fontSize: '12px',
        marginTop: '10px'
      });

      const bio = document.createElement('div');
      bio.textContent = profile.bio || 'This user has not added a bio yet.';

      style(bio, {
        textAlign: 'center',
        color: '#c6c0da',
        lineHeight: '1.7',
        margin: '20px 0',
        overflowWrap: 'anywhere'
      });

      panel.append(avatar, name, handle, status, bio);

      if (Array.isArray(profile.publicPhotos) && profile.publicPhotos.length) {
        const photosTitle = document.createElement('div');
        photosTitle.textContent = 'Public photos';
        style(photosTitle, { color: '#eee8ff', fontWeight: '800', marginTop: '16px', marginBottom: '8px' });
        panel.appendChild(photosTitle);
        const photosGrid = document.createElement('div');
        style(photosGrid, { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '7px', marginBottom: '12px' });
        profile.publicPhotos.slice(0, 3).forEach((src, index) => {
          const img = document.createElement('img'); img.src = src; img.alt = `Public photo ${index + 1}`;
          style(img, { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: '10px', border: '1px solid #4d337f' });
          photosGrid.appendChild(img);
        });
        panel.appendChild(photosGrid);
      }

      if (profile.id !== state.user.id) {
        const actions = document.createElement('div');
        style(actions, { display: 'flex', gap: '8px' });

        const reveal = button('✨ Request mutual reveal', async () => {
          try {
            const result = await api('/api/reveal/request', { username: profile.username });
            toast(result.message);
            if (result.mutual) openProfile(profile.username);
          } catch (err) { toast(err.message); }
        });
        style(reveal, { flex: '1 1 100%', marginBottom: '8px' });
        actions.style.flexWrap = 'wrap';
        actions.appendChild(reveal);
        try {
          const revealState = await api(`/api/reveal/${encodeURIComponent(profile.username)}`);
          if (revealState.mutual) {
            const unlocked = document.createElement('div');
            unlocked.textContent = '💜 You both agreed to reveal your profiles.';
            style(unlocked, { width: '100%', color: '#c4b5fd', fontSize: '12px', textAlign: 'center', marginBottom: '8px' });
            actions.appendChild(unlocked);
          } else if (revealState.requested) {
            const pending = document.createElement('div');
            pending.textContent = 'Waiting for them to agree to the reveal…';
            style(pending, { width: '100%', color: '#a49bbf', fontSize: '12px', textAlign: 'center', marginBottom: '8px' });
            actions.appendChild(pending);
          }
        } catch {}
        if (profile.isFriend) {
          const message = button('Message', () => openPrivateChat(profile));
          style(message, { flex: '1' });
          actions.appendChild(message);
        } else {
          const add = button('Add friend', async () => {
            try {
              const result = await api('/api/friends/request', { username: profile.username });
              toast(result.message);
              await refreshFriends();
              closeModal();
            } catch (err) {
              toast(err.message);
            }
          });

          style(add, { flex: '1' });
          actions.appendChild(add);
        }

        panel.appendChild(actions);
      }
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- PRIVATE MESSAGING ----------

  function renderPrivateMessage(list, msg) {
    const mine = msg.fromId === state.user.id;
    const row = document.createElement('div');

    style(row, {
      display: 'flex',
      justifyContent: mine ? 'flex-end' : 'flex-start',
      margin: '8px 0'
    });

    const bubble = document.createElement('div');
    bubble.textContent = msg.text;

    style(bubble, {
      maxWidth: '82%',
      padding: '10px 12px',
      borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
      background: mine ? '#7655ed' : '#242137',
      border: '1px solid ' + (mine ? '#8b70ff' : '#39344f'),
      color: '#fff',
      fontSize: '13px',
      lineHeight: '1.5',
      overflowWrap: 'anywhere'
    });

    const time = document.createElement('div');
    time.textContent = new Date(msg.sentAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    style(time, {
      fontSize: '10px',
      opacity: '.7',
      marginTop: '4px',
      textAlign: mine ? 'right' : 'left'
    });

    const wrap = document.createElement('div');
    wrap.append(bubble, time);
    row.appendChild(wrap);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  async function openPrivateChat(friend) {
    if (!state.socket || !state.socket.connected) {
      toast('Connecting… try again in a moment.');
      return;
    }

    state.privateFriend = friend;

    let history;

    try {
      history = await api(`/api/private/${encodeURIComponent(friend.id)}`);
    } catch (err) {
      state.privateFriend = null;
      toast(err.message);
      return;
    }

    const panel = openModal(`Chat with ${friend.displayName || friend.username}`, 560);
    state.privateFriend = friend;

    const subtitle = document.createElement('div');
    subtitle.textContent = `Private conversation · @${friend.username}`;

    style(subtitle, {
      color: '#938baa',
      fontSize: '12px',
      marginTop: '-10px',
      marginBottom: '12px'
    });

    panel.appendChild(subtitle);

    const list = document.createElement('div');

    style(list, {
      height: 'min(42vh, 340px)',
      minHeight: '180px',
      overflowY: 'auto',
      padding: '10px',
      background: '#0c0b14',
      border: '1px solid #29273b',
      borderRadius: '13px'
    });

    panel.appendChild(list);

    if (!history.messages.length) {
      const empty = emptyText('This is the start of your private conversation. Say hello!');
      empty.style.textAlign = 'center';
      list.appendChild(empty);
    } else {
      history.messages.forEach(msg => renderPrivateMessage(list, msg));
    }

    const typing = document.createElement('div');
    typing.textContent = '';

    style(typing, {
      height: '20px',
      color: '#b9a8ff',
      fontSize: '11px',
      paddingTop: '5px'
    });

    panel.appendChild(typing);

    const form = document.createElement('form');
    style(form, { display: 'flex', gap: '8px', marginTop: '8px' });

    const input = field('Write a private message…', '', 1000);
    const send = button('Send', () => {});
    send.type = 'submit';

    style(send, { flexShrink: '0' });

    form.append(input, send);
    panel.appendChild(form);

    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !state.privateFriend) return;

      state.socket.emit('private:message', {
        toId: state.privateFriend.id,
        text
      });

      input.value = '';
      state.socket.emit('private:typing', {
        toId: friend.id,
        typing: false
      });

      input.focus();
    });

    input.addEventListener('input', () => {
      if (!state.privateFriend || !state.socket) return;

      state.socket.emit('private:typing', {
        toId: state.privateFriend.id,
        typing: input.value.length > 0
      });
    });

    input.focus();
  }

  // ---------- FRIENDS PANEL: MOBILE-FRIENDLY ----------

  function createFriendsInterface() {
    if (state.friendsPanel && state.friendsButton) {
      if (!state.friendsButton.isConnected) document.body.appendChild(state.friendsButton);
      if (!state.friendsPanel.isConnected) document.body.appendChild(state.friendsPanel);
      return;
    }

    const buttonEl = button('♧ Friends', async () => {
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'flex' : 'none';
      buttonEl.setAttribute('aria-expanded', opening ? 'true' : 'false');

      if (opening) await refreshFriends();
    });

    buttonEl.id = 'strangerwave-friends-button';
    buttonEl.setAttribute('aria-label', 'Open friends');
    buttonEl.setAttribute('aria-expanded', 'false');

    style(buttonEl, {
      position: 'fixed',
      right: 'max(14px, env(safe-area-inset-right))',
      bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      visibility: 'visible',
      opacity: '1',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
      border: '1px solid #b5a3ff',
      background: '#7655ed',
      color: '#fff',
      borderRadius: '16px',
      padding: '14px 19px',
      minHeight: '50px',
      minWidth: '112px',
      fontSize: '14px',
      fontWeight: '800',
      cursor: 'pointer',
      boxShadow: '0 8px 30px #0009',
      WebkitTapHighlightColor: 'transparent',
      fontFamily: 'inherit'
    });

    const panel = document.createElement('div');
    panel.id = 'strangerwave-friends-panel';

    style(panel, {
      display: 'none',
      flexDirection: 'column',
      position: 'fixed',
      right: 'max(10px, env(safe-area-inset-right))',
      bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
      zIndex: '2147483646',
      width: 'min(420px, calc(100vw - 20px))',
      maxHeight: 'min(700px, calc(100dvh - 110px))',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      boxSizing: 'border-box',
      padding: '16px',
      background: '#11101b',
      color: '#f2f0ff',
      border: '1px solid #65558f',
      borderRadius: '20px',
      boxShadow: '0 18px 65px #000b',
      fontFamily: 'inherit'
    });

    const header = document.createElement('div');

    style(header, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '14px'
    });

    const titleWrap = document.createElement('div');
    style(titleWrap, { minWidth: '0', flex: '1' });

    const title = document.createElement('div');
    title.textContent = 'Your social space';

    style(title, { fontSize: '19px', fontWeight: '800' });

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Friends, profiles and private chats';

    style(subtitle, {
      fontSize: '11px',
      color: '#918ca9',
      marginTop: '4px'
    });

    titleWrap.append(title, subtitle);

    const headerButtons = document.createElement('div');
    style(headerButtons, { display: 'flex', gap: '6px', flexShrink: '0' });

    headerButtons.append(
      button('Profile', openMyProfile, true),
      button('✕', () => {
        panel.style.display = 'none';
        buttonEl.setAttribute('aria-expanded', 'false');
      }, true)
    );

    header.append(titleWrap, headerButtons);

    const addSection = section('Add someone');
    const addRow = document.createElement('div');

    style(addRow, {
      display: 'flex',
      gap: '8px',
      alignItems: 'stretch'
    });

    const usernameInput = field('Enter username', '', 20);

    const addButton = button('Send', async () => {
      const username = usernameInput.value.trim();
      if (!username) return toast('Enter a username first.');

      try {
        const result = await api('/api/friends/request', { username });
        toast(result.message);
        usernameInput.value = '';
        await refreshFriends();
      } catch (err) {
        toast(err.message);
      }
    });

    style(usernameInput, { minWidth: '0', flex: '1' });
    style(addButton, { flexShrink: '0', minHeight: '44px' });

    addRow.append(usernameInput, addButton);
    addSection.appendChild(addRow);

    usernameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addButton.click();
      }
    });

    const currentChat = button('＋ Add current chat partner', async () => {
      if (!state.partner || !state.matched) {
        return toast('You are not in a chat right now.');
      }

      try {
        const result = await api('/api/friends/request', {
          username: state.partner.username
        });

        toast(result.message);
        await refreshFriends();
      } catch (err) {
        toast(err.message);
      }
    }, true);

    style(currentChat, {
      width: '100%',
      minHeight: '44px',
      marginTop: '9px'
    });

    addSection.appendChild(currentChat);

    const content = document.createElement('div');

    panel.append(header, addSection, content);
    document.body.append(buttonEl, panel);

    state.friendsButton = buttonEl;
    state.friendsPanel = panel;
    state.friendsContent = content;

    // Keep the floating button above normal page content.
    // Re-append it when the chat view is displayed.
    buttonEl.style.setProperty('position', 'fixed', 'important');
    buttonEl.style.setProperty('z-index', '2147483647', 'important');
    buttonEl.style.setProperty('display', 'flex', 'important');
    buttonEl.style.setProperty('visibility', 'visible', 'important');
    buttonEl.style.setProperty('opacity', '1', 'important');
    buttonEl.style.setProperty('pointer-events', 'auto', 'important');

    // On narrow screens, use slightly smaller panel padding.
    const mobileStyle = document.createElement('style');
    mobileStyle.id = 'strangerwave-friends-mobile-style';
    mobileStyle.textContent = `
      #strangerwave-friends-button {
        position: fixed !important;
        right: max(14px, env(safe-area-inset-right)) !important;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      #strangerwave-friends-panel {
        z-index: 2147483646 !important;
      }
      @media (max-width: 480px) {
        #strangerwave-friends-panel {
          right: 10px !important;
          width: calc(100vw - 20px) !important;
          max-height: calc(100dvh - 105px) !important;
          padding: 13px !important;
        }
        #strangerwave-friends-button {
          min-height: 50px !important;
          min-width: 112px !important;
          font-size: 14px !important;
        }
      }
    `;

    if (!document.getElementById(mobileStyle.id)) {
      document.head.appendChild(mobileStyle);
    }
  }

  async function refreshFriends() {
    if (!state.token || !state.user) return;

    try {
      state.friends = await api('/api/friends');
      const chatsNav = document.querySelector('[data-nav="chats"]');
      if (chatsNav) {
        let badge = chatsNav.querySelector('.nav-notification-badge');
        const count = (state.friends.incoming || []).length;
        if (count && !badge) { badge = document.createElement('span'); badge.className = 'nav-notification-badge'; chatsNav.appendChild(badge); }
        if (badge) { badge.textContent = count > 9 ? '9+' : String(count); badge.hidden = !count; }
        chatsNav.setAttribute('aria-label', count ? `Chats, ${count} pending friend request${count === 1 ? '' : 's'}` : 'Chats');
      }
      renderFriends();
    } catch (err) {
      if (/sign in/i.test(err.message)) toast('Please sign in again.');
    }
  }

  async function friendAction(endpoint, body, message) {
    try {
      const result = await api(endpoint, body);
      toast(result.message || message);
      await refreshFriends();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderFriends() {
    if (!state.friendsContent) return;

    const content = state.friendsContent;
    content.replaceChildren();

    const incoming = section(`Incoming requests (${state.friends.incoming.length})`);

    if (!state.friends.incoming.length) {
      incoming.appendChild(emptyText('No incoming requests.'));
    }

    state.friends.incoming.forEach(request => {
      incoming.appendChild(userRow(request.user, [
        button('Accept', () =>
          friendAction('/api/friends/accept', { requestId: request.id }, 'Request accepted.')
        ),
        button('Decline', () =>
          friendAction('/api/friends/decline', { requestId: request.id }, 'Request declined.'),
          true
        )
      ]));
    });

    const outgoing = section(`Sent requests (${state.friends.outgoing.length})`);

    if (!state.friends.outgoing.length) {
      outgoing.appendChild(emptyText('No pending outgoing requests.'));
    }

    state.friends.outgoing.forEach(request => {
      outgoing.appendChild(userRow(request.user, [
        button('Pending', () => {}, true)
      ]));
    });

    const friends = section(`Friends (${state.friends.friends.length})`);

    if (!state.friends.friends.length) {
      friends.appendChild(emptyText('Your friends will appear here when they accept your requests.'));
    }

    state.friends.friends.forEach(friend => {
      const presence = document.createElement('div');
      presence.textContent = friend.online ? '● Online' : '○ Offline';

      style(presence, {
        fontSize: '10px',
        color: friend.online ? '#76e0a0' : '#8d87a7',
        marginTop: '4px'
      });

      const row = userRow(friend, [
        button('Profile', () => openProfile(friend.username), true),
        button('Message', () => openPrivateChat(friend))
      ]);

      row.children[1].appendChild(presence);

      row.appendChild(button('Remove', async () => {
        if (!confirm(`Remove ${friend.username} from your friends?`)) return;

        await friendAction('/api/friends/remove', {
          friendId: friend.id
        }, 'Friend removed.');
      }, true));

      friends.appendChild(row);
    });

    content.append(incoming, outgoing, friends);
  }

  // ---------- MAIN CHAT ----------

  function showChat() {
    $('authView').classList.add('hidden');
    $('chatView').classList.remove('hidden');

    $('myUsername').textContent = state.user.displayName || state.user.username;
    $('myAvatar').textContent = state.user.avatar || state.user.username.slice(0, 1).toUpperCase();
    $('topStatus').textContent = `Signed in as ${state.user.username}`;

    createFriendsInterface();

    // Make sure the floating button is attached to the page after login.
    if (state.friendsButton && !state.friendsButton.isConnected) {
      document.body.appendChild(state.friendsButton);
    }

    if (state.friendsPanel && !state.friendsPanel.isConnected) {
      document.body.appendChild(state.friendsPanel);
    }

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

    closeModal();
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

  function stopVideo() {
    state.videoCallActive = false;
    if (state.peerConnection) {
      state.peerConnection.onicecandidate = null;
      state.peerConnection.ontrack = null;
      state.peerConnection.close();
      state.peerConnection = null;
    }
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }
    if ($('localVideo')) $('localVideo').srcObject = null;
    if ($('remoteVideo')) $('remoteVideo').srcObject = null;
    if ($('videoPanel')) $('videoPanel').classList.add('hidden');
    if ($('videoStatus')) $('videoStatus').textContent = 'Your video will start when you choose video chat.';
  }

  async function startVideoChat() {
    if (!state.socket || !state.socket.connected) {
      toast('Connecting… please try again in a moment.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Video requires HTTPS and a browser that supports camera access.');
      return;
    }
    try {
      stopVideo();
      state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      $('localVideo').srcObject = state.localStream;
      $('videoPanel').classList.remove('hidden');
      $('videoStatus').textContent = 'Camera ready. Finding someone for video chat…';
      state.currentChatMode = 'video';
      findChat('video');
    } catch (error) {
      stopVideo();
      toast(error && error.name === 'NotAllowedError'
        ? 'Camera/microphone permission was denied.'
        : 'Could not start camera. Check your camera and microphone, then try again.');
    }
  }

  async function createVideoPeer(isInitiator) {
    if (!state.localStream || !state.socket) return;
    if (state.peerConnection) state.peerConnection.close();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    state.peerConnection = pc;
    state.videoCallActive = true;
    state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
    pc.ontrack = event => {
      if ($('remoteVideo')) $('remoteVideo').srcObject = event.streams[0];
      if ($('videoStatus')) $('videoStatus').textContent = 'You are connected by video.';
    };
    pc.onicecandidate = event => {
      if (event.candidate && state.socket) {
        state.socket.emit('video:ice-candidate', { candidate: event.candidate });
      }
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.connectionState) && $('videoStatus')) {
        $('videoStatus').textContent = 'Video connection interrupted. You can press Next person to try again.';
      }
    };
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      state.socket.emit('video:offer', { sdp: pc.localDescription });
    }
  }

  function connectSocket() {
    if (state.socket) state.socket.disconnect();

    state.socket = io({ auth: { token: state.token } });

    state.socket.on('connect_error', err => {
      toast(err.message || 'Connection failed.');
      if (/sign in/i.test(err.message)) logout();
    });

    state.socket.on('presence:update', () => refreshFriends());

    state.socket.on('private:error', data => {
      toast(data.error || 'Private message failed.');
    });

    state.socket.on('private:message', msg => {
      const friendId = msg.fromId === state.user.id ? msg.toId : msg.fromId;

      if (state.privateFriend && state.privateFriend.id === friendId && state.socialModal) {
        const panel = state.socialModal.querySelector('div > div');
        const list = panel && panel.querySelector('div[style*="overflow-y: auto"]');

        if (list) {
          const empty = list.querySelector('div');

          if (empty && empty.textContent.includes('start of your private conversation')) {
            list.replaceChildren();
          }

          renderPrivateMessage(list, msg);
        }
      } else if (msg.fromId !== state.user.id) {
        toast(`New private message from ${msg.fromUsername}`);
      }
    });

    state.socket.on('private:typing', data => {
      if (!state.privateFriend || state.privateFriend.id !== data.fromId || !state.socialModal) return;

      const panel = state.socialModal.querySelector('div > div');
      const typing = panel && Array.from(panel.children).find(el =>
        el.textContent === 'Typing…' || el.textContent === ''
      );

      if (typing) typing.textContent = data.typing ? 'Typing…' : '';
    });

    state.socket.on('match:waiting', () => {
      state.queued = true;
      $('statusTitle').textContent = 'Finding your next chat…';
      $('statusText').textContent = 'Hang tight while we find someone available.';
      $('statusPanel').classList.remove('hidden');
      $('welcomePanel').classList.add('hidden');
    });

    state.socket.on('match:found', data => {
      state.queued = false;
      state.matched = true;
      state.partner = data.partner;
      state.currentChatMode = data.videoMode ? 'video' : 'text';
      if (data.videoMode) {
        $('videoPanel').classList.remove('hidden');
        $('videoStatus').textContent = 'Connecting video…';
        createVideoPeer(Boolean(data.isInitiator)).catch(() => {
          $('videoStatus').textContent = 'Could not establish video. Try Next person.';
          toast('Video connection failed.');
        });
      } else {
        stopVideo();
      }

      $('statusPanel').classList.add('hidden');
      $('welcomePanel').classList.add('hidden');
      $('messages').classList.remove('hidden');
      $('messageForm').classList.remove('hidden');
      $('chatTitle').textContent = `Chat with ${data.partner.username}`;
      $('chatSubtitle').textContent = 'You are connected · Say hello';
      $('nextBtn').textContent = 'Next person ↗';
      $('reportBtn').classList.remove('hidden');
      $('blockBtn').classList.remove('hidden');

      addSystem(`You are now chatting with ${data.partner.username}. Be respectful and keep personal information private.`);
      $('messageInput').focus();
    });

    state.socket.on('video:offer', async data => {
      if (!state.localStream || !data || !data.sdp) return;
      try {
        if (!state.peerConnection) await createVideoPeer(false);
        const pc = state.peerConnection;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        state.socket.emit('video:answer', { sdp: pc.localDescription });
      } catch (error) {
        toast('Could not connect video. Try Next person.');
      }
    });

    state.socket.on('video:answer', async data => {
      if (!state.peerConnection || !data || !data.sdp) return;
      try { await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp)); }
      catch (error) { toast('Video connection failed. Try Next person.'); }
    });

    state.socket.on('video:ice-candidate', async data => {
      if (!state.peerConnection || !data || !data.candidate) return;
      try { await state.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); }
      catch (error) { /* A stale candidate can arrive during a fast skip. */ }
    });

    state.socket.on('chat:message', msg => addMessage(msg));
    state.socket.on('chat:typing', data => {
      $('typingLine').classList.toggle('hidden', !data.typing);
    });

    state.socket.on('chat:ended', data => {
      const wasMatched = state.matched;
      state.matched = false;
      state.partner = null;
      stopVideo();
      state.currentChatMode = 'text';

      $('typingLine').classList.add('hidden');
      $('messageForm').classList.add('hidden');
      $('reportBtn').classList.add('hidden');
      $('blockBtn').classList.add('hidden');
      $('chatSubtitle').textContent = 'Conversation ended';
      $('nextBtn').textContent = 'Find a chat ↗';

      if (wasMatched) addSystem(data.reason || 'Your partner left the chat.');
    });

    state.socket.on('chat:idle', () => {
      state.queued = false;
      stopVideo();
      state.currentChatMode = 'text';
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

  function findChat(mode = 'text') {
    if (!state.socket || !state.socket.connected) {
      toast('Connecting… please try again in a moment.');
      return;
    }

    if (mode !== 'video') stopVideo();
    state.currentChatMode = mode;
    $('messages').innerHTML = '';
    $('messages').classList.remove('hidden');
    $('welcomePanel').classList.add('hidden');
    $('statusPanel').classList.remove('hidden');
    $('statusTitle').textContent = 'Finding your next chat…';
    $('statusText').textContent = 'Hang tight while we find someone available.';
    state.socket.emit('match:find', { mode });
  }

  $('startBtn').addEventListener('click', () => findChat('text'));
  $('startVideoBtn').addEventListener('click', startVideoChat);
  $('nextBtn').addEventListener('click', async () => {
    // Mobile-safe skip: leave the current match first, then restart the selected mode.
    const mode = state.currentChatMode === 'video' ? 'video' : 'text';
    const hadCamera = mode === 'video' && Boolean(state.localStream);
    if (state.socket) state.socket.emit('chat:leave');
    state.matched = false;
    state.partner = null;
    if (mode === 'video') {
      if (state.peerConnection) {
        state.peerConnection.onicecandidate = null;
        state.peerConnection.ontrack = null;
        state.peerConnection.close();
        state.peerConnection = null;
      }
      state.videoCallActive = false;
      if (!hadCamera) {
        stopVideo();
        startVideoChat();
        return;
      }
      $('videoPanel').classList.remove('hidden');
      $('remoteVideo').srcObject = null;
      $('videoStatus').textContent = 'Finding your next video match…';
      $('messages').innerHTML = '';
      $('statusPanel').classList.remove('hidden');
      $('statusTitle').textContent = 'Finding your next video chat…';
      $('statusText').textContent = 'Looking for someone new.';
      state.queued = true;
      state.socket.emit('match:find', { mode: 'video' });
    } else {
      findChat('text');
    }
  });

  $('cancelBtn').addEventListener('click', () => {
    stopVideo();
    state.currentChatMode = 'text';
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
      state.socket.emit('chat:typing', $('messageInput').value.length > 0);
      state.lastTyping = now;
    }
  });

  $('reportBtn').addEventListener('click', async () => {
    if (!state.partner) return;

    const reason = prompt('Why are you reporting this user? (Keep it brief)');
    if (reason === null) return;

    try {
      await api('/api/report', {
        targetId: state.partner.id || state.partner.username,
        reason: reason || 'Other'
      });

      toast('Report submitted.');
    } catch (err) {
      toast(err.message);
    }
  });

  $('blockBtn').addEventListener('click', () => {
    if (!state.partner || !confirm(`Block ${state.partner.username} and end this chat?`)) return;

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

  // Bottom navigation: reuse the existing chat, video, friends and profile features.
  const bottomNav = $('bottomNav');
  if (bottomNav) {
    bottomNav.querySelectorAll('[data-nav]').forEach(item => {
      item.addEventListener('click', () => {
        const destination = item.dataset.nav;
        bottomNav.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active', button === item));
        if (destination === 'chats') {
          if (state.friendsButton) state.friendsButton.click();
          else toast('Your chats and friends are loading.');
        } else if (destination === 'video') {
          if (state.currentChatMode !== 'video' || !state.queued) startVideoChat();
        } else if (destination === 'random') {
          if (state.matched && state.currentChatMode === 'text') return;
          findChat('text');
        } else if (destination === 'profile') {
          openMyProfile();
        }
      });
    });
  }

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

  setInterval(() => {
    if (state.token && state.user) refreshFriends();
  }, 30000);

  boot();
})();
