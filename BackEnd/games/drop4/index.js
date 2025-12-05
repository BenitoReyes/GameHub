import { suggestMove as suggestDrop4 } from '../../AI/drop4.js';

export default {
  name: 'drop4',
  metadata: { type: 'board', realtime: false, rows: 6, cols: 7 },

  getInitialState() {
    return Array.from({ length: 6 }, () => Array(7).fill(0));
  },

  validateAction(board, action = {}, ctx = {}) {
    const { col } = action;
    if (typeof col !== 'number') return false;
    if (col < 0 || col >= 7) return false;
    // check for space in column
    for (let r = board.length - 1; r >= 0; r--) {
      if (board[r][col] === 0) return true;
    }
    return false;
  },

  applyAction(board, action = {}, ctx = {}) {
    const { col, player } = action;
    const newBoard = board.map(row => row.slice());
    for (let r = newBoard.length - 1; r >= 0; r--) {
      if (newBoard[r][col] === 0) {
        newBoard[r][col] = player;
        break;
      }
    }
    return newBoard;
  },

  // Determine if the given board is a win for a player or a draw.
  // Returns { winner: 'red'|'blue'|null, draw: boolean }
  getResult(board) {
    const PLAYER1 = 'red';
    const PLAYER2 = 'blue';
    const ROWS = board.length;
    const COLS = board[0].length;

    function check(player) {
      // horiz
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c <= COLS - 4; c++) {
          if (
            board[r][c] === player &&
            board[r][c + 1] === player &&
            board[r][c + 2] === player &&
            board[r][c + 3] === player
          ) return true;
        }
      }
      // vert
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r <= ROWS - 4; r++) {
          if (
            board[r][c] === player &&
            board[r + 1][c] === player &&
            board[r + 2][c] === player &&
            board[r + 3][c] === player
          ) return true;
        }
      }
      // diag up
      for (let r = 3; r < ROWS; r++) {
        for (let c = 0; c <= COLS - 4; c++) {
          if (
            board[r][c] === player &&
            board[r - 1][c + 1] === player &&
            board[r - 2][c + 2] === player &&
            board[r - 3][c + 3] === player
          ) return true;
        }
      }
      // diag down
      for (let r = 0; r <= ROWS - 4; r++) {
        for (let c = 0; c <= COLS - 4; c++) {
          if (
            board[r][c] === player &&
            board[r + 1][c + 1] === player &&
            board[r + 2][c + 2] === player &&
            board[r + 3][c + 3] === player
          ) return true;
        }
      }
      return false;
    }

    if (check(PLAYER1)) return { winner: PLAYER1, draw: false };
    if (check(PLAYER2)) return { winner: PLAYER2, draw: false };
    // check draw (no zeros)
    const isFull = board.every(row => row.every(cell => cell !== 0 && cell !== null));
    return { winner: null, draw: isFull };
  }
,

  // Optional: register module-specific endpoints
  registerHTTP(app, { prisma, serverClient } = {}) {
    app.post('/api/drop4/suggest', async (req, res) => {
      try {
        const { board, currentPlayer, depth } = req.body;
        const useDepth = typeof depth === 'number' ? depth : 5;
        const column = await suggestDrop4(board, currentPlayer, { depth: useDepth });
        res.json({ column });
      } catch (error) {
        console.error('Error in /api/drop4/suggest:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
};
