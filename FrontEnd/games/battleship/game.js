import { getSocket } from '../commonLogic/socket.js';

// Global handlers for button clicks
window.__battleshipToggleDir = function() {
    if ((state.role === 'red' || state.role === 'blue') && state.phase === 'placement') {
        state.placement.dir = state.placement.dir === 'H' ? 'V' : 'H';
        render();
    }
};

window.__battleshipSubmitShips = function() {
    submitShips();
};

const SIZE = 10;
const SHIPS = [
    { name: 'Carrier', size: 5 },
    { name: 'Battleship', size: 4 },
    { name: 'Cruiser', size: 3 },
    { name: 'Submarine', size: 3 },
    { name: 'Destroyer', size: 2 }
];

const state = {
    roomId: null,
    role: null,            // 'red' | 'blue' | 'spectator'
    phase: 'placement',    // derived from board
    turn: 'red',
    winner: null,
    ownBoard: board(),
    oppFog: board(),
    placement: { dir: 'H', ships: SHIPS, placed: [] }
};

function board() {
    return Array.from({ length: SIZE }, () =>
        Array.from({ length: SIZE }, () => ({ ship: false, hit: false, miss: false }))
    );
}

function byId(id) { return document.getElementById(id); }

function render() {
    const root = byId('board');
    if (!root) return;

    const phaseLabel = state.winner ? `FINISHED (Winner: ${state.winner})` : state.phase.toUpperCase();

    root.innerHTML = `
        <div class="status-bar">
        <span>Role: ${state.role || 'unknown'}</span>
        <span>Phase: ${phaseLabel}</span>
        <span>Turn: ${state.turn}</span>
        </div>
        <div class="boards-wrapper">
        <div class="board-section">
            <h2>Your Fleet</h2>
            <div id="own" class="grid-board"></div>
            <div class="controls">
            <button id="toggleDir" class="pixel-btn" onclick="window.__battleshipToggleDir?.()">Orientation: ${state.placement.dir}</button>
            <button id="submitShips" class="pixel-btn" onclick="window.__battleshipSubmitShips?.()">Submit Ships</button>
            </div>
        </div>
        <div class="board-section">
            <h2>Enemy Waters</h2>
            <div id="opp" class="grid-board"></div>
        </div>
        </div>
        <div id="status" class="status-msg"></div>
    `;

    const own = byId('own');
    const opp = byId('opp');

    // Clear containers before repopulating
    own.innerHTML = '';
    opp.innerHTML = '';

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
        const oc = document.createElement('div');
        oc.className = 'cell';
        const o = state.ownBoard[y][x];
        if (o.ship) oc.classList.add('ship');
        if (o.hit) oc.classList.add('hit');
        if (o.miss) oc.classList.add('miss');
        // Only allow placement if player has an assigned role and is in placement phase
        if ((state.role === 'red' || state.role === 'blue') && state.phase === 'placement') {
            oc.onclick = () => placeShipInteractive(x, y);
        } else {
            oc.onclick = null;
        }
        own.appendChild(oc);

        const pc = document.createElement('div');
        pc.className = 'cell';
        const p = state.oppFog[y][x];
        if (p.hit) pc.classList.add('hit');
        if (p.miss) pc.classList.add('miss');
        // Only allow attack interaction if in-progress, this client is a player, and it is their turn
        if ((state.role === 'red' || state.role === 'blue') && state.phase === 'in-progress' && state.turn === state.role) {
            pc.onclick = () => tryAttack(x, y);
        } else {
            pc.onclick = null;
        }
        opp.appendChild(pc);
        }
    }

    // Update button disabled state based on role/phase
    setTimeout(() => {
        const toggleBtn = byId('toggleDir');
        if (toggleBtn) {
            if ((state.role === 'red' || state.role === 'blue') && state.phase === 'placement') {
                toggleBtn.removeAttribute('disabled');
            } else {
                toggleBtn.setAttribute('disabled', 'disabled');
            }
        }

        const submitBtn = byId('submitShips');
        if (submitBtn) {
            if ((state.role === 'red' || state.role === 'blue') && state.phase === 'placement') {
                submitBtn.removeAttribute('disabled');
            } else {
                submitBtn.setAttribute('disabled', 'disabled');
            }
        }
    }, 0);
}


function setStatus(msg) {
    const el = byId('status');
    if (el) el.textContent = msg;
}

function coords(x, y, size, dir) {
    const out = [];
    for (let i = 0; i < size; i++) {
        const cx = dir === 'H' ? x + i : x;
        const cy = dir === 'V' ? y + i : y;
        if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) return null;
        out.push({ x: cx, y: cy });
    }
    return out;
}

function placeShipInteractive(x, y) {
    // Only allow placement in placement phase
    if (state.phase !== 'placement') return setStatus('Not in placement phase.');
    // Only player roles (red/blue) can place, not spectators
    if (!state.role || state.role === 'spectator') return setStatus('Only a player can place ships.');
    
    const remaining = state.placement.ships.filter(s => !state.placement.placed.find(p => p.name === s.name));
    if (!remaining.length) return setStatus('All ships placed. Submit.');
    
    const next = remaining[0];
    const c = coords(x, y, next.size, state.placement.dir);
    if (!c) return setStatus('Out of bounds.');
    if (c.some(k => state.ownBoard[k.y][k.x].ship)) return setStatus('Overlap.');
    
    // Place locally
    for (const k of c) state.ownBoard[k.y][k.x].ship = true;
    state.placement.placed.push({ name: next.name, x, y, dir: state.placement.dir });
    setStatus(`Placed ${next.name}. ${remaining.length - 1} remaining.`);
    render();
}

function applySyncBoard(board) {
    // Always update phase/turn/winner
    state.phase = board.phase || 'placement';
    state.turn = board.turn || 'red';
    state.winner = board.winner ?? null;

    // If role is known, update boards from proper perspective
    if (state.role === 'red') {
        state.ownBoard = hydrateBoardWithShips(board.ships?.red, board.red);
        state.oppFog = hydrateFog(board.blue);
        state.placement.placed = board.ships?.red?.map(s => ({ name: s.name, x: s.x, y: s.y, dir: s.dir })) || [];
    } else if (state.role === 'blue') {
        state.ownBoard = hydrateBoardWithShips(board.ships?.blue, board.blue);
        state.oppFog = hydrateFog(board.red);
        state.placement.placed = board.ships?.blue?.map(s => ({ name: s.name, x: s.x, y: s.y, dir: s.dir })) || [];
    } else {
        // Role not set yet, default to red perspective to avoid showing empty boards
        state.ownBoard = hydrateBoardWithShips(board.ships?.red, board.red);
        state.oppFog = hydrateFog(board.blue);
    }
}

function hydrateBoardWithShips(layout = [], hitsMissesGrid) {
    const b = board();
    for (const s of layout || []) {
        const size = SHIPS.find(d => d.name === s.name)?.size || 0;
        for (let i = 0; i < size; i++) {
        const cx = s.dir === 'H' ? s.x + i : s.x;
        const cy = s.dir === 'V' ? s.y + i : s.y;
        b[cy][cx].ship = true;
        }
    }
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const v = hitsMissesGrid?.[y]?.[x] ?? 0;
        if (v === 1) b[y][x].hit = true;
        if (v === -1) b[y][x].miss = true;
    }
    return b;
}

function hydrateFog(targetGrid) {
    const b = board();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const v = targetGrid?.[y]?.[x] ?? 0;
        if (v === 1) b[y][x].hit = true;
        if (v === -1) b[y][x].miss = true;
    }
    return b;
}

function submitShips() {
    if (state.phase !== 'placement') return setStatus('Not in placement.');
    if (state.role === 'spectator') return setStatus('Spectators cannot submit ships.');
    const missing = SHIPS.filter(s => !state.placement.placed.find(p => p.name === s.name));
    if (missing.length) return setStatus(`Place all ships: ${missing.map(m => m.name).join(', ')}`);
    const socket = getSocket();
    socket.emit('place-ships', { roomId: state.roomId, layout: state.placement.placed });
        setStatus('Submitted. Waiting for opponent.');
        // disable further placement until server syncs
        state.phase = 'waiting';
        render();
}

function tryAttack(x, y) {
    if (state.phase !== 'in-progress') return;
    if (state.role === 'spectator') return setStatus('Spectators cannot attack.');
    if (state.turn !== state.role) return setStatus('Not your turn.');
    const fog = state.oppFog[y][x];
    if (fog.hit || fog.miss) return setStatus('Already targeted.');
    const socket = getSocket();
    socket.emit('attack', { roomId: state.roomId, x, y });
}


export default {
    name: 'battleship',
    metadata: { type: 'board', realtime: false },

    async init({ roomId, userId, token, role, username } = {}) {
    const socket = getSocket();
    state.roomId = roomId;
    state.role = role || null;  // Initialize from parameter
    state.phase = 'placement';

    // Set initial role if provided
    if (role) {
        render();
    }

    socket.on('assign-role', (r) => {
        state.role = r;
        const uname = username || sessionStorage.getItem('username') || 'Player';
        socket.emit('player-joined', { roomId: state.roomId, role: r, username: uname });
        render();
    });

    socket.on('game-joined', ({ role: r }) => {
        state.role = r;
        const uname = username || sessionStorage.getItem('username') || 'Player';
        socket.emit('player-joined', { roomId: state.roomId, role: r, username: uname });
        render();
    });

    // Fallback if role not assigned quickly
    setTimeout(() => {
        if (!state.role) socket.emit('join-game', roomId);
    }, 300);

    socket.emit('join-room', roomId);
    socket.emit('request-board', roomId);

    socket.on('sync-board', (board) => {
        applySyncBoard(board);
        render();
    });

    // server ack for placement to force a board refresh and unlock UI
    socket.on('placed-ships', ({ success } = {}) => {
        if (success) {
            setStatus('Ships placed (server confirmed). Waiting for opponent.');
            // after ack request latest board
            socket.emit('request-board', state.roomId);
            // move to waiting state until both placed
            state.phase = 'waiting';
            render();
        }
    });

    socket.on('attack-result', ({ hit, sunk }) => {
        // show who got hit - use local role to determine perspective
        const msg = hit ? (sunk ? `Hit and sunk ${sunk}!` : 'Hit!') : 'Miss.';
        setStatus(msg);
        // refresh board after attack-result
        socket.emit('request-board', state.roomId);
    });

    socket.on('game-over', ({ winner }) => {
        state.winner = winner;
        state.phase = 'finished';
        setStatus(`Game over. Winner: ${winner}`);
        render();
    });

    socket.on('action-error', ({ message }) => setStatus(`Error: ${message}`));

    render();
    }
};

