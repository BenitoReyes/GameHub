// Shared socket utility for games
let socketInstance;
export function getSocket() {
    if (!socketInstance) {
        socketInstance = io();
        // Default reconnect handlers, if you want to add more.
        socketInstance.on('connect', () => console.log('socket connected:', socketInstance.id));
        socketInstance.on('disconnect', (reason) => console.log('socket disconnected:', reason));
    }
    if (typeof window !== 'undefined') window.socket = socketInstance;
    return socketInstance;
}

export function ensureSocket() {
    return getSocket();
}
