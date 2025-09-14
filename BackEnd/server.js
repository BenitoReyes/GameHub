const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const path = require('path');

const PORT = process.env.PORT || 3000;

app.use(express.static('FrontEnd')); // Serve frontend files

let players = [];


io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    if (players.length < 2) {
        players.push(socket.id);
        const role = players.length === 1 ? 'red' : 'yellow';
        socket.emit('assign-role', role);
    } else {
        socket.emit('room-full');
    }

    socket.on('make-move', (data) => {
        socket.broadcast.emit('opponent-move', data);
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        players = players.filter(id => id !== socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
