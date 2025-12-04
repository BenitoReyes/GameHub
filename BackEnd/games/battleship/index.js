import { grid, getInitialState as logicInitialState, validateAction as validateAttack, applyAction as applyAttack, applyLayoutToState, validateLayout, getResult as logicGetResult, SIZE, SHIP_DEFS } from '../../../FrontEnd/games/sinkEm/sinkEmLogic.js';

export default {
  name: 'battleship',
  metadata: { type: 'board', realtime: false, rows: 10, cols: 10 },

  getInitialState() {
    // leverage the logic's initial state
    return logicInitialState();
  },

  // validateAction should support both 'place' and 'attack' actions
  validateAction(board, action) {
    try {
      if (!action || !action.type) return false;
      if (action.type === 'place') {
        validateLayout(action.layout);
        return true;
      }
      if (action.type === 'attack') {
        return validateAttack(board, { x: action.x, y: action.y, player: action.player });
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  // applyAction returns either newBoard or an object { board, details }
  applyAction(board, action, ctx = {}) {
    if (!action || !action.type) return board;
    if (action.type === 'place') {
      // action.layout: apply ship positioning for player's color
      const color = ctx && ctx.userId && ctx.role ? ctx.role : (action.color || 'red');
      // applyLayoutToState returns a new state; server's board is stored as an object state in DB
      const fakeState = { ...board, ships: board.ships || { red: [], blue: [] }, red: board.red, blue: board.blue, turn: board.turn, phase: board.phase };
      const updated = applyLayoutToState(fakeState, color, action.layout);
      // Update the grid values (red/blue) and ships in returned board
      const newBoard = { red: updated.red, blue: updated.blue, ships: updated.ships, turn: updated.turn, phase: updated.phase, winner: updated.winner };
      return { board: newBoard };
    }
    if (action.type === 'attack') {
      const fakeState = { ...board, ships: board.ships || { red: [], blue: [] }, red: board.red, blue: board.blue, turn: board.turn, phase: board.phase };
      const applied = applyAttack(fakeState, { x: action.x, y: action.y, player: action.player });
      // determine hit/sunk from state differences
      const target = action.player === 'red' ? 'blue' : 'red';
      const wasHit = board[target] && board[target][action.y] && board[target][action.y][action.x] === 0 ? (applied[target][action.y][action.x] === 1) : false;
      // check if any ship sunk by looking for ship.sunk flag set by maybeMarkSunk
      let sunkShip = null;
      const layout = applied.ships[target] || [];
      for (const s of layout) { if (s.sunk) sunkShip = s.name; }
      const details = { hit: wasHit, sunk: sunkShip };
      const newBoard = { red: applied.red, blue: applied.blue, ships: applied.ships, turn: applied.turn, phase: applied.phase, winner: applied.winner };
      return { board: newBoard, details };
    }
    return board;
  },

  getResult(board) {
    return logicGetResult(board);
  },

  registerHTTP(app) {},
  async init({ io }) {
    // nothing special; server's generic handlers will call validate/apply via make-move
  }
};
