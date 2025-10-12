// FRONTEND JAVASCRIPT FOR CONNECT 4 WITH STREAM CHAT INTEGRATION
const socket = io();
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const PLAYER1 = 'red';
const PLAYER2 = 'yellow';
let USERS = {}; // to store userId to username mapping
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

      if (success) {
        if (checkWin(currentPlayer)) {
          gameOver = true;
          setTimeout(() => {

          alert(`${currentPlayer.toUpperCase()} wins!`);
          socket.emit('reset-game');
          resetGame();
          }, 100);
        } else if (isDraw()) {
          gameOver = true;
          setTimeout(() => {
            alert('Draw! Board is full.');
            socket.emit('reset-game');
            resetGame();
          }, 100);
        } else {
          if (success) {
            // after move
            currentPlayer = currentPlayer === PLAYER1 ? PLAYER2 : PLAYER1;
            isMyTurn = assignedPlayer === currentPlayer;
          }
        }
      }
    });
  });
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
  console.log(`Updating UI for row: ${row}, col: ${col}, player: ${player}`);
  const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (cell) {
    let imagePath;
    if(player === 'red'){
      imagePath = "Assets/RedConnect4.png"
    } else if (player ==='yellow'){
      imagePath =  "Assets/YellowConnect4.png";
    }
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


// SOCKET EVENTS AND STREAM CHAT INTEGRATION

socket.on('opponent-move', (data) => {
  console.log("Opponent move received:", data);
  if (gameOver) return;
  board[data.row][data.col] = data.player;
  updateUI(data.row, data.col, data.player);

  if (checkWin(data.player)) {
    gameOver = true;
    setTimeout(() => {
      alert(`${data.player.toUpperCase()} wins!`);
      socket.emit('reset-game');
      resetGame();
    }, 100);
  } else if (isDraw()) {
    gameOver = true;
    setTimeout(() => {
      alert('Draw! Board is full.');
      socket.emit('reset-game');
      resetGame();
    }, 100);
  } else {
    currentPlayer = assignedPlayer;
    isMyTurn = assignedPlayer === currentPlayer;
  }
});

//REWRITE THIS CAUSE ROLES ARE ASSIGNED SERVER SIDE NOW
/*socket.on('assign-role', async (role) => {
  if (role === 'spectator') {
    alert('You are a spectator. You cannot make moves.');
  }
  assignedPlayer = role;
  currentPlayer = role;
});*/

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
  messageElem.textContent = `${username}: ${text}`;
  chatBox.appendChild(messageElem);
  chatBox.scrollTop = chatBox.scrollHeight;
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
    location.href = `board.html?roomId=${roomId}`;
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
  location.href = `board.html?roomId=${roomId}`;
  console.log('Chat connected');
} catch (err) {
  console.error('Error in connectToChat:', err);
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