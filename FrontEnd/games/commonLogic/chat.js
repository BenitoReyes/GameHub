// Unified chat initializer for all games

export async function initChat({ apiKey, userId, token, username, roomId, socket }) {
    let client = null;

    // Try Stream Chat first if bundle + credentials exist
    if (typeof StreamChat !== 'undefined' && apiKey && userId && token) {
        try {
        client = StreamChat.getInstance(apiKey);
        if (client?.user) await client.disconnect();
        await client.connectUser({ id: userId, name: username }, token);

        const channel = client.channel('messaging', roomId, { created_by_id: userId });
        await channel.watch();
        await channel.addMembers([userId]);

        wireStreamChat(channel, username);
        console.log('[chat] Connected via Stream Chat');
        return { type: 'stream', client };
        } catch (err) {
        console.warn('[chat] Stream Chat failed, falling back to socket:', err);
        client = null;
        }
    }

    // Fallback: socket.io chat
    wireSocketChat(socket, { roomId, userId, username });
    console.log('[chat] Connected via socket.io');
    return { type: 'socket', client: socket };
    }

    // --- Helpers ---

    function wireStreamChat(channel, username) {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const messagesEl = document.getElementById('chatMessages');
    if (!input || !sendBtn || !messagesEl) {
        console.warn('[chat] Missing DOM elements for Stream Chat');
        return;
    }

    sendBtn.onclick = async () => {
        const text = input.value.trim();
        if (!text) return;
        try {
        await channel.sendMessage({ text });
        input.value = '';
        } catch (err) {
        console.error('[chat] Failed to send Stream message:', err);
        }
    };

    channel.on('message.new', (event) => {
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg';
        msgEl.textContent = `${event.user?.name || username}: ${event.message.text}`;
        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    }

    function wireSocketChat(socket, { roomId, userId, username }) {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const messagesEl = document.getElementById('chatMessages');
    if (!input || !sendBtn || !messagesEl) {
        console.warn('[chat] Missing DOM elements for socket chat');
        return;
    }

    sendBtn.onclick = () => {
        const text = input.value.trim();
        if (!text) return;
        socket.emit('chat-message', { roomId, user: username, role: null, text });
        input.value = '';
    };

    socket.on('chat-message', ({ user, role, text }) => {
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg';
        msgEl.textContent = `${role ? role + ' ' : ''}${user}: ${text}`;
        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });
}
