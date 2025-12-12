import { suggestMove } from './AI/drop4.js';

function emptyBoard() {
  return Array.from({ length: 6 }, () => Array(7).fill(null));
}

// Simple test runner
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(`✗ ${name}`);
      console.error('   ', err.message);
    }
  }
  const total = tests.length;
  const percent = ((passed / total) * 100).toFixed(0);
  console.log(`\nSummary: ${passed}/${total} tests passed (${percent}%)`);
}

// --- Define tests ---
test('empty board — expect center or near-center', async () => {
  const board = emptyBoard();
  const move = await suggestMove(board, 'red', { depth: 4 });
  if (![2, 3, 4].includes(move)) {
    throw new Error(`Expected 2,3,4 but got ${move}`);
  }
});

test('immediate win available for red on column 3', async () => {
  const board = emptyBoard();
  board[5][0] = 'red';
  board[5][1] = 'red';
  board[5][2] = 'red';
  const move = await suggestMove(board, 'red', { depth: 4 });
  if (move !== 3) {
    throw new Error(`Expected 3 but got ${move}`);
  }
});

test('opponent about to win in col 4, AI should block', async () => {
  const board = emptyBoard();
  board[5][4] = 'blue';
  board[4][4] = 'blue';
  board[3][4] = 'blue';
  const move = await suggestMove(board, 'red', { depth: 4 });
  if (move !== 4) {
    throw new Error(`Expected 4 but got ${move}`);
  }
});

// --- Run all tests ---
run().catch(err => console.error(err));
