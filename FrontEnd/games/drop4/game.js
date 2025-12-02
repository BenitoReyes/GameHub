import {
  initializeBoard,
  connectToChat,
  renderScores,
  updateReloadedUI,
  updateTurnIndicator,
  showRoleModal,
  setSessionInfo,
  state
} from './drop4logic.js';

import { showAlert } from '../commonLogic/ui.js';
import { getSocket } from '../commonLogic/socket.js';

const socket = getSocket();

export default {
  name: 'drop4',
  metadata: { type: 'board', realtime: false },

  async init({ roomId, userId, token, role, username } = {}) {
    window.IS_BOARD_PAGE = true;
    if (typeof renderScores === 'function') renderScores();

    const urlParams = new URLSearchParams(window.location.search);
    const actualRoomId =
      roomId || urlParams.get('roomId') || sessionStorage.getItem('roomId');
    const uid = userId || sessionStorage.getItem('userId');
    const tok = token || sessionStorage.getItem('token');
    const r = role || sessionStorage.getItem('role');
    const user = username || sessionStorage.getItem('username');

    if (!actualRoomId || !uid || !tok || !r) {
      showAlert('Missing session data. Please rejoin the room.');
      return;
    }

    sessionStorage.setItem('roomId', actualRoomId);
    setSessionInfo({ roomId: actualRoomId, uid, role: r, username: user });

    try {
      await connectToChat({ roomId: actualRoomId, userId: uid, token: tok, role: r, username: user });
    } catch (err) {
      console.error('Error connecting to chat from module:', err);
    }

    // Update shared state
    Object.assign(state, {
      assignedPlayer: r,
      userId: uid,
      scriptRoomId: actualRoomId,
      isMyTurn: r === state.currentPlayer
    });

    const nameEl = document.getElementById(
      r === 'red' ? 'redPlayerName' : r === 'blue' ? 'bluePlayerName' : null
    );
    if (nameEl) nameEl.textContent = user || (r === 'red' ? 'Player 1' : 'Player 2');
    state.USER_ROLES[user] = r;

    try {
      socket.emit('join-room', state.scriptRoomId);
      socket.emit('player-joined', { roomId: state.scriptRoomId, role: r, username: user });
      socket.emit('request-player-names', state.scriptRoomId);
      socket.emit('request-board', state.scriptRoomId);
      socket.emit('getScores', state.scriptRoomId);
      // request room listing refresh so join list/room counts update for spectators
      socket.emit('get-rooms', { gameType: 'drop4' });
    } catch (err) {
      console.error('socket emit failed:', err);
    }

    // Initialize the board UI and attach event listeners
    try {
      if (typeof initializeBoard === 'function') initializeBoard();
    } catch (err) {
      console.error('Failed to initialize board:', err);
    }

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
        const boardState = state.board?.map(row =>
          row.map(cell => (cell === 0 ? null : cell))
        ) || Array.from({ length: 6 }, () => Array(7).fill(null));

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

    if (suggestionBtn) {
      suggestionBtn.addEventListener('click', async () => {
        const col = await getSuggestion();
        if (typeof col === 'number') highlightColumn(col);
      });
    }
  }
};