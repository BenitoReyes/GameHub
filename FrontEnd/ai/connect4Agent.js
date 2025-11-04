// Client-side Connect4 AI agent (module)
// Save this as: ai/connect4Agent.js
// Exports: suggestMove(board, player, difficulty) and getAIMove(board, player, difficulty)
// Board format expected: 6 rows x 7 cols, top row index 0, values: 0 for empty, or 'red'/'blue' for players

function cloneBoard(board) {
  return board.map(row => row.slice());
}

function validMoves(board) {
  const cols = board[0].length;
  const moves = [];
  for (let c = 0; c < cols; c++) {
    if (board[0][c] === 0) moves.push(c);
  }
  return moves;
}

function makeMove(board, col, player) {
  const rows = board.length;
  const newB = cloneBoard(board);
  for (let r = rows - 1; r >= 0; r--) {
    if (newB[r][col] === 0) {
      newB[r][col] = player;
      return { board: newB, row: r };
    }
  }
  return null; // column full
}

function checkWindowScore(window, player) {
  const opponent = player === 'red' ? 'blue' : 'red';
  let score = 0;
  const countPlayer = window.filter(x => x === player).length;
  const countOpp = window.filter(x => x === opponent).length;
  const countEmpty = window.filter(x => x === 0).length;

  // Winning positions
  if (countPlayer === 4) score += 10000;
  else if (countPlayer === 3 && countEmpty === 1) score += 50;
  else if (countPlayer === 2 && countEmpty === 2) score += 10;

  // Blocking opponent
  if (countOpp === 3 && countEmpty === 1) score -= 80;
  if (countOpp === 2 && countEmpty === 2) score -= 8;

  return score;
}

function evaluateBoard(board, player) {
  const rows = board.length;
  const cols = board[0].length;
  let score = 0;

  // Center column preference
  const centerCol = Math.floor(cols / 2);
  for (let r = 0; r < rows; r++) {
    if (board[r][centerCol] === player) score += 6;
  }

  // Check horizontal windows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols - 4; c++) {
      const window = [board[r][c], board[r][c+1], board[r][c+2], board[r][c+3]];
      score += checkWindowScore(window, player);
    }
  }

  // Check vertical windows
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= rows - 4; r++) {
      const window = [board[r][c], board[r+1][c], board[r+2][c], board[r+3][c]];
      score += checkWindowScore(window, player);
    }
  }

  // Check diagonal windows (down-right)
  for (let r = 0; r <= rows - 4; r++) {
    for (let c = 0; c <= cols - 4; c++) {
      const window = [board[r][c], board[r+1][c+1], board[r+2][c+2], board[r+3][c+3]];
      score += checkWindowScore(window, player);
    }
  }

  // Check diagonal windows (up-right)
  for (let r = 3; r < rows; r++) {
    for (let c = 0; c <= cols - 4; c++) {
      const window = [board[r][c], board[r-1][c+1], board[r-2][c+2], board[r-3][c+3]];
      score += checkWindowScore(window, player);
    }
  }

  return score;
}

function isTerminalNode(board) {
  const rows = board.length;
  const cols = board[0].length;
  
  const checkWinPlayer = (player) => {
    // Horizontal
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols - 4; c++) {
        if (board[r][c] === player && board[r][c+1] === player && 
            board[r][c+2] === player && board[r][c+3] === player) return true;
      }
    }
    // Vertical
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r <= rows - 4; r++) {
        if (board[r][c] === player && board[r+1][c] === player && 
            board[r+2][c] === player && board[r+3][c] === player) return true;
      }
    }
    // Diagonal down-right
    for (let r = 0; r <= rows - 4; r++) {
      for (let c = 0; c <= cols - 4; c++) {
        if (board[r][c] === player && board[r+1][c+1] === player && 
            board[r+2][c+2] === player && board[r+3][c+3] === player) return true;
      }
    }
    // Diagonal up-right
    for (let r = 3; r < rows; r++) {
      for (let c = 0; c <= cols - 4; c++) {
        if (board[r][c] === player && board[r-1][c+1] === player && 
            board[r-2][c+2] === player && board[r-3][c+3] === player) return true;
      }
    }
    return false;
  };

  if (checkWinPlayer('red') || checkWinPlayer('blue')) return true;
  return validMoves(board).length === 0;
}

function minimax(board, depth, alpha, beta, maximizingPlayer, player, startTime, timeBudgetMs) {
  const now = Date.now();
  if (timeBudgetMs && now - startTime > timeBudgetMs) {
    throw new Error('timeout');
  }

  const validCols = validMoves(board);
  const isTerminal = isTerminalNode(board);
  
  if (depth === 0 || isTerminal) {
    if (isTerminal) {
      const scoreRed = evaluateBoard(board, 'red');
      const scoreBlue = evaluateBoard(board, 'blue');
      const terminalScore = (player === 'red' ? scoreRed - scoreBlue : scoreBlue - scoreRed);
      return { score: terminalScore, col: null };
    }
    const score = evaluateBoard(board, player);
    return { score, col: null };
  }

  if (maximizingPlayer) {
    let value = -Infinity;
    let bestCol = validCols[Math.floor(Math.random() * validCols.length)];
    
    for (const col of validCols) {
      const res = makeMove(board, col, player);
      if (!res) continue;
      
      try {
        const child = minimax(res.board, depth - 1, alpha, beta, false, player, startTime, timeBudgetMs);
        if (child.score > value) {
          value = child.score;
          bestCol = col;
        }
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break; // Alpha-beta pruning
      } catch (e) {
        if (e.message === 'timeout') throw e;
        throw e;
      }
    }
    return { score: value, col: bestCol };
  } else {
    const opponent = player === 'red' ? 'blue' : 'red';
    let value = Infinity;
    let bestCol = validCols[Math.floor(Math.random() * validCols.length)];
    
    for (const col of validCols) {
      const res = makeMove(board, col, opponent);
      if (!res) continue;
      
      try {
        const child = minimax(res.board, depth - 1, alpha, beta, true, player, startTime, timeBudgetMs);
        if (child.score < value) {
          value = child.score;
          bestCol = col;
        }
        beta = Math.min(beta, value);
        if (alpha >= beta) break; // Alpha-beta pruning
      } catch (e) {
        if (e.message === 'timeout') throw e;
        throw e;
      }
    }
    return { score: value, col: bestCol };
  }
}

function difficultyToDepth(difficulty) {
  switch (difficulty || 'medium') {
    case 'easy':
      // Easy: Shorter time budget, lower depth, more random
      return { depth: 2, timeBudget: 600, randomFactor: 0.3 };
    case 'medium':
      // Medium: Balanced settings
      return { depth: 4, timeBudget: 1200, randomFactor: 0.1 };
    case 'hard':
      // Hard: Deep search, longer thinking time, purely strategic
      return { depth: 6, timeBudget: 2000, randomFactor: 0 };
    default:
      return { depth: 4, timeBudget: 1200, randomFactor: 0.1 };
  }
}

/**
 * Get a quick suggestion for the player's next move
 * @param {Array} board - 6x7 board array
 * @param {string} player - 'red' or 'blue'
 * @param {string} difficulty - 'easy', 'medium', or 'hard'
 * @returns {number} - column index (0-6)
 */
export function suggestMove(board, player, difficulty = 'medium') {
  const cols = validMoves(board);
  if (cols.length === 0) return null;
  
  const depth = Math.max(1, Math.min(3, difficultyToDepth(difficulty)));
  
  try {
    const res = minimax(board, depth, -Infinity, Infinity, true, player, Date.now(), 400);
    return res.col;
  } catch (e) {
    // Fallback to random move
    return cols[Math.floor(Math.random() * cols.length)];
  }
}

/**
 * Get the AI's best move using iterative deepening
 * @param {Array} board - 6x7 board array
 * @param {string} player - 'red' or 'blue'
 * @param {string} difficulty - 'easy', 'medium', or 'hard'
 * @param {number} timeBudgetMs - time budget in milliseconds
 * @returns {number} - column index (0-6)
 */
export function getAIMove(board, player, difficulty = 'medium', timeBudgetMs = 1200) {
  const start = Date.now();
  const validCols = validMoves(board);
  
  if (validCols.length === 0) return null;
  
  const settings = difficultyToDepth(difficulty);
  const actualBudget = Math.min(timeBudgetMs, settings.timeBudget);
  
  // For easy mode, sometimes make random moves
  if (Math.random() < settings.randomFactor) {
    return validCols[Math.floor(Math.random() * validCols.length)];
  }
  
  let best = validCols[Math.floor(Math.random() * validCols.length)];
  let bestScore = -Infinity;
  const maxDepth = settings.depth;
  
  // Iterative deepening with difficulty-based parameters
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const res = minimax(board, depth, -Infinity, Infinity, true, player, start, actualBudget);
      if (res && typeof res.col === 'number') {
        // For easy/medium, don't always take the absolute best move
        if (res.score > bestScore || Math.random() > settings.randomFactor) {
          best = res.col;
          bestScore = res.score;
        }
      }
      // Break early if we found a winning move, except in easy mode
      if (difficulty !== 'easy' && Math.abs(res.score) > 9000) break;
    } catch (e) {
      if (e.message === 'timeout') break;
      throw e;
    }
    // Safety check on time
    if (Date.now() - start > actualBudget) break;
  }
  
  return best;
}

// Default export for convenience
export default { suggestMove, getAIMove };