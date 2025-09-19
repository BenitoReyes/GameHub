import { StreamChat } from "stream-chat";
import dotenv from "dotenv";
dotenv.config({ path: "BackEnd/StreamSecrets.env" });
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_SECRET = process.env.STREAM_SECRET;
const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
const PORT = process.env.PORT || 3000;

app.use(express.static('FrontEnd')); // Serve frontend files

let players = [];

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'FrontEnd/index.html'));
});

// Allows frontend to fetch the Stream API key
app.get('/config', (req, res) => {
  res.json({ apiKey:process.env.STREAM_API_KEY});
});

// Creating the system bot for temporary second player
(async () => {
  const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
  await serverClient.upsertUser({ id: 'system-bot', name: 'System Bot' });
})();



io.on('connection', async (socket) => {
    console.log('Player connected:', socket.id);
    let userId = `user_${socket.id}`;
    const token = serverClient.createToken(userId); // using StreamChat server SDK
    socket.emit('chat-auth', { userId, token });
    await serverClient.upsertUser({ id: 'system-bot', name: 'System Bot' });
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
    console.log(`Server running at http://localhost:${PORT}`);
});
