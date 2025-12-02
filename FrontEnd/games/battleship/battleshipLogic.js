// Pure game logic (no I/O). Designed to be used by the module and server.

export const SIZE = 10;

export const SHIP_DEFS = {
    Carrier: 5,
    Battleship: 4,
    Cruiser: 3,
    Submarine: 3,
    Destroyer: 2
};

export function getInitialState() {
    return {
        red: grid(),
        blue: grid(),
        ships: { red: [], blue: [] },
        turn: 'red',        // 'red' | 'blue'
        phase: 'placement', // 'waiting' | 'placement' | 'in-progress' | 'finished'
        winner: null
    };
}

export function grid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0)); // 0 empty, 1 hit, -1 miss
}

export function validateLayout(layout = []) {
    const expected = Object.keys(SHIP_DEFS).sort();
    const got = layout.map(l => l.name).sort();
    if (JSON.stringify(expected) !== JSON.stringify(got)) throw new Error('Place all ships exactly once');

    for (const item of layout) {
        if (!SHIP_DEFS[item.name]) throw new Error(`Unknown ship ${item.name}`);
        if (!['H', 'V'].includes(item.dir)) throw new Error('Invalid direction');
        if (!Number.isInteger(item.x) || !Number.isInteger(item.y)) throw new Error('Invalid coordinates');
        const size = SHIP_DEFS[item.name];
        const tailX = item.dir === 'H' ? item.x + size - 1 : item.x;
        const tailY = item.dir === 'V' ? item.y + size - 1 : item.y;
        if (item.x < 0 || item.y < 0 || tailX >= SIZE || tailY >= SIZE) throw new Error('Ship out of bounds');
    }
    const occupied = new Set();
    for (const s of layout) {
        const size = SHIP_DEFS[s.name];
        for (let i = 0; i < size; i++) {
        const cx = s.dir === 'H' ? s.x + i : s.x;
        const cy = s.dir === 'V' ? s.y + i : s.y;
        const key = `${cx},${cy}`;
        if (occupied.has(key)) throw new Error('Ships overlap');
        occupied.add(key);
        }
    }
}

export function applyLayoutToState(state, color, layout) {
    validateLayout(layout);
    const next = cloneState(state);
    next.ships[color] = layout.map(s => ({ ...s, sunk: false }));
    // If both placed, start game
    if ((next.ships.red?.length === 5) && (next.ships.blue?.length === 5)) {
        next.phase = 'in-progress';
        next.turn = 'red';
    }
    return next;
}

export function validateAction(state, action = {}) {
    const { x, y, player } = action;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return false;
    if (state.phase !== 'in-progress') return false;
    if (player !== 'red' && player !== 'blue') return false;
    if (state.turn !== player) return false;

    const target = player === 'red' ? 'blue' : 'red';
    const cell = state[target][y][x];
    // Can't attack an already targeted cell
    if (cell === 1 || cell === -1) return false;
    return true;
}

export function applyAction(state, action = {}) {
    const { x, y, player } = action;
    const target = player === 'red' ? 'blue' : 'red';
    const next = cloneState(state);

    // Compute hit/miss based on defender ships
    const hit = isHit(next.ships[target], x, y);
    next[target][y][x] = hit ? 1 : -1;

    // Update sunk flag if this attack completes a ship
    if (hit) {
        maybeMarkSunk(next, target, x, y);
    }

    // Toggle turn (simple rule: alternate every shot)
    next.turn = player === 'red' ? 'blue' : 'red';

    // Winner check
    const result = getResult(next);
    if (result?.winner) {
        next.phase = 'finished';
        next.winner = result.winner;
    }

    return next;
}

export function isHit(layout, x, y) {
    for (const s of layout || []) {
        const size = SHIP_DEFS[s.name];
        for (let i = 0; i < size; i++) {
        const cx = s.dir === 'H' ? s.x + i : s.x;
        const cy = s.dir === 'V' ? s.y + i : s.y;
        if (cx === x && cy === y) return true;
        }
    }
    return false;
}

export function maybeMarkSunk(state, defenderColor, x, y) {
    const layout = state.ships[defenderColor] || [];
    const targetShip = layout.find(s => {
        const size = SHIP_DEFS[s.name];
        for (let i = 0; i < size; i++) {
        const cx = s.dir === 'H' ? s.x + i : s.x;
        const cy = s.dir === 'V' ? s.y + i : s.y;
        if (cx === x && cy === y) return true;
        }
        return false;
    });
    if (!targetShip) return;

    // Check all cells of that ship are hit on defender board
    const size = SHIP_DEFS[targetShip.name];
    let allHit = true;
    for (let i = 0; i < size; i++) {
        const cx = targetShip.dir === 'H' ? targetShip.x + i : targetShip.x;
        const cy = targetShip.dir === 'V' ? targetShip.y + i : targetShip.y;
        if ((state[defenderColor][cy][cx] ?? 0) !== 1) { allHit = false; break; }
    }
    if (allHit) {
        targetShip.sunk = true;
    }
}

export function getResult(state) {
    const redAlive = hasAliveShips(state, 'red');
    const blueAlive = hasAliveShips(state, 'blue');
    if (!redAlive && blueAlive) return { winner: 'blue' };
    if (!blueAlive && redAlive) return { winner: 'red' };
    return null;
}

export function hasAliveShips(state, color) {
    const layout = state.ships[color] || [];
    if (!layout.length) return true; // not placed yet, game not decided
    for (const s of layout) {
        const size = SHIP_DEFS[s.name];
        for (let i = 0; i < size; i++) {
            const cx = s.dir === 'H' ? s.x + i : s.x;
            const cy = s.dir === 'V' ? s.y + i : s.y;
            if ((state[color][cy][cx] ?? 0) !== 1) {
                return true; // found a cell not yet hit → ship alive
            }
        }
    }
    return false; // all ship cells hit → no ships alive
}

function cloneState(state) {
    return {
        red: state.red.map(row => row.slice()),
        blue: state.blue.map(row => row.slice()),
        ships: {
        red: (state.ships.red || []).map(s => ({ ...s })),
        blue: (state.ships.blue || []).map(s => ({ ...s }))
        },
        turn: state.turn,
        phase: state.phase,
        winner: state.winner
    };
}
