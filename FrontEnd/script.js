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

function initializeBoard() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (gameOver || currentPlayer !== assignedPlayer) return;

      const col = parseInt(cell.dataset.col);
      const success = dropPiece(col, currentPlayer);

      if (success) {
        if (checkWin(currentPlayer)) {
          gameOver = true;
          alert(`${currentPlayer.toUpperCase()} wins!`);
        } else {
          currentPlayer = currentPlayer === PLAYER1 ? PLAYER2 : PLAYER1;
        }
      }
    });
  });
}

function dropPiece(col, player) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === EMPTY) {
      board[row][col] = player;
      updateUI(row, col, player);
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
      ? './FrontEnd/Assets/RedConnect4.png'
      : './FrontEnd/Assets/YellowConnect4.png';
    cell.style.backgroundImage = `url('${imagePath}')`;
  }
}

socket.on('opponent-move', (data) => {
  board[data.row][data.col] = data.player;
  updateUI(data.row, data.col, data.player);
  currentPlayer = assignedPlayer;
});

socket.on('assign-role', (role) => {
  assignedPlayer = role;
  currentPlayer = role;
  alert(`You are ${role.toUpperCase()}`);
});

socket.on('room-full', () => {
  alert('Room is full. Try again later.');
});

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

initializeBoard();