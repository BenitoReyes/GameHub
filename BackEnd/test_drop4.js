import { suggestMove } from './AI/drop4.js';

function emptyBoard() {
  return Array.from({ length: 6 }, () => Array(7).fill(null));
}

async function runTests() {
  console.log('Test 1: empty board — expect center or near-center');
  let board = emptyBoard();
  console.log('Suggestion:', await suggestMove(board, 'red', { depth: 4 }));

  console.log('\nTest 2: immediate win available for red on column 2');
  board = emptyBoard();
  // set up 3 in a row horizontally at bottom row cols 0-2 for red so dropping col 3 would win
  board[5][0] = 'red';
  board[5][1] = 'red';
  board[5][2] = 'red';
  console.log('Board bottom row:', board[5]);
  console.log('Suggestion (should be 3):', await suggestMove(board, 'red', { depth: 4 }));

  console.log('\nTest 3: opponent (blue) about to win in col 4, AI should block');
  board = emptyBoard();
  // set up blue three in a row vertically in col 4 rows 5,4,3 so placing at row2 (col4) would block
  board[5][4] = 'blue';
  board[4][4] = 'blue';
  board[3][4] = 'blue';
  console.log('Suggestion (should be 4):', await suggestMove(board, 'red', { depth: 4 }));
}

runTests().catch(err => console.error(err));
