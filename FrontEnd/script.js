// FRONTEND JAVASCRIPT FOR DROP 4 WITH STREAM CHAT INTEGRATION
const socket = io();
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const PLAYER1 = 'red';
const PLAYER2 = 'blue';
let USERS = {}; // to store userId to username mapping
let USER_ROLES = {}; // to store username to role mapping (red, blue, spectator)
let board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
let currentPlayer;
let assignedPlayer;
let gameOver = false;
let userId, chatToken;
let isMyTurn = false;
let scriptRoomId;
let gameChannel; // will hold the StreamChat channel instance

let STREAM_API_KEY; // globalization of stream api key

let chatClient; // will hold the StreamChat client instance

// Scores (kept in-memory while the page is open)

async function renderScores(redScore, blueScore) {
  /* COMMENTED OUT - Replaced with profile pictures */
}

// Result modal helper: shows a message and a "Play Again" button
function showResultModal(message) {
  // Update turn indicator with the result
  const turnEl = document.getElementById('turnIndicator');
  const playAgainBtn = document.getElementById('playAgainBtn');
  
  if (turnEl) {
    turnEl.textContent = message.toUpperCase();
    turnEl.className = 'gameover';
  }
  
  if (playAgainBtn) {
    playAgainBtn.style.display = 'block';
  }
  
  // Emit game-over event to sync with other players
  if (socket && scriptRoomId) {
    // If winner is available, include it. Otherwise, send null.
    let winner = null;
    if (message && (message.toLowerCase().includes('red wins') || message.toLowerCase().includes('blue wins'))) {
      winner = message.toLowerCase().includes('red wins') ? 'red' : 'blue';
    }
    socket.emit('game-over', { roomId: scriptRoomId, winner });
  }
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

// INITIALIZATION

function initializeBoard() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (gameOver) return;
      if(assignedPlayer === 'spectator'){
        alert("Spectators cannot make moves");
        return;
      }
      if (!isMyTurn) {
      alert("It's not your turn");
      return;
      } 
      const col = parseInt(cell.dataset.col);
      const success = dropPiece(col, currentPlayer, scriptRoomId);

      if (!success) {
        return
      }

      // find placed row
      let placedRow = -1;
      for (let r = 0; r < ROWS; r++) {
        if (board[r][col] !== EMPTY) { placedRow = r; break; }
      }
      if (placedRow === -1) return;
      updateUI(placedRow, col, currentPlayer);

      if (checkWin(currentPlayer)) {
        gameOver = true;
        // increment score for current player
        if (currentPlayer === PLAYER1){
          socket.emit('incrementRedScore', scriptRoomId);
        }  else {
          socket.emit('incrementBlueScore', scriptRoomId);
        }
        socket.emit('getScores', scriptRoomId);
        updateTurnIndicator();
        setTimeout(() => {
          showResultModal(`${currentPlayer.toUpperCase()} WINS!`);
        }, 100);
      } else if (isDraw()) {
        gameOver = true;
        updateTurnIndicator();
        setTimeout(() => {
          showResultModal('DRAW!');
        }, 100);
      } else {
        if (success) {
          // after move
          currentPlayer = currentPlayer === PLAYER1 ? PLAYER2 : PLAYER1;
          isMyTurn = assignedPlayer === currentPlayer;
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
  updateTurnIndicator();
}

// BOARD FUNCTIONS
function dropPiece(col, player, scriptRoomId) {
  console.log("Emitting move:", { col, player, scriptRoomId });
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === EMPTY) {
      board[row][col] = player;
      (updateUI(row, col, player));
      socket.emit('make-move', { data: {row, col, player}, roomId: scriptRoomId});
      return true;
    }
  }
  return false;
}

function updateUI(row, col, player) {
  const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (!cell) return;
  const existing = cell.querySelector('.piece');
  if (existing) existing.remove();


  const img = document.createElement('img');
  img.src = player === PLAYER1 ? "Assets/GHCCoin.png" : "Assets/GHRBCoin.png";
  img.className = `piece ${player}`;
  img.style.transform = 'translateY(-200px) scale(0.95)';
  img.style.opacity = '0';
  cell.appendChild(img);


  requestAnimationFrame(() => {
    img.style.transform = 'translateY(0) scale(1)';
    img.style.opacity = '1';
  });


  updateTurnIndicator();
}


function updateReloadedUI(board) {
  let redCount = 0;
  let blueCount = 0;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const player = board[row][col];
      if (player !== EMPTY) {
        updateUI(row, col, player);
        if (player === PLAYER1) redCount++;
        if (player === PLAYER2) blueCount++;
      }
    }
  }

  // Determine whose turn it is
  currentPlayer = redCount <= blueCount ? PLAYER1 : PLAYER2;
  isMyTurn = assignedPlayer === currentPlayer;
}

function isBoardFull() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] == EMPTY) return false;
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
        board[row][col] === player &&
        board[row][col + 1] === player &&
        board[row][col + 2] === player &&
        board[row][col + 3] === player
      ) {
        return true;
      }
    }
  }

  // Check vertical wins
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) {
      if (
        board[row][col] === player &&
        board[row + 1][col] === player &&
        board[row + 2][col] === player &&
        board[row + 3][col] === player
      ) {
        return true;
      }
    }
  }

  // Check diagonal (bottom-left to top-right) wins
  for (let row = 3; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      if (
        board[row][col] === player &&
        board[row - 1][col + 1] === player &&
        board[row - 2][col + 2] === player &&
        board[row - 3][col + 3] === player
      ) {
        return true;
      }
    }
  }

  // Check diagonal (top-left to bottom-right) wins
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      if (
        board[row][col] === player &&
        board[row + 1][col + 1] === player &&
        board[row + 2][col + 2] === player &&
        board[row + 3][col + 3] === player
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

  // clear previous state classes
  el.classList.remove('red', 'blue');

  if (gameOver) {
    // Don't change text if it's already showing a game over message
    if (!el.textContent.includes('WINS') && !el.textContent.includes('DRAW')) {
      el.textContent = 'Game Over';
    }
    return;
  }


  // assume currentPlayer is 'red' or 'blue'
  if (currentPlayer === PLAYER1 || currentPlayer === 'red') {
    el.textContent = 'Turn: RED';
    el.classList.add('red');
  } else {
    el.textContent = 'Turn: BLUE';
    el.classList.add('blue');
  }
}

function resetGame() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  document.querySelectorAll('.cell').forEach(cell => {
    const existing = cell.querySelector('.piece');
    if (existing) existing.remove();
    cell.style.backgroundImage = '';
    cell.classList.remove('highlight');
  });
  gameOver = false;
  currentPlayer = PLAYER1; // Always start with red
  isMyTurn = assignedPlayer === currentPlayer;
  
  // Reset turn indicator
  const turnEl = document.getElementById('turnIndicator');
  if (turnEl) {
    turnEl.textContent = 'Turn: RED';
    turnEl.className = 'red';
  }
  
  // Hide play again button
  const playAgainBtn = document.getElementById('playAgainBtn');
  if (playAgainBtn) {
    playAgainBtn.style.display = 'none';
  }
  
  updateTurnIndicator();
}

// SOCKET EVENTS AND STREAM CHAT INTEGRATION

socket.on('opponent-move', (data) => {
  console.log("Opponent move received:", data);
  if (gameOver) return;
  board[data.row][data.col] = data.player;
  updateUI(data.row, data.col, data.player);

  if (checkWin(data.player)) {
    gameOver = true;
    // increment score for winning player
    if (data.player === PLAYER1){
      socket.emit('incrementRedScore', scriptRoomId);
    } else {
      socket.emit('incrementBlueScore', scriptRoomId);
    }
    socket.emit('getScores', scriptRoomId);
    setTimeout(() => {
      showResultModal(`${data.player.toUpperCase()} WINS!`);
    }, 100);
  } else if (isDraw()) {
    gameOver = true;
    setTimeout(() => {
      showResultModal('DRAW!');
    }, 100);
  } else {
    currentPlayer = assignedPlayer;
    isMyTurn = assignedPlayer === currentPlayer;
    updateTurnIndicator();
  }
});

// Listen for new game requests from other players
socket.on('new-game-started', () => {
  resetGame();
  socket.emit('request-board', scriptRoomId);
});


async function connectToChat({ roomId, userId, token, role, username }) {
  const res = await fetch("/config");
  const { apiKey } = await res.json();   // destructure the key
  STREAM_API_KEY = apiKey;
  chatClient = StreamChat.getInstance(STREAM_API_KEY);

  if (chatClient?.user) {
    await chatClient.disconnect();
  }

  await chatClient.connectUser(
    { id: userId, name: `${(username || 'unknown')}` },
    token
  );

  const channel = chatClient.channel('messaging', roomId);
  await channel.watch();
  gameChannel = channel; // assign globally
  console.log('Chat connected and channel ready');
  channel.on('message.new', event => {
  const { user, text } = event.message;
  const username = USERS?.[user.id] || user.name || user.id;
  const chatBox = document.getElementById('chatMessages');
  if (!chatBox) return;
  
  const messageElem = document.createElement('div');
  messageElem.className = 'chat-message';
  
  // Create username span with color
  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'chat-username';
  const userRole = USER_ROLES[username];
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

  return { chatClient, gameChannel };
}

socket.on('game-created', async ({ roomId, userId, token, role, username}) => {
  console.log("game created");
  try {
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('userId', userId);
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('role', role);
    sessionStorage.setItem('username', username);
    location.href = `drop4.html?roomId=${roomId}`;
} catch (err) {
  console.error('Error in connectToChat:', err);
}

});

socket.on('game-joined', async ({ roomId, userId, token, role, username}) => {
  try {
  sessionStorage.setItem('roomId', roomId);
  sessionStorage.setItem('userId', userId);
  sessionStorage.setItem('token', token);
  sessionStorage.setItem('role', role);
  sessionStorage.setItem('username', username);
  location.href = `drop4.html?roomId=${roomId}`;
  console.log('Chat connected');
} catch (err) {
  console.error('Error in connectToChat:', err);
}
});
  
socket.on('room-full', () => {
  alert('Room is full. Try again later.');
});