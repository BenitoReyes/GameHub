// BackEnd/AI/drop4.js
// Connect Four AI module using Minimax with alpha-beta pruning
// Exports suggestMove(board, currentPlayer, options) function

const ROWS = 6;
const COLS = 7;

function cloneBoard(board) {
  return board.map(row => row.slice());
}

function getValidMoves(board) {
  const moves = [];
  for (let c = 0; c < COLS; c++) if (board[0][c] === null) moves.push(c);
  return moves;
}

function makeMove(board, col, player) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === null) {
      board[r][col] = player;
      return r;
    }
  }
  return -1;
}

function undoMove(board, col, row) {
  if (row >= 0) board[row][col] = null;
}

function checkWinner(board, player) {
  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if (board[r][c] === player && board[r][c + 1] === player && board[r][c + 2] === player && board[r][c + 3] === player)
        return true;
    }
  }
  // Vertical
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      if (board[r][c] === player && board[r + 1][c] === player && board[r + 2][c] === player && board[r + 3][c] === player)
        return true;
    }
  }
  // Diagonal down-right
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if (board[r][c] === player && board[r + 1][c + 1] === player && board[r + 2][c + 2] === player && board[r + 3][c + 3] === player)
        return true;
    }
  }
  // Diagonal down-left
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 3; c < COLS; c++) {
      if (board[r][c] === player && board[r + 1][c - 1] === player && board[r + 2][c - 2] === player && board[r + 3][c - 3] === player)
        return true;
    }
  }
  return false;
}

function evaluateWindow(window, player) {
  const opponent = player === 'red' ? 'blue' : 'red';
  let score = 0;
  const countPlayer = window.filter(x => x === player).length;
  const countOpponent = window.filter(x => x === opponent).length;
  const countEmpty = window.filter(x => x === null).length;

  if (countPlayer === 4) score += 10000;
  else if (countPlayer === 3 && countEmpty === 1) score += 100;
  else if (countPlayer === 2 && countEmpty === 2) score += 10;

  if (countOpponent === 3 && countEmpty === 1) score -= 80;
  else if (countOpponent === 2 && countEmpty === 2) score -= 5;

  return score;
}

function scorePosition(board, player) {
  let score = 0;
  // Center preference
  const center = Math.floor(COLS / 2);
  let centerCount = 0;
  for (let r = 0; r < ROWS; r++) if (board[r][center] === player) centerCount++;
  score += centerCount * 6;

  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const window = [board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3]];
      score += evaluateWindow(window, player);
    }
  }
  // Vertical
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      const window = [board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]];
      score += evaluateWindow(window, player);
    }
  }
  // Diagonal down-right
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const window = [board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]];
      score += evaluateWindow(window, player);
    }
  }
  // Diagonal down-left
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 3; c < COLS; c++) {
      const window = [board[r][c], board[r + 1][c - 1], board[r + 2][c - 2], board[r + 3][c - 3]];
      score += evaluateWindow(window, player);
    }
  }

  return score;
}

function isTerminalNode(board) {
  return checkWinner(board, 'red') || checkWinner(board, 'blue') || getValidMoves(board).length === 0;
}

function minimax(board, depth, alpha, beta, maximizingPlayer, aiPlayer) {
  const validMoves = getValidMoves(board);
  const opponent = aiPlayer === 'red' ? 'blue' : 'red';

  if (depth === 0 || isTerminalNode(board)) {
    if (checkWinner(board, aiPlayer)) return { score: 1000000 };
    if (checkWinner(board, opponent)) return { score: -1000000 };
    return { score: scorePosition(board, aiPlayer) };
  }

  if (maximizingPlayer) {
    let value = -Infinity;
    let bestCol = validMoves[0] || -1;
    for (const col of validMoves) {
      const row = makeMove(board, col, aiPlayer);
      const result = minimax(board, depth - 1, alpha, beta, false, aiPlayer);
      undoMove(board, col, row);
      if (result.score > value) {
        value = result.score;
        bestCol = col;
      }
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return { score: value, column: bestCol };
  } else {
    let value = Infinity;
    let bestCol = validMoves[0] || -1;
    for (const col of validMoves) {
      const row = makeMove(board, col, opponent);
      const result = minimax(board, depth - 1, alpha, beta, true, aiPlayer);
      undoMove(board, col, row);
      if (result.score < value) {
        value = result.score;
        bestCol = col;
      }
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return { score: value, column: bestCol };
  }
}

export async function suggestMove(board, currentPlayer, options = {}) {
  const depth = options.depth || 5;
  const aiPlayer = currentPlayer;

  const valid = getValidMoves(board);

  // Check for immediate win
  for (const col of valid) {
    const row = makeMove(board, col, aiPlayer);
    if (checkWinner(board, aiPlayer)) {
      undoMove(board, col, row);
      return col;
    }
    undoMove(board, col, row);
  }

  // Block opponent immediate win
  const opponent = aiPlayer === 'red' ? 'blue' : 'red';
  for (const col of valid) {
    const row = makeMove(board, col, opponent);
    if (checkWinner(board, opponent)) {
      undoMove(board, col, row);
      return col;
    }
    undoMove(board, col, row);
  }

  // Prefer moves near center
  valid.sort((a, b) => Math.abs(a - Math.floor(COLS / 2)) - Math.abs(b - Math.floor(COLS / 2)));

  let bestScore = -Infinity;
  let bestCol = valid[0] || -1;
  for (const col of valid) {
    const row = makeMove(board, col, aiPlayer);
    const result = minimax(board, depth - 1, -Infinity, Infinity, false, aiPlayer);
    undoMove(board, col, row);
    if (result.score > bestScore) {
      bestScore = result.score;
      bestCol = col;
    }
  }

  return bestCol;
}

export default { suggestMove };

// Self-test if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  function emptyBoard() {
    return Array.from({ length: 6 }, () => Array(7).fill(null));
  }

  async function runTests() {
    console.log('=== Drop4 AI Self-Test ===');

    let board = emptyBoard();
    console.log('Empty board suggestion:', await suggestMove(board, 'red', { depth: 4 }));

    board[5][0] = 'red';
    board[5][1] = 'red';
    board[5][2] = 'red';
    console.log('Immediate win suggestion (should be 3):', await suggestMove(board, 'red', { depth: 4 }));

    board = emptyBoard();
    board[5][4] = 'blue';
    board[4][4] = 'blue';
    board[3][4] = 'blue';
    console.log('Block opponent (should be 4):', await suggestMove(board, 'red', { depth: 4 }));

    console.log('Self-test complete.');
  }

  runTests().catch(err => console.error(err));
}
