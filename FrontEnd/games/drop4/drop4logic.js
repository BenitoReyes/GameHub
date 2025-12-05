// FRONTEND JAVASCRIPT FOR DROP 4 WITH STREAM CHAT INTEGRATION
import { getSocket } from '../commonLogic/socket.js';
import { showAlert } from '../commonLogic/ui.js';
const socket = getSocket();
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const PLAYER1 = 'red';
const PLAYER2 = 'blue';

export const state = {
  board: Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY)),
  currentPlayer: 'red',
  assignedPlayer: null,
  scriptRoomId: null,
  userId: null,
  USER_ROLES: {},
  USERS: {},
  isMyTurn: false,
  lastWinner: null,
  gameChannel: null,
  chatClient: null,
  STREAM_API_KEY: null,
};
let gameOver = false; // keep local gameOver flag
let chatToken; // local variable for chat token

// Exportable session setters/getters
export function setSessionInfo({ roomId, uid, role, username } = {}) {
  if (typeof roomId !== 'undefined') state.scriptRoomId = roomId;
  if (typeof uid !== 'undefined') state.userId = uid;
  if (typeof role !== 'undefined') state.assignedPlayer = role;
  if (typeof username !== 'undefined') state.USERS[uid] = username;
  // Update isMyTurn based on currentPlayer and assignedPlayer
  state.isMyTurn = state.assignedPlayer === state.currentPlayer;
  console.log('setSessionInfo called:', { roomId: state.scriptRoomId, uid: state.userId, role: state.assignedPlayer, currentPlayer: state.currentPlayer, isMyTurn: state.isMyTurn });
}

export function getState() {
  return state;
}

// Scores (kept in-memory while the page is open)

async function renderScores(redScore, blueScore) {
  // Attach small score badges inside player profile containers
  const redProfile = document.querySelector('.profile-left');
  const blueProfile = document.querySelector('.profile-right');
  if (redProfile) {
    let el = document.getElementById('redScore');
    if (!el) {
      el = document.createElement('div');
      el.id = 'redScore';
      el.style.marginLeft = '8px';
      el.style.fontSize = '12px';
      el.style.color = '#fff';
      el.style.fontWeight = '700';
      redProfile.appendChild(el);
    }
    el.textContent = `Wins: ${redScore || 0}`;
  }
  if (blueProfile) {
    let el2 = document.getElementById('blueScore');
    if (!el2) {
      el2 = document.createElement('div');
      el2.id = 'blueScore';
      el2.style.marginRight = '8px';
      el2.style.fontSize = '12px';
      el2.style.color = '#fff';
      el2.style.fontWeight = '700';
      blueProfile.appendChild(el2);
    }
    el2.textContent = `Wins: ${blueScore || 0}`;
  }
}

// initialize scores UI
// renderScores(); // COMMENTED OUT

// Result modal helper: shows a message and a "Play Again" button
function showResultModal(message) {
  let modal = document.getElementById('resultModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'resultModal';
    modal.className = 'modal-overlay';

    const content = document.createElement('div');
    content.id = 'resultContent';
    content.className = 'modal-content';

    const msg = document.createElement('p');
    msg.id = 'resultMessage';
    msg.style.marginBottom = '16px';
    content.appendChild(msg);

    const btn = document.createElement('button');
    btn.id = 'playAgainBtn';
    btn.textContent = 'Play Again';
    Object.assign(btn.style, {
      padding: '8px 14px',
      fontSize: '14px',
      cursor: 'pointer',
      borderRadius: '6px',
      border: 'none',
      background: '#007bff',
      color: '#fff'
    });

    btn.addEventListener('click', () => {
      modal.style.display = 'none';
      // Request server to reset the game (server controls initial state & current player)
      try { socket.emit('reset-game', state.scriptRoomId); } catch (e) { console.warn('reset-game emit failed', e); }
      try{ socket.emit('getScores', state.scriptRoomId); } catch(e){ /* ignore */ }
    });

    content.appendChild(btn);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }

  // animation CSS moved to styles.css

  const msgEl = document.getElementById('resultMessage');
  if (msgEl) msgEl.textContent = message;
  if (msgEl) {
    const lower = (message || '').toLowerCase();
    if (lower.includes('red')) {
      msgEl.style.color = 'red';
    } else if (lower.includes('blue')) {
      msgEl.style.color = 'royalblue';
    } else {
      msgEl.style.color = '#666';
    }
  }

  // choose animation based on message
  const contentEl = document.getElementById('resultContent');
  if (contentEl) {
    contentEl.classList.remove('bounce', 'fade-in');
    contentEl.classList.add('modal-anim-content');
    const lower = (message || '').toLowerCase();
    if (lower.includes('win') || lower.includes('wins')) {
      contentEl.classList.add('bounce');
    } else {
      // draw or neutral
      contentEl.classList.add('fade-in');
    }
  }

  modal.style.display = 'flex';
}

// Role modal: informs the user which player they are, using the same blue button style
function showRoleModal(message) {
  let modal = document.getElementById('roleModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'roleModal';
    Object.assign(modal.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(5px)',
      webkitBackdropFilter: 'blur(5px)',
      zIndex: '9999',
    });

    const content = document.createElement('div');
    Object.assign(content.style, {
      background: '#000',
      padding: '20px',
      borderRadius: '8px',
      textAlign: 'center',
      minWidth: '260px',
      boxShadow: '0 6px 20px rgba(0,0,0,0.3)'
    });

    const msg = document.createElement('p');
    msg.id = 'roleMessage';
    msg.style.marginBottom = '16px';
    content.appendChild(msg);

    const btn = document.createElement('button');
    btn.id = 'roleContinueBtn';
    btn.textContent = 'Continue';
    Object.assign(btn.style, {
      padding: '8px 14px',
      fontSize: '14px',
      cursor: 'pointer',
      borderRadius: '6px',
      border: 'none',
      background: '#007bff',
      color: '#fff'
    });

    btn.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    content.appendChild(btn);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }

  const msgEl = document.getElementById('roleMessage');
  if (msgEl) msgEl.textContent = message;
  const contentEl = modal.querySelector('div');
  if (contentEl) {
    contentEl.classList.add('modal-anim-content', 'fade-in');
  }
  modal.style.display = 'flex';
}

function showPlayerLeftModal({ username, role }) {
  let modal = document.getElementById('playerLeftModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'playerLeftModal';
    modal.className = 'modal-overlay';

    const content = document.createElement('div');
    content.className = 'modal-content modal-anim-content';

    const msg = document.createElement('p');
    msg.id = 'playerLeftMessage';
    msg.style.marginBottom = '16px';
    content.appendChild(msg);

    const btn = document.createElement('button');
    btn.textContent = 'OK';
    Object.assign(btn.style, {
      padding: '8px 14px',
      fontSize: '14px',
      cursor: 'pointer',
      borderRadius: '6px',
      border: 'none',
      background: '#ef4444',
      color: '#fff',
      fontFamily: "'Press Start 2P', cursive"
    });

    btn.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    content.appendChild(btn);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }

  const msgEl = document.getElementById('playerLeftMessage');
  if (msgEl) {
    msgEl.textContent = `${username || 'A player'} (${role || 'unknown'}) has left the game.`;
    msgEl.style.color = role === 'red' ? '#ef4444' : role === 'blue' ? '#3b82f6' : '#fbbf24';
  }

  modal.style.display = 'flex';
}

// INITIALIZATION

function initializeBoard() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (gameOver) return;
      if(state.assignedPlayer === 'spectator'){
        showAlert("Spectators cannot make moves");
        return;
      }
      if (!state.isMyTurn) {
      showAlert("It's not your turn");
      return;
      } 
      const col = parseInt(cell.dataset.col);
      const placedRow = dropPiece(col, state.currentPlayer, state.scriptRoomId);
      if (placedRow < 0) return; // failed to place

      if (checkWin(state.currentPlayer)) {
        // local detection removed: server will validate winner and emit 'game-over'
        gameOver = true; // prevent duplicate local moves until server-restart
        // Request server to get latest scores and result
        try { socket.emit('getScores', state.scriptRoomId); } catch (e) { /* ignore */ }
      } else if (isDraw()) {
        gameOver = true;
        try { socket.emit('getScores', state.scriptRoomId); } catch (e) { /* ignore */ }
      } else {
          if (placedRow >= 0) {
          // after move
          state.currentPlayer = state.currentPlayer === PLAYER1 ? PLAYER2 : PLAYER1;
            state.isMyTurn = state.assignedPlayer === state.currentPlayer;
          updateTurnIndicator();
        }
      }
    });
    // COLUMN HOVER: highlight the entire column on mouse enter/leave
    cell.addEventListener('mouseenter', () => {
      const col = parseInt(cell.dataset.col, 10);
      highlightColumn(col);
    });
    cell.addEventListener('mouseleave', () => {
      const col = parseInt(cell.dataset.col, 10);
      clearColumnHighlight(col);
    });
  });
}

// BOARD FUNCTIONS
function dropPiece(col, player, scriptRoomId) {
  if (!scriptRoomId) {
    console.warn('dropPiece called without a scriptRoomId; move will not be sent to server.');
  }
  console.log("Emitting move:", { col, player, scriptRoomId });
  for (let row = ROWS - 1; row >= 0; row--) {
    if (state.board[row][col] === EMPTY) {
      state.board[row][col] = player;
      (updateUI(row, col, player));
      console.log('Local board update, emitting make-move to server for room:', state.scriptRoomId, 'row:', row, 'col:', col, 'player:', player);
      socket.emit('make-move', { data: {row, col, player}, roomId: state.scriptRoomId});
      return row;
    }
  }
  return -1;
}

function updateUI(row, col, player) {
  const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (!cell) return;
  const existing = cell.querySelector('.piece');
  if (existing) existing.remove();


  const img = document.createElement('img');
  img.src = player === PLAYER1 ? "../../Assets/GHCCoin.png" : "../../Assets/GHRBCoin.png";
  img.className = `piece ${player}`;
  img.style.transform = 'translateY(-200px) scale(0.95)';
  img.style.opacity = '0';
  cell.appendChild(img);


  requestAnimationFrame(() => {
    img.style.transform = 'translateY(0) scale(1)';
    img.style.opacity = '1';
  });


}


function updateReloadedUI(boardData) {
  // Ensure state.board is the latest
  state.board = boardData || state.board;
  // Clear any existing pieces (for cells that may now be empty)
  document.querySelectorAll('.cell').forEach(cell => {
    const existing = cell.querySelector('.piece');
    if (existing) existing.remove();
  });
  let redCount = 0;
  let blueCount = 0;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const player = state.board[row][col];
      if (player !== EMPTY) {
        updateUI(row, col, player);
        if (player === PLAYER1) redCount++;
        if (player === PLAYER2) blueCount++;
      }
    }
  }

  // Determine whose turn it is
  state.currentPlayer = redCount <= blueCount ? PLAYER1 : PLAYER2;
  state.isMyTurn = state.assignedPlayer === state.currentPlayer;
  console.log('updateReloadedUI: redCount=', redCount, 'blueCount=', blueCount, 'currentPlayer=', state.currentPlayer, 'assignedPlayer=', state.assignedPlayer, 'isMyTurn=', state.isMyTurn);
}

function isBoardFull() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.board[r][c] == EMPTY) return false;
    }
  }
  return true;
}

function isDraw() {
  return isBoardFull();
}

function checkWin(player){
  // Check horizontal wins
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      if (
        state.board[row][col] === player &&
        state.board[row][col + 1] === player &&
        state.board[row][col + 2] === player &&
        state.board[row][col + 3] === player
      ) {
        return true;
      }
    }
  }

  // Check vertical wins
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) {
      if (
        state.board[row][col] === player &&
        state.board[row + 1][col] === player &&
        state.board[row + 2][col] === player &&
        state.board[row + 3][col] === player
      ) {
        return true;
      }
    }
  }

  // Check diagonal (bottom-left to top-right) wins
  for (let row = 3; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      if (
        state.board[row][col] === player &&
        state.board[row - 1][col + 1] === player &&
        state.board[row - 2][col + 2] === player &&
        state.board[row - 3][col + 3] === player
      ) {
        return true;
      }
    }
  }

  // Check diagonal (top-left to bottom-right) wins
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      if (
        state.board[row][col] === player &&
        state.board[row + 1][col + 1] === player &&
        state.board[row + 2][col + 2] === player &&
        state.board[row + 3][col + 3] === player
      ) {
        return true;
      }
    }
  }

return false;
}

function highlightColumn(col) {
  document.querySelectorAll(`.cell[data-col="${col}"]`).forEach(c => c.classList.add('highlight'));
}
function clearColumnHighlight(col) {
  document.querySelectorAll(`.cell[data-col="${col}"]`).forEach(c => c.classList.remove('highlight'));
}

function updateTurnIndicator() {
  const el = document.getElementById('turnIndicator');
  if (!el) return;

  // clear previous state classes (always reset to known state before applying new)
  el.classList.remove('red', 'blue', 'gameover');

  if (gameOver) {
    // Keep the indicator stable to show the final result.
    if (state.lastWinner) {
      el.textContent = `${state.lastWinner.toUpperCase()} wins!`;
      el.classList.remove('red','blue','gameover');
      el.classList.add(state.lastWinner === 'red' ? 'red' : 'blue');
    } else {
      el.textContent = 'Game Over';
      el.classList.remove('red','blue','gameover');
      el.classList.add('gameover');
    }
    return;
  }


  // assume currentPlayer is 'red' or 'blue'
  if (state.currentPlayer === PLAYER1 || state.currentPlayer === 'red') {
    el.textContent = 'Turn: RED';
    el.classList.add('red');
    console.log('updateTurnIndicator applied RED class');
  } else {
    el.textContent = 'Turn: BLUE';
    el.classList.add('blue');
    console.log('updateTurnIndicator applied BLUE class');
  }
}

function resetGame() {
  state.board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  document.querySelectorAll('.cell').forEach(cell => {
    const existing = cell.querySelector('.piece');
    if (existing) existing.remove();
    cell.style.backgroundImage = '';
    cell.classList.remove('highlight');
  });
  gameOver = false;
  state.currentPlayer = state.assignedPlayer || PLAYER1;
}

// SOCKET EVENTS AND STREAM CHAT INTEGRATION

socket.on('opponent-move', (data) => {
  console.log("Opponent move received:", data);
  if (gameOver) return;
  state.board[data.row][data.col] = data.player;
  updateUI(data.row, data.col, data.player);

  // Server will emit 'game-over' to notify clients of final outcome.
  // Update UI using refreshed heuristics
  updateReloadedUI(state.board);
  updateTurnIndicator();
});

socket.on('action-error', ({ message }) => {
  console.warn('Action error received:', message);
  try { showAlert(message); } catch (e) { console.error('Unable to show alert for action-error:', e); }
});

// Server signals that a game has finished (winner or draw). Use server's canonical result.
socket.on('game-over', ({ winner, draw, board, redScore, blueScore }) => {
  console.log('game-over event received:', { winner, draw });
  gameOver = true;
  state.lastWinner = winner;
  if (board) {
    state.board = board;
    updateReloadedUI(state.board);
  }
  if (typeof renderScores === 'function') renderScores(redScore, blueScore);
  if (draw) {
    setTimeout(() => showResultModal('Draw!')); 
  } else if (winner) {
    setTimeout(() => showResultModal(`${winner.toUpperCase()} wins!`));
  }
});

// Server requests a reset for a new game, broadcasts to all participants
socket.on('game-reset', ({ board, currentPlayer, redScore, blueScore }) => {
  console.log('game-reset received', { currentPlayer });
  // apply board if provided
  if (board) {
    state.board = board;
  } else {
    state.board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  }
  gameOver = false;
  state.lastWinner = null;
  state.currentPlayer = currentPlayer || 'red';
  state.isMyTurn = state.assignedPlayer === state.currentPlayer;
  updateReloadedUI(state.board);
  updateTurnIndicator();
  if (typeof renderScores === 'function') renderScores(redScore, blueScore);
});

// Listen for role assignment from server (e.g., red/blue/spectator)
socket.on('assign-role', (role) => {
  console.log('Assigned role by server:', role);
  state.assignedPlayer = role;
  // Update isMyTurn based on the current player
  state.isMyTurn = state.assignedPlayer === state.currentPlayer;
  try { showRoleModal(`You are ${role}`); } catch (e) { /* ignore */ }
  try { updateTurnIndicator(); } catch (e) { /* ignore */ }
});


async function connectToChat({ roomId, userId, token, role, username }) {
  const res = await fetch("/config");
  const { apiKey } = await res.json();   // destructure the key
  state.STREAM_API_KEY = apiKey;
  state.chatClient = StreamChat.getInstance(state.STREAM_API_KEY);

  if (state.chatClient?.user) {
    await state.chatClient.disconnect();
  }

  await state.chatClient.connectUser(
    { id: userId, name: `${(username || 'unknown')}` },
    token
  );

  const channel = state.chatClient.channel('messaging', roomId);
  await channel.watch();
  state.gameChannel = channel; // assign globally
  console.log('Chat connected and channel ready');
  channel.on('message.new', event => {
  const { user, text } = event.message;
  const username = state.USERS?.[user.id] || user.name || user.id;
  const chatBox = document.getElementById('chatMessages');
  if (!chatBox) return;
  
  const messageElem = document.createElement('div');
  messageElem.className = 'chat-message';
  
  // Create username span with color
  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'chat-username';
  const userRole = state.USER_ROLES[username];
  if (userRole === 'red') {
    usernameSpan.classList.add('chat-username-red');
  } else if (userRole === 'blue') {
    usernameSpan.classList.add('chat-username-blue');
  }
  usernameSpan.textContent = username + ': ';
  
  // Add message text
  const textSpan = document.createElement('span');
  textSpan.textContent = text;
  
  messageElem.appendChild(usernameSpan);
  messageElem.appendChild(textSpan);
  chatBox.appendChild(messageElem);
  chatBox.scrollTop = chatBox.scrollHeight;
  
  // Limit messages to 50, fade out and remove oldest
  const MAX_MESSAGES = 50;
  const messages = chatBox.querySelectorAll('.chat-message');
  if (messages.length > MAX_MESSAGES) {
    const oldestMessage = messages[0];
    oldestMessage.classList.add('fade-out');
    setTimeout(() => {
      if (oldestMessage.parentNode === chatBox) {
        chatBox.removeChild(oldestMessage);
      }
    }, 500); // Match the fadeOut animation duration
  }
});

// Enable send button
const sendBtn = document.getElementById('sendBtn');
const input = document.getElementById('chatInput');
if (sendBtn && input) {
  sendBtn.disabled = false;
  sendBtn.addEventListener('click', async () => {
    const message = input.value.trim();
    if (message) {
      await channel.sendMessage({ text: message });
      input.value = '';
    }
  });
}

  return { chatClient: state.chatClient, gameChannel: state.gameChannel };
}

socket.on('player-left', ({ username, role }) => {
  console.log(`${username || 'A player'} (${role}) left the game.`);
  showPlayerLeftModal({ username, role });
  // Optionally show a toast, update UI, or disable board
});

socket.on('game-created', async ({ roomId, userId, token, role, username, gameType}) => {
  console.log("game created");
  try {
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('userId', userId);
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('role', role);
    sessionStorage.setItem('username', username);
    // redirect to the appropriate game page
    const page = gameType === 'battleship' ? 'battleship.html' : 'drop4.html';
    location.href = `${page}?roomId=${roomId}`;
} catch (err) {
  console.error('Error in connectToChat:', err);
}

});

socket.on('game-joined', async ({ roomId, userId, token, role, username, gameType}) => {
  try {
  sessionStorage.setItem('roomId', roomId);
  sessionStorage.setItem('userId', userId);
  sessionStorage.setItem('token', token);
  sessionStorage.setItem('role', role);
  sessionStorage.setItem('username', username);
  const page = gameType === 'battleship' ? 'battleship.html' : 'drop4.html';
  location.href = `${page}?roomId=${roomId}`;
  console.log('Chat connected');
} catch (err) {
  console.error('Error in connectToChat:', err);
}
});
  
socket.on('room-full', () => {
  showAlert('Room is full. Try again later.');
});

// General error handler from server
socket.on('error', (err) => {
  try {
    const msg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
    console.error('Socket error:', msg);
    showAlert(msg);
  } catch (e) {
    console.warn('Error processing socket error:', e);
  }
});

// Export functions used by game modules
export {
  initializeBoard,
  connectToChat,
  renderScores,
  updateReloadedUI,
  updateTurnIndicator,
  showRoleModal,
  showResultModal,
  showPlayerLeftModal,
  resetGame,
  dropPiece,
  updateUI,
  checkWin,
  highlightColumn,
  clearColumnHighlight
};
// state is declared above and exported once

