import { getSocket } from '../commonLogic/socket.js';

export default {
    name: 'battleship',
    metadata: { type: 'board', realtime: false },

    async init({ roomId, userId, token, role, username } = {}) {
        const socket = getSocket();
        // Simple init: join room, request board
        socket.emit('join-room', roomId);
        socket.emit('request-board', roomId);
        // Future: implement board rendering & player placement
        console.log('Battleship init for room', roomId, 'role', role);
    }
};
