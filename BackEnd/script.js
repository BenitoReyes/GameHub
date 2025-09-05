// Constants
const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const PLAYER1 = 'red';
const PLAYER2 = 'yellow';

// Game State
let board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY)); // 6x7 board initialized to EMPTY and array is used to make checking for wins easier
let currentPlayer = PLAYER1; // will be changed to random later
let gameOver = false; // Flag to indicate if the game is over and starts as false if game just begins

// Initialize board event listeners into every cell rather than hardcoding them in the index.html file
function initializeBoard() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (gameOver) return;

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

// Drop a piece into the column
function dropPiece(col, player) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === EMPTY) {
      board[row][col] = player;
      updateUI(row, col, player);
      return true;
    }
  }
  return false; // Column is full
}

// Update the cells to mimic a piece dropping in
function updateUI(row, col, player) {
  const cell = document.querySelector(
    `.cell[data-row="${row}"][data-col="${col}"]`
  );
  if (cell) {
    const imagePath = player === 'red'
      ? '../Assets/RedConnect4.png'
      : '../Assets/YellowConnect4.png';
    cell.style.backgroundImage = `url('${imagePath}')`;
  }
}

// the win only checks for horizontal right now
function checkWin(player) {
  // Horizontal check
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

// Start the game
initializeBoard();