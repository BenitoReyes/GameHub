import {
  initializeBoard,
  renderScores,
  updateReloadedUI,
  updateTurnIndicator,
  showRoleModal,
  setSessionInfo,
  state
} from './drop4logic.js';

import { showAlert } from '../commonLogic/ui.js';
import { getSocket } from '../commonLogic/socket.js';
import { initChat } from '../commonLogic/chat.js';

const socket = getSocket();

export default {
  name: 'drop4',
  metadata: { type: 'board', realtime: false },

  async init({ roomId, userId, token, role, username } = {}) {
    // Guard re-entry
    if (window.__DROP4_INIT_DONE) return;
    window.__DROP4_INIT_DONE = true;

    window.IS_BOARD_PAGE = true;
    if (typeof renderScores === 'function') renderScores();

    const urlParams = new URLSearchParams(window.location.search);
    const actualRoomId = roomId || urlParams.get('roomId') || sessionStorage.getItem('roomId');
    const r = role || sessionStorage.getItem('role') || 'red';
    const user = username || sessionStorage.getItem('username') || 'Player';

    if (!actualRoomId || !r) {
      showAlert('Missing room or role. Please rejoin the room.');
      return;
    }

    try {
      sessionStorage.setItem('roomId', actualRoomId);
      sessionStorage.setItem('role', r);
      sessionStorage.setItem('username', user);
    } catch {}

    setSessionInfo({
      roomId: actualRoomId,
      uid: userId || sessionStorage.getItem('userId'),
      role: r,
      username: user
    });

    Object.assign(state, {
      assignedPlayer: r,
      userId: userId || sessionStorage.getItem('userId') || null,
      scriptRoomId: actualRoomId,
      isMyTurn: r === state.currentPlayer
    });

    const nameEl = document.getElementById(r === 'red' ? 'redPlayerName' : r === 'blue' ? 'bluePlayerName' : null);
    if (nameEl) nameEl.textContent = user || (r === 'red' ? 'Player 1' : 'Player 2');
    state.USER_ROLES[user] = r;

    // Emit only what Drop4 needs — DO NOT emit 'join-game' here
    if (!socket._drop4Joined) {
      try {
        socket.emit('join-room', state.scriptRoomId);
        socket.emit('player-joined', { roomId: state.scriptRoomId, role: r, username: user });
        socket.emit('request-player-names', state.scriptRoomId);
        socket.emit('request-board', state.scriptRoomId);
        socket.emit('getScores', state.scriptRoomId);
        socket.emit('get-rooms', { gameType: 'drop4' });
        // If your server assigns roles on request:
        socket.emit('request-role', { roomId: state.scriptRoomId, userId: state.userId });
        socket._drop4Joined = true;
      } catch (err) {
        console.error('socket emit failed:', err);
      }
    }

    // Initialize board UI once
    if (!window.__DROP4_BOARD_INIT) {
      try {
        if (typeof initializeBoard === 'function') initializeBoard();
        window.__DROP4_BOARD_INIT = true;
      } catch (err) {
        console.error('Failed to initialize board:', err);
      }
    }

    // Attach listeners once
    if (!socket._drop4ListenersAttached) {
      socket.on('all-players-info', (players) => {
        if (players.red) {
          const el = document.getElementById('redPlayerName');
          if (el) el.textContent = players.red;
          state.USER_ROLES[players.red] = 'red';
        }
        if (players.blue) {
          const el = document.getElementById('bluePlayerName');
          if (el) el.textContent = players.blue;
          state.USER_ROLES[players.blue] = 'blue';
        }
      });

      socket.on('scoreUpdate', ({ redScore, blueScore }) => {
        renderScores(redScore, blueScore);
      });

      socket.on('sync-board', (boardData) => {
        state.board = boardData;
        if (typeof updateReloadedUI === 'function') updateReloadedUI(state.board);
        updateTurnIndicator();
      });

      // Chat wiring once we have credentials — if your server emits 'game-joined' for Drop4, keep this.
      socket.once('game-joined', async ({ roomId, userId, token, role, username }) => {
        try {
          sessionStorage.setItem('roomId', roomId);
          sessionStorage.setItem('userId', userId);
          sessionStorage.setItem('token', token);
          sessionStorage.setItem('role', role);
          sessionStorage.setItem('username', username);
        } catch {}

        setSessionInfo({ roomId, uid: userId, role, username });

        if (!socket._chatWired) {
          try {
            const { apiKey } = await (await fetch('/config')).json();
            await initChat({ apiKey, userId, token, username, roomId, socket });
            socket._chatWired = true;
          } catch (err) {
            console.warn('[Drop4] initChat failed:', err);
          }
        }
      });

      // If 'game-joined' is NOT emitted for Drop4, wire chat immediately using current session:
      if (!socket._chatWired) {
        try {
          const { apiKey } = await (await fetch('/config')).json();
          await initChat({
            apiKey,
            userId: state.userId || sessionStorage.getItem('userId'),
            token: token || sessionStorage.getItem('token'),
            username: user,
            roomId: actualRoomId,
            socket
          });
          socket._chatWired = true;
        } catch (err) {
          console.warn('[Drop4] immediate initChat failed (no game-joined):', err);
        }
      }

      socket._drop4ListenersAttached = true;
    }

    showRoleModal(`You are ${r}, RoomID: ${actualRoomId}`);

    // Suggestion button logic
    const suggestionBtn = document.getElementById('suggestionBtn');
    let previousHighlight = null;

    function removeHighlight() {
      if (previousHighlight !== null) {
        const cells = document.querySelectorAll(`.cell[data-col="${previousHighlight}"]`);
        cells.forEach(cell => cell.classList.remove('column-highlight'));
        previousHighlight = null;
      }
    }

    function highlightColumn(column) {
      removeHighlight();
      const cells = document.querySelectorAll(`.cell[data-col="${column}"]`);
      cells.forEach(cell => cell.classList.add('column-highlight'));
      previousHighlight = column;
      setTimeout(removeHighlight, 3000);
    }

    async function getSuggestion() {
      if (!state.isMyTurn) {
        showAlert('Please wait for your turn!');
        return;
      }
      try {
        const boardState =
          state.board?.map(row => row.map(cell => (cell === 0 ? null : cell))) ||
          Array.from({ length: 6 }, () => Array(7).fill(null));

        const response = await fetch('/api/drop4/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ board: boardState, currentPlayer: state.currentPlayer })
        });

        if (!response.ok) throw new Error('Failed to get suggestion');
        const json = await response.json();
        const col = json.column;
        highlightColumn(col);
        return col;
      } catch (err) {
        console.error('Suggestion error', err);
      }
    }

    if (suggestionBtn && !suggestionBtn._drop4Bound) {
      suggestionBtn.addEventListener('click', async () => {
        const col = await getSuggestion();
        if (typeof col === 'number') highlightColumn(col);
      });
      suggestionBtn._drop4Bound = true;
    }
  }
};


