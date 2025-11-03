import { StreamChat } from "stream-chat";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { suggestMove as suggestDrop4 } from './AI/drop4.js';
import { PrismaClient } from '@prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate'
import {v4} from 'uuid'; // to generate unique user ids for cookie tokens
import bcrypt from 'bcrypt'; // to hashpasswords
import cookie from 'cookie';
const prisma = new PrismaClient().$extends(withAccelerate())
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_SECRET = process.env.STREAM_SECRET;
const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
const PORT = process.env.PORT || 3000;
app.use(express.static('FrontEnd')); // Serve frontend files
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.urlencoded({ extended: true })); // parse form bodies if needed

let players = [];

// AI suggestion endpoint for Drop4 — delegates to BackEnd/AI/drop4.js
app.post('/api/drop4/suggest', async (req, res) => {
  try {
    const { board, currentPlayer } = req.body;
    // delegate to AI module (keeps server.js minimal)
    const column = await suggestDrop4(board, currentPlayer, { depth: 5 });
    res.json({ column });
  } catch (error) {
    console.error('Error in suggestion endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'FrontEnd/index.html'));
});

// Allows frontend to fetch the Stream API key
app.get('/config', (req, res) => {
  res.json({ apiKey:process.env.STREAM_API_KEY});
});

// put sign up in here cause its only once per connection and we need the socket to emit back to the client
    app.post('/signup', async (req, res) => {
    try{
      const {username, password} = req.body;
      const userId = v4(); // generate a unique user ID
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({data: { id: userId, username: username, password: hashedPassword}});
      await serverClient.upsertUser({id: userId, name: user.username});
      const token = serverClient.createToken(userId); // using StreamChat server SDK 'userId', userId
      console.log("User created with ID:", userId);
      res.setHeader('Set-Cookie', [
        cookie.serialize('userId', user.id, {
          httpOnly: false,
          secure: false,
          maxAge: 60 * 60 * 24,
        }),
        cookie.serialize('token', token, {
          httpOnly: false,
          secure: false,
          maxAge: 60 * 60 * 24,
        })
      ]);

      res.redirect('homepage.html');
    } catch (error) {
      console.error('Error during signup:', error);
      res.json(error);
    }

});

app.post('/login', async (req, res) => {
    try{
      const {username, password} = req.body;
      await prisma.$connect();
      const user = await prisma.user.findUnique({where: {username: username}});
      if(!user){
        return res.status(400).json({error: 'User not found'});
      } else {
      const validPassword = await bcrypt.compare(password, user.password);
      if(!validPassword){
        return res.status(400).json({error: 'Invalid password'});
      } else {
        res.setHeader('Set-Cookie', [
        cookie.serialize('userId', user.id, {
          httpOnly: false,
          secure: false,
          maxAge: 60 * 60 * 24,
        }),
        cookie.serialize('token', serverClient.createToken(user.id), {
          httpOnly: false,
          secure: false,
          maxAge: 60 * 60 * 24,
        })
      ]);
        res.redirect('homepage.html');
      }
    }
    } catch (error) {
      console.error('Error during login:', error);
      res.json(error);
    }
});



// Creating the system bot for temporary second player
(async () => {
  const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
  await serverClient.upsertUser({ id: 'system-bot', name: 'System Bot' });
})();

// Store room player information
const roomPlayers = new Map(); // roomId -> { red: username, blue: username }

//once the backend and frontend are connected via socket.io, at the very start of the projects lifecycle
io.on('connection', async (socket) => {
    var cookies = cookie.parse(socket.handshake.headers.cookie || '');
    const userId = cookies.userId;
    socket.on('create-game', async () => {
      const roomId = v4().slice(0,8); // generate a unique room ID
      const token = serverClient.createToken(userId)
      const emptyBoard = Array.from({ length: 6 }, () => Array(7).fill(0));
      await prisma.room.create({
        data: { id: roomId, host: {connect: {id:userId}}, isPublic: true, board: emptyBoard, inRoom: 0 }
      });
      await prisma.user.update({
        where: { id: userId },
        data: { rooms: { connect: {id:roomId }} }
      });
      await prisma.roomParticipant.create({
        data: { roomId: roomId, userId: userId, permission: 'HOST'}
      });
      let participant = await prisma.roomParticipant.findUnique({
        where: { userId_roomId : { userId, roomId } }
      });
      
      await prisma.room.update({
        where: { id: roomId },
        data: {participants: {connect: { id: participant.id }}}
      });
      const channel = serverClient.channel('messaging', roomId, {
        members: [userId, 'system-bot'],
        name: 'Game Chat',
        created_by_id: userId
      });
      // Wait for the channel to be created and watched
      let user = await prisma.user.findUnique({
        where: {id: userId}
      });
      let username = user.username;
      await channel.create();
      await channel.watch();
      socket.join(roomId);
      socket.emit('assign-role', 'red');
      socket.emit('game-created', {roomId, userId, token, role:'red', username});
      //players.push(socket.id);
    });

    socket.on('join-room', async (roomId) => {
      socket.join(roomId);
      console.log('join-room event received for room:', roomId);
      try {
        await prisma.room.update({
          where: { id: roomId },
          data: { inRoom: { increment: 1 } }
        });
        console.log(`inRoom incremented for ${roomId}`);
      } catch (err) {
        console.error(`Failed to increment inRoom for ${roomId}:`, err);
      }
      console.log(`Socket ${socket.id} joined room ${roomId}`);
    });

    // Handle player joining with username
    socket.on('player-joined', ({ roomId, role, username }) => {
      console.log(`Player ${username} (${role}) joined room ${roomId}`);
      
      // Store player info in memory
      if (!roomPlayers.has(roomId)) {
        roomPlayers.set(roomId, {});
      }
      const players = roomPlayers.get(roomId);
      if (role === 'red' || role === 'blue') {
        players[role] = username;
      }
      
      // Broadcast all current players to everyone in the room
      io.to(roomId).emit('all-players-info', players);
    });

    // Handle request for current player names
    socket.on('request-player-names', (roomId) => {
      const players = roomPlayers.get(roomId);
      if (players) {
        socket.emit('all-players-info', players);
      }
    });

    socket.on('join-game', async (roomId) => {
      const token = serverClient.createToken(userId);
      const room = await prisma.room.findFirst({
        where: { id: roomId },
        include: { participants: true },
        orderBy: { createdAt: 'desc' }
      });
      if (!room) {
        socket.emit('error', 'Room not found');
        return;
      }
      const roomPartnum = room.participants.length || 0;
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      const username = user.username;
      let role;
      let permission;
      const participant = await prisma.roomParticipant.findUnique({
        where: {userId_roomId: {userId,roomId}}
      });
      if(!participant){
        if (roomPartnum >= 2) {
          role = 'spectator';
          permission = 'SPECTATOR';
        } else {
          role = 'blue';
          permission = 'PLAYER';
        }
      } else {
        if(participant.permission === 'PLAYER'){
          role = 'blue';
          permission = 'PLAYER';
        } else if(participant.permission === 'HOST'){
          role = 'red';
          permission = 'HOST';
        } else {
          role = 'spectator';
          permission = 'SPECTATOR';
        }
      }
      await prisma.roomParticipant.upsert({
        where: { userId_roomId: { userId, roomId}},
        create: { roomId, userId, permission},
        update: { permission } // optional: update role if needed 
      });
      socket.emit('assign-role', role);
      socket.join(roomId);
      socket.emit('game-joined', { roomId, userId, token, role, username });
      const channel = serverClient.channel('messaging', roomId);
      await channel.addMembers([userId]);
      players.push(socket.id);
    });

    socket.on('request-board', async (roomId) => {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { board: true }
      });
      if (room) {
        console.log(`Sending board to socket ${socket.id}`);
        socket.emit('sync-board', room.board);
      }
    });

    socket.on('getScores', async (roomId) => {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { redScore: true, blueScore: true }
      });
      socket.emit('scoreUpdate', { redScore:room.redScore, blueScore:room.blueScore });
    });

    socket.on('incrementRedScore', async (roomId) => {
      const room = await prisma.room.update({
        where: { id: roomId },
        data: { redScore: { increment: 1 } },
        select: { redScore: true }
      });
    });

    socket.on('incrementBlueScore', async (roomId) => {
      const room = await prisma.room.update({
        where: { id: roomId },
        data: { blueScore: { increment: 1 } },
        select: { blueScore: true }
      });
    });

    socket.on('get-rooms', async () => {
      const rooms = await prisma.room.findMany({
        where: { isPublic: true },
        select: {
          id: true,
          host: true,
          participants: true
        }
      });
      socket.emit('room-list', rooms);
    });

    socket.on('make-move', async ({data, roomId}) => {
      console.log(`Move received in room ${roomId}:`, data);
      console.log(`Socket rooms:`, Array.from(socket.rooms));
      // Fetch current board
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { board: true }
      });
      if (!room || !room.board) {
        console.error(`Room ${roomId} not found or board missing`);
        return;
      }
      // Update board in memory
      const board = room.board;
      board[data.row][data.col] = data.player;
      // Save updated board to DB
      await prisma.room.update({
        where: { id: roomId },
        data: { board }
      });
      socket.to(roomId).emit('opponent-move', data);
    });

    socket.on('reset-game', async (board, roomId) => {
      await prisma.room.update({
        where: { id: roomId },
        data: { board }
      });
      socket.to(roomId).emit('game-reset', board);
    });

    socket.on('leave-game', async (roomId ) => {
      console.log('leave-game event received for room:', roomId);
      setTimeout(async () => {
      const oldroom = await prisma.room.update({
          where: { id: roomId },
          data: { inRoom: { decrement: 1 } }  
      });
      if(!oldroom){
        console.log(`Room ${roomId} not found while leaving`);
        return;
      }
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { inRoom: true, participants: true }
      });
      console.log(`User ${userId} left room ${roomId} # current inRoom: ${room.inRoom}`);
      if(room.inRoom <= 0){
          await prisma.roomParticipant.deleteMany({
            where: { roomId: roomId }
          });
          await prisma.room.delete({
            where: { id: roomId}
          });
          console.log(`Room ${roomId} deleted as it became empty`);
        }
      }, 5000); // 5 second delay
    });

    socket.on('disconnect', async () => {
      console.log(`Socket ${socket.id} disconnected`);
      });
  });

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});