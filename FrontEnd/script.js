console.log("StreamChat loaded?", typeof StreamChat);

const socket = io();
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const PLAYER1 = 'red';
const PLAYER2 = 'yellow';
let board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
let currentPlayer = PLAYER1;
let assignedPlayer;
let gameOver = false;
let userId, chatToken;

let gameChannel; // will hold the StreamChat channel instance

let STREAM_API_KEY; // globalization of stream api key

let chatClient; // will hold the StreamChat client instance

// Scores (kept in-memory while the page is open)
let redScore = 0;
let yellowScore = 0;

function renderScores() {
  let redEl = document.getElementById('redScore');
  let yellowEl = document.getElementById('yellowScore');

  if (!redEl) {
    redEl = document.createElement('div');
    redEl.id = 'redScore';
    Object.assign(redEl.style, {
      position: 'fixed',
      top: '8px',
      left: '12px',
      fontSize: '48px',
      fontWeight: '600',
      color: 'red',
      background: 'rgba(255,255,255,0.8)',
      padding: '6px 10px',
      borderRadius: '6px',
      zIndex: '1000'
    });
    document.body.appendChild(redEl);
  }

  if (!yellowEl) {
    yellowEl = document.createElement('div');
    yellowEl.id = 'yellowScore';
    Object.assign(yellowEl.style, {
      position: 'fixed',
      top: '8px',
      right: '12px',
      fontSize: '48px',
      fontWeight: '600',
      color: 'goldenrod',
      background: 'rgba(255,255,255,0.8)',
      padding: '6px 10px',
      borderRadius: '6px',
      zIndex: '1000'
    });
    document.body.appendChild(yellowEl);
  }

  redEl.textContent = `Red: ${redScore}`;
  yellowEl.textContent = `Yellow: ${yellowScore}`;
}

// initialize scores UI
renderScores();

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
      // Tell server and reset locally
      try { socket.emit('reset-game'); } catch (e) { /* ignore */ }
      try { resetGame(); } catch (e) { /* ignore */ }
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
    } else if (lower.includes('yellow')) {
      msgEl.style.color = 'goldenrod';
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
      background: '#fff',
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

      const col = parseInt(cell.dataset.col);
      const success = dropPiece(col, currentPlayer);

      if (success) {
        if (checkWin(currentPlayer)) {
          gameOver = true;
          // increment score for current player
          if (currentPlayer === PLAYER1) redScore++; else yellowScore++;
          renderScores();
          setTimeout(() => {
            showResultModal(`${currentPlayer.toUpperCase()} wins!`);
          }, 100);
        } else if (isDraw()) {
          gameOver = true;
          setTimeout(() => {
            showResultModal('Draw!');
          }, 100);
        } else {
          currentPlayer = currentPlayer === PLAYER1 ? PLAYER2 : PLAYER1;
        }
      }
    });
  });
}


// BOARD FUNCTIONS
 function dropPiece(col, player) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === EMPTY) {
      board[row][col] = player;
      (updateUI(row, col, player));
      socket.emit('make-move', { row, col, player });
      return true;
    }
  }
  return false;
}

function updateUI(row, col, player) {
  console.log(`Updating UI for row: ${row}, col: ${col}, player: ${player}`);
  const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (cell) {
    const imagePath = player === 'red'
      ? "Assets/RedConnect4.png"
      : "Assets/YellowConnect4.png";
    cell.style.backgroundImage = `url('${imagePath}')`;
  }
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
function resetGame() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  document.querySelectorAll('.cell').forEach(cell => {
    cell.style.backgroundImage = '';
  });
  gameOver = false;
  currentPlayer = assignedPlayer || PLAYER1;
}


// SOCKET EVENTS AND STREAM CHAT INTEGRATION


socket.on('opponent-move', (data) => {
  if (gameOver) return;
  board[data.row][data.col] = data.player;
  updateUI(data.row, data.col, data.player);

  if (checkWin(data.player)) {
    gameOver = true;
    // increment score for winning player
    if (data.player === PLAYER1) redScore++; else yellowScore++;
    renderScores();
    setTimeout(() => {
      showResultModal(`${data.player.toUpperCase()} wins!`);
    }, 100);
  } else if (isDraw()) {
    gameOver = true;
    setTimeout(() => {
      showResultModal('Draw! Board is full.');
    }, 100);
  } else {
    currentPlayer = assignedPlayer;
  }
});

socket.on('chat-auth', async ({ userId: id, token }) => {
  userId = id;
  chatToken = token;
  // Fetch the API key from the server and wait for it before initializing chatClient
  const res = await fetch("/config");
  const { apiKey } = await res.json();
  STREAM_API_KEY = apiKey;
  chatClient = new StreamChat(STREAM_API_KEY);

});

socket.on('assign-role', async (role) => {
  assignedPlayer = role;
  currentPlayer = role;
  showRoleModal(`You are ${role.toUpperCase()}`);
   // Wait until chat-auth has arrived
  const waitForChatClient = () =>
    new Promise(resolve => {
      const check = () => {
        if (chatClient && userId && chatToken) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  await waitForChatClient();
  // If there's an existing user connection, disconnect first
    if (chatClient?.user) {
  await chatClient.disconnect();
}
  // Now connect the user after checks 
  try {
    await chatClient.connectUser(
      {
        id: userId,
        name: `Player ${role.toUpperCase()}`
      },
      chatToken
    );
    console.log('Chat connected');
    // Create or get the channel for the game and for now have a system bot stand in for second player
    const channel = chatClient.channel('messaging', {
      members: [userId, 'system-bot'],
      name: 'Game Chat'
    });
    // Wait for the channel to be created and watched
    await channel.create();
    await channel.watch();
    gameChannel = channel;
    // Set up UI event listeners for sending messages
    document.getElementById('sendBtn').addEventListener('click', async () => {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text) return;

      await gameChannel.sendMessage({ text });
      input.value = '';
    });
    // Listen for new messages
    gameChannel.on('message.new', (event) => {
      const msg = event.message;
      const chatBox = document.getElementById('chatMessages');
      const div = document.createElement('div');
      div.textContent = `${msg.user.name}: ${msg.text}`;
      chatBox.appendChild(div);
      chatBox.scrollTop = chatBox.scrollHeight;
    });

    console.log('Channel ready');
  } catch (err) {
    console.error('Chat connection failed:', err);
  }

});

socket.on('room-full', () => {
  alert('Room is full. Try again later.');
});

function resetGame() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  document.querySelectorAll('.cell').forEach(cell => {
    cell.style.backgroundImage = '';
  });
  gameOver = false;
  currentPlayer = assignedPlayer || PLAYER1;
}

initializeBoard();