export default {
  name: 'battleship',
  metadata: { type: 'board', realtime: false, rows: 10, cols: 10 },

  getInitialState() {
    // Represent each player's board and ships
    return {
      red: Array.from({ length: 10 }, () => Array(10).fill(0)),
      blue: Array.from({ length: 10 }, () => Array(10).fill(0)),
      ships: {},
      turn: 'red'
    };
  },

  validateAction(state, action = {}, ctx = {}) {
    // Basic validation: must include target and coordinates
    const { x, y } = action;
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (x < 0 || x >= 10 || y < 0 || y >= 10) return false;
    return true;
  },

  applyAction(state, action = {}, ctx = {}) {
    // Simple shot handling: mark cell as hit (1) or miss (-1)
    const { x, y, player } = action;
    const newState = JSON.parse(JSON.stringify(state));
    // Determine target board: if player shoots blue board if they are red.
    const target = player === 'red' ? 'blue' : 'red';
    if (newState && newState[target]) {
      newState[target][y][x] = newState[target][y][x] === 0 ? -1 : 1; // -1 miss, 1 hit (simplified)
    }
    // toggle turn
    newState.turn = player === 'red' ? 'blue' : 'red';
    return newState;
  },

  registerHTTP(app) {
    // Optional: register Battleship AI endpoints or hints
  }
};
