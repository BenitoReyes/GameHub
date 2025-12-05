import { getSocket } from '../commonLogic/socket.js';
import { showAlert } from '../commonLogic/ui.js';
import { initChat } from '../commonLogic/chat.js';

const socket = getSocket();

// --- Constants ---
const SIZE = 10;
const SHIPS = [
    { name: 'Carrier', size: 5 },
    { name: 'Warship', size: 4 },
    { name: 'Cruiser', size: 3 },
    { name: 'Submarine', size: 3 },
    { name: 'Destroyer', size: 2 }
];

// --- State ---
const state = {
    roomId: null,
    userId: null,
    token: null,
    username: 'Player',
    role: null, // 'red' | 'blue' | 'spectator' | null
    phase: 'placement',
    turn: 'red',
    winner: null,
    status: '',
    synced: false,
    placement: { placed: [], dir: 'H' },
    rawRed: null,
    rawBlue: null,
    shipsRed: [],
    shipsBlue: [],
    oppFog: null,
    ownBoard: null,
    redScore: 0,
    blueScore: 0,
    lastPlayers: {}
};



// --- Sync handshake tunables ---
const SYNC_RETRY_MS = 1500;
const MAX_SYNC_ATTEMPTS = 6;
let _syncRetryTimer = null;
let _syncAttempts = 0;

// --- Helpers ---
function byId(id) { return document.getElementById(id); }

window.__sinkEmToggleDir = function () {
    if ((state.role === 'red' || state.role === 'blue') && state.phase === 'placement') {
        state.placement.dir = state.placement.dir === 'H' ? 'V' : 'H';
        render();
    }
};

window.__sinkEmSubmitShips = function () {
    submitShips();
};

function isPlacedAt(layout = [], x, y) {
    for (const s of layout) {
        const size = SHIPS.find(d => d.name === s.name)?.size || 0;
        for (let i = 0; i < size; i++) {
        const cx = s.dir === 'H' ? s.x + i : s.x;
        const cy = s.dir === 'V' ? s.y + i : s.y;
        if (cx === x && cy === y) return true;
        }
    }
    return false;
}

function buildShipCells(x, y, size, dir) {
    const cells = [];
    for (let i = 0; i < size; i++) {
        const cx = dir === 'H' ? x + i : x;
        const cy = dir === 'V' ? y + i : y;
        if (cx >= SIZE || cy >= SIZE) return null;
        cells.push({ x: cx, y: cy });
    }
    return cells;
}

function board() {
    return Array.from({ length: SIZE }, () =>
        Array.from({ length: SIZE }, () => ({ ship: false, hit: false, miss: false }))
    );
}

function hydrateBoardWithShips(layout = [], hitsMissesGrid) {
    const b = board();
    for (const s of layout) {
        const size = SHIPS.find(d => d.name === s.name)?.size || 0;
        for (let i = 0; i < size; i++) {
        const cx = s.dir === 'H' ? s.x + i : s.x;
        const cy = s.dir === 'V' ? s.y + i : s.y;
        b[cy][cx].ship = true;
        }
    }
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
        const v = hitsMissesGrid?.[y]?.[x] ?? 0;
        if (v === 1) b[y][x].hit = true;
        if (v === -1) b[y][x].miss = true;
        }
    }
    return b;
}

function hydrateFog(targetGrid) {
    const b = board();
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
        const v = targetGrid?.[y]?.[x] ?? 0;
        if (v === 1) b[y][x].hit = true;
        if (v === -1) b[y][x].miss = true;
        }
    }
    return b;
}

// --- Status ---
function setStatus(msg) {
    state.status = msg;
    const el = byId('status');
    if (el) el.textContent = msg;
    state.lastStatusTime = Date.now();
}

function clearOldStatus() {
    if (state.phase === 'finished') return;
    if (Date.now() - state.lastStatusTime > 5000) {
        const el = byId('status');
        if (el && el.textContent) el.textContent = '';
    }
}

// --- Sync board from server ---
function applySyncBoard(serverBoard) {
    state.phase = serverBoard.phase === 'in-progress' ? 'battle' : (serverBoard.phase || 'placement');
    state.turn = serverBoard.turn || 'red';
    state.winner = serverBoard.winner ?? null;
    state.synced = true;

    state.rawRed = serverBoard.red || Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    state.rawBlue = serverBoard.blue || Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    state.shipsRed = serverBoard.ships?.red || [];
    state.shipsBlue = serverBoard.ships?.blue || [];

    if (state.role === 'red') {
        state.placement.placed = state.shipsRed.map(s => ({ name: s.name, x: s.x, y: s.y, dir: s.dir }));
    } else if (state.role === 'blue') {
        state.placement.placed = state.shipsBlue.map(s => ({ name: s.name, x: s.x, y: s.y, dir: s.dir }));
    } else {
        state.placement.placed = [];
    }

    if (state.role === 'red') state.ownBoard = hydrateBoardWithShips(state.shipsRed, state.rawRed);
    else if (state.role === 'blue') state.ownBoard = hydrateBoardWithShips(state.shipsBlue, state.rawBlue);
    else state.ownBoard = hydrateBoardWithShips([], []);

    if (state.role === 'red') state.oppFog = hydrateFog(state.rawBlue);
    else if (state.role === 'blue') state.oppFog = hydrateFog(state.rawRed);
    else state.oppFog = hydrateBoardWithShips(state.shipsBlue.concat(state.shipsRed), []);
}

function systemMessage(text) {
    const messagesEl = byId('chatMessages');
    if (!messagesEl) return;
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg system';
    msgEl.textContent = `★ SYSTEM: ${text}`;
    messagesEl.appendChild(msgEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Placement interaction ---
function placeShipInteractive(x, y, owner) {
    if (state.phase !== 'placement') return setStatus('Not in placement phase.');
    if (!state.role || state.role === 'spectator') return setStatus('Only a player can place ships.');
    if (owner !== state.role) return setStatus('You can only place on your side of the board.');

    const remaining = SHIPS.filter(s => !state.placement.placed.find(p => p.name === s.name));
    if (!remaining.length) return setStatus('All ships placed. Submit.');

    const next = remaining[0];
    const c = coords(x, y, next.size, state.placement.dir);
    if (!c) return setStatus('Out of bounds.');
    for (const k of c) {
        if (isPlacedAt(state.placement.placed, k.x, k.y)) return setStatus('Overlap.');
    }

    state.placement.placed.push({ name: next.name, x, y, dir: state.placement.dir });
    setStatus(`Placed ${next.name}. ${remaining.length - 1} remaining.`);
    render();
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

function submitShips() {
    if (state.phase !== 'placement') return setStatus('Not in placement.');
    if (state.role === 'spectator') return setStatus('Spectators cannot submit ships.');
    const missing = SHIPS.filter(s => !state.placement.placed.find(p => p.name === s.name));
    if (missing.length) return setStatus(`Place all ships: ${missing.map(m => m.name).join(', ')}`);

    const sock = getSocket();
    sock.emit('place-ships', { roomId: state.roomId, layout: state.placement.placed });

    // Immediately request sync so server can advance phase when both are ready
    sock.emit('ready-for-sync', state.roomId);

    setStatus('Submitted. Waiting for opponent.');
    state.phase = 'waiting';
    render();
}


function tryAttack(x, y) {
    if (state.phase !== 'battle') return;
    if (state.role === 'spectator') return setStatus('Spectators cannot attack.');
    if (state.turn !== state.role) return setStatus('Not your turn.');
    const fog = state.oppFog[y][x];
    if (fog.hit || fog.miss) return setStatus('Already targeted.');
    const sock = getSocket();
    sock.emit('attack', { roomId: state.roomId, x, y });
}

// --- Chat wiring (socket-based) ---
function setupChat(sock) {
    if (sock._chatWired) return;
    sock._chatWired = true;

    const input = byId('chatInput');
    const sendBtn = byId('sendBtn');
    const messagesEl = byId('chatMessages');

    if (!input || !sendBtn || !messagesEl) return;

    if (!sendBtn._wired) {
        sendBtn.onclick = () => {
        const text = input.value.trim();
        if (!text) return;
        sock.emit('chat-message', {
            roomId: state.roomId,
            user: state.username,
            role: state.role,
            text
        });
        input.value = '';
        };
        sendBtn._wired = true;
    }

    sock.off('chat-message'); // clear any prior listeners

    sock.on('chat-message', ({ user, role, text }) => {
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg';
        msgEl.textContent = `${role || ''} ${user}: ${text}`;
        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });
}


// --- Render ---
function render() {
    const root = byId('board');
    if (!root) return;

    const phaseLabel = !state.synced
        ? 'SYNCING...'
        : state.winner
        ? `FINISHED (Winner: ${state.winner})`
        : (state.phase || 'PLACEMENT').toUpperCase();

    root.innerHTML = `
        <div class="status-bar">
        <span id="roleLabel">Role: ${state.role || 'pending'}</span>
        <span id="phaseLabel">Phase: ${phaseLabel}</span>
        <span id="turnIndicator">Turn: ${state.turn.toUpperCase()}</span>
        </div>

        <div class="boards-wrapper">
        <div class="board-section">
            <h2>Red Fleet</h2>
            <div id="own" class="grid-board"></div>
            ${state.role === 'red' ? `
            <div class="controls">
                <button id="toggleDir" class="pixel-btn">Orientation: ${state.placement.dir}</button>
                <button id="submitShips" class="pixel-btn">Submit Ships</button>
            </div>` : ''}
        </div>
        <div class="board-section">
            <h2>Blue Fleet</h2>
            <div id="opp" class="grid-board"></div>
            ${state.role === 'blue' ? `
            <div class="controls">
                <button id="toggleDir" class="pixel-btn">Orientation: ${state.placement.dir}</button>
                <button id="submitShips" class="pixel-btn">Submit Ships</button>
            </div>` : ''}
        </div>
        </div>
        <div id="status" class="status-msg">${state.status || ''}</div>
        ${state.phase === 'finished' && state.role !== 'spectator' ? `
        <div class="controls"><button id="playAgain" class="pixel-btn">Play Again</button></div>` : ''}
    `;

    const own = byId('own');
    const opp = byId('opp');
    own.innerHTML = '';
    opp.innerHTML = '';

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
        // Red board cell
        const oc = document.createElement('div');
        oc.className = 'cell';
        const rawR = state.rawRed?.[y]?.[x] ?? 0;
        if (rawR === 1) oc.classList.add('hit');
        if (rawR === -1) oc.classList.add('miss');
        const placedServerRed = isPlacedAt(state.shipsRed, x, y);
        const placedLocalRed = state.role === 'red' && isPlacedAt(state.placement.placed, x, y);
        if (placedLocalRed || (placedServerRed && (state.role === 'red' || state.role === 'spectator' || state.phase === 'finished'))) {
            oc.classList.add('ship');
        }
        if (state.synced && state.phase === 'placement' && state.role === 'red') {
            oc.onclick = () => placeShipInteractive(x, y, 'red');
        } else if (state.phase === 'battle' && state.role === 'blue' && state.turn === state.role) {
            oc.onclick = () => tryAttack(x, y);
        }
        own.appendChild(oc);

        // Blue board cell
        const pc = document.createElement('div');
        pc.className = 'cell';
        const rawB = state.rawBlue?.[y]?.[x] ?? 0;
        if (rawB === 1) pc.classList.add('hit');
        if (rawB === -1) pc.classList.add('miss');
        const placedServerBlue = isPlacedAt(state.shipsBlue, x, y);
        const placedLocalBlue = state.role === 'blue' && isPlacedAt(state.placement.placed, x, y);
        if (placedLocalBlue || (placedServerBlue && (state.role === 'blue' || state.role === 'spectator' || state.phase === 'finished'))) {
            pc.classList.add('ship');
        }
        if (state.synced && state.phase === 'placement' && state.role === 'blue') {
            pc.onclick = () => placeShipInteractive(x, y, 'blue');
        } else if (state.phase === 'battle' && state.role === 'red' && state.turn === state.role) {
            pc.onclick = () => tryAttack(x, y);
        }
        opp.appendChild(pc);
        }
    }

    // External indicators
    const turnEl = byId('turnIndicator');
    if (turnEl) turnEl.textContent = `Turn: ${state.turn.toUpperCase()}`;

    // Wire controls after render
    setTimeout(() => {
        const toggleBtn = byId('toggleDir');
        if (toggleBtn) {
        toggleBtn.disabled = !((state.role === 'red' || state.role === 'blue') && state.phase === 'placement');
        toggleBtn.onclick = () => { window.__sinkEmToggleDir(); };
        }
        const submitBtn = byId('submitShips');
        if (submitBtn) {
        submitBtn.disabled = !((state.role === 'red' || state.role === 'blue') && state.phase === 'placement');
        submitBtn.onclick = () => { window.__sinkEmSubmitShips(); };
        }
        const playAgain = byId('playAgain');
        if (playAgain) {
        playAgain.onclick = () => {
            const sock = getSocket();
            sock.emit('reset-game', state.roomId);
        };
        }
    }, 0);
}

// --- Module export ---
export default {
    name: 'sinkEm',
    metadata: { type: 'board', realtime: true },

    async init({ roomId, userId, token, role, username } = {}) {
        const sock = getSocket();

        // Initialize state
        state.roomId = roomId || sessionStorage.getItem('roomId');
        state.userId = userId || sessionStorage.getItem('userId');
        state.token = token || sessionStorage.getItem('token');
        state.username = username || sessionStorage.getItem('username') || 'Player';
        state.role = role || sessionStorage.getItem('role') || null;

        // --- Listeners ---
        sock.on('connect', () => { /* connected */ });

        sock.on('assign-role', (r) => {
            state.role = r;
            try { sessionStorage.setItem('role', r); } catch {}
            sock.emit('player-joined', { roomId: state.roomId, role: r, username: state.username });

            const roleLabel = byId('roleLabel');
            if (roleLabel) roleLabel.textContent = `Role: ${state.role}`;

            const nameEl = document.getElementById(r === 'red' ? 'redPlayerName' : 'bluePlayerName');
            if (nameEl) nameEl.textContent = state.username;

            render();
        });


        sock.on('game-joined', async ({ roomId, userId, token, role: r, username: uname }) => {
            // Update state with fresh values from server
            state.roomId = roomId;
            state.userId = userId;
            state.token = token;
            state.role = r;
            state.username = uname || 'Player';

            try {
            sessionStorage.setItem('roomId', roomId);
            sessionStorage.setItem('userId', userId);
            sessionStorage.setItem('token', token);
            sessionStorage.setItem('role', r);
            sessionStorage.setItem('username', uname || 'Player');
            } catch {}

            // Wire chat with correct credentials
            try {
                const apiKey = window.STREAM_API_KEY || (await (await fetch('/config')).json()).apiKey;
                await initChat({
                apiKey,
                userId: state.userId,
                token: state.token,
                username: state.username,
                roomId: state.roomId,
                socket: sock
                });
            } catch (e) {
                console.warn('[sinkEm] initChat failed:', e);
            }

            // Emit player-joined
            sock.emit('player-joined', { roomId: state.roomId, role: state.role, username: state.username });

            const roleLabel = byId('roleLabel');
            if (roleLabel) roleLabel.textContent = `Role: ${state.role || 'pending'}`;

            const nameEl = document.getElementById(r === 'red' ? 'redPlayerName' : 'bluePlayerName');
            if (nameEl) nameEl.textContent = state.username;
            setupChat(sock);
            render();
        });


        sock.on('all-players-info', (players) => {
            // Update name labels
            if (players.red) {
                const el = document.getElementById('redPlayerName');
                if (el) el.textContent = players.red;
            }
            if (players.blue) {
                const el = document.getElementById('bluePlayerName');
                if (el) el.textContent = players.blue;
            }

            // Compare with last known state
            const changed = Object.entries(players).some(([role, name]) => state.lastPlayers[role] !== name);
            if (changed) {
                systemMessage(`Players joined: ${Object.entries(players).map(([k,v]) => `${k}=${v}`).join(', ')}`);
                state.lastPlayers = { ...players };
            }

            setStatus(`Players: ${Object.entries(players).map(([k,v]) => `${k}:${v}`).join(', ')}`);
            sock.emit('ready-for-sync', state.roomId);
            render();
        });



        sock.on('player-left', ({ username, role } = {}) => {
            setStatus(`${username || 'A player'} left (${role})`);
            systemMessage(`${username || 'A player'} left (${role})`);
            sock.emit('ready-for-sync', state.roomId);
            render();
        });


        sock.on('scoreUpdate', ({ redScore, blueScore }) => {
        const rs = byId('redScore'); if (rs) rs.textContent = redScore;
        const bs = byId('blueScore'); if (bs) bs.textContent = blueScore;
        });

        sock.on('sync-board', (boardData) => {
            console.log('[sinkEm] sync-board payload:', boardData);

            let board = boardData;
            if (!board || !board.phase) {
                board = { phase: 'placement', turn: 'red', ships: { red: [], blue: [] } };
            }

            applySyncBoard(board); // maps 'in-progress' -> 'battle'
            clearOldStatus();
            _syncAttempts = 0;
            if (_syncRetryTimer) { clearInterval(_syncRetryTimer); _syncRetryTimer = null; }

            const turnEl = byId('turnIndicator');
            if (turnEl) turnEl.textContent = `Turn: ${state.turn.toUpperCase()}`;
            const phaseEl = byId('phaseLabel');
            if (phaseEl) phaseEl.textContent = `Phase: ${state.phase === 'battle' ? 'IN-PROGRESS' : (state.phase || 'PLACEMENT').toUpperCase()}`;

            render();
        });


        sock.on('placed-ships', ({ success } = {}) => {
        if (success) {
            setStatus('Ships placed. Waiting for opponent.');
            sock.emit('ready-for-sync', state.roomId);
        }
        });

        sock.on('attack-result', ({ hit, sunk, x, y, player } = {}) => {
        const msg = hit ? (sunk ? `Hit and sunk ${sunk}!` : 'Hit!') : 'Miss.';
        setStatus(msg);
        if (player === state.role && state.oppFog?.[y]?.[x]) {
            state.oppFog[y][x].hit = hit;
            state.oppFog[y][x].miss = !hit;
        }
        render();
        });

        sock.on('game-over', ({ winner }) => {
            state.winner = winner;
            state.phase = 'finished';
            setStatus(`Game over. Winner: ${winner}`);

            // Increment winner’s score
            if (winner === 'red') state.redScore++;
            if (winner === 'blue') state.blueScore++;

            // Update scoreboard UI
            const rs = byId('redScore'); if (rs) rs.textContent = state.redScore;
            const bs = byId('blueScore'); if (bs) bs.textContent = state.blueScore;

            render();
        });


        sock.on('game-reset', ({ board, currentPlayer } = {}) => {
            if (!board) return;
            applySyncBoard(board);
            state.turn = currentPlayer || board.turn || 'red';
            state.phase = board.phase || 'placement';
            state.winner = board.winner || null;
            state.placement.placed = [];
            state.placement.dir = 'H';
            setStatus('Game reset. Ready.');

            // Keep scores as-is (don’t reset to 0)
            const rs = byId('redScore'); if (rs) rs.textContent = state.redScore;
            const bs = byId('blueScore'); if (bs) bs.textContent = state.blueScore;

            render();
        });


        sock.on('action-error', ({ message }) => {
            setStatus(`Error: ${message}`);
        });

        // Reflect persisted role quickly
        if (state.role) {
            const roleLabel = byId('roleLabel');
            if (roleLabel) roleLabel.textContent = `Role: ${state.role}`;
            render();
        }

        // Join room/game and proactively request role
        sock.emit('join-room', state.roomId);
        sock.emit('join-game', state.roomId);
        sock.emit('request-role', { roomId: state.roomId, userId: state.userId });

        // Optional: server can reply with 'role-assigned'
        sock.on('role-assigned', ({ role: assignedRole }) => {
            if (!assignedRole) return;
            state.role = assignedRole;
            try { sessionStorage.setItem('role', assignedRole); } catch {}
            const roleLabel = byId('roleLabel');
            if (roleLabel) roleLabel.textContent = `Role: ${state.role}`;
            render();
        });

        // Sync handshake
        function startSyncHandshake() {
            if (_syncRetryTimer) return;
            _syncAttempts = 0;
            const tick = () => {
                if (_syncAttempts >= MAX_SYNC_ATTEMPTS) {
                clearInterval(_syncRetryTimer);
                _syncRetryTimer = null;
                return;
                }
                socket.emit('ready-for-sync', state.roomId);
                _syncAttempts++;
            };
            _syncRetryTimer = setInterval(tick, SYNC_RETRY_MS);
            tick();
            }
            startSyncHandshake();

        },


    // Action wrappers
    placeShips(layout) {
        const sock = getSocket();
        if (!state.roomId) return setStatus('No room.');
        if (!state.role || state.role === 'spectator') return setStatus('Spectators cannot place ships.');
        sock.emit('place-ships', { roomId: state.roomId, layout });
    },

    attack(x, y) {
        const sock = getSocket();
        if (!state.roomId) return setStatus('No room.');
        if (!state.role || state.role === 'spectator') return setStatus('Spectators cannot attack.');
        if (state.phase !== 'battle') return setStatus('Cannot attack outside battle phase.');
        if (state.turn !== state.role) return setStatus('Not your turn.');
        sock.emit('attack', { roomId: state.roomId, x, y });
    }
};

