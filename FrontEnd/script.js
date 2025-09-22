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

function checkWin(player) {
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
  alert(`You are ${role.toUpperCase()}`);
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