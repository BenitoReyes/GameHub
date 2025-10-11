import { StreamChat } from "stream-chat";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
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
      res.setHeader('Set-Cookie', cookie.serialize('userId', userId, {
        //local host reasons
        httpOnly: true,
        secure: false,       // keep false for localhost dev
        sameSite: 'Lax',     // less restrictive than Strict
        path: '/', 
        maxAge: 60 * 60 * 24, // 1 day
      }), cookie.serialize('token', token, {
        httpOnly: true,
        secure: false,       // keep false for localhost dev
        sameSite: 'Lax',     // less restrictive than Strict
        path: '/', 
        maxAge: 60 * 60 * 24, // 1 day
        }));
      res.redirect('index.html');
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
        res.setHeader('Set-Cookie', cookie.serialize('token', serverClient.createToken(user.id), {
          // bad security fior local reasons
        httpOnly: false,
        secure: false,
        maxAge: 60 * 60 * 24, // 1 day
      }), cookie.serialize('userId', user.id, {
        httpOnly: false,
        secure: false,
        maxAge: 60 * 60 * 24, // 1 day
        }));
        res.redirect('gameCreate.html');
      }
    }
    } catch (error) {
      console.error('Error during login:', error);
      res.json(error);
    }
});



// Creating the system bot for temporary second player
/*(async () => {
  const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
  await serverClient.upsertUser({ id: 'system-bot', name: 'System Bot' });
})();*/

//once the backend and frontend are connected via socket.io, at the very start of the projects lifecycle
io.on('connection', async (socket) => {
    var cookies = cookie.parse(socket.handshake.headers.cookie || '');
    const token = cookies.token;
    const userId = cookies.userId;


    socket.on('create-game', async () => {
      const roomId = v4().slice(0,8); // generate a unique room ID
      await prisma.room.create({
        data: { id: roomId, host: {connect: {id:userId}}, isPublic: false }
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
      console.log(participant);
      //
      await prisma.room.update({
        where: { id: roomId },
        data: {participants: {connect: { id: participant.id }}}
      });
      socket.emit('assign-role', 'red');
      //socket.join(roomId);
      socket.emit('game-created', roomId);
      //players.push(socket.id);
    });


    socket.on('join-game', async (roomId) => {
        const room = await prisma.room.findUnique({
            where: { id: roomId },
            include: { participants: true }
        });
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        let roomPartnum = room.participants.length || 0;
        if (roomPartnum >= 2) {
            await prisma.roomParticipant.create({
            data: { roomId: roomId, userId: userId, permission: 'SPECTATOR' }
        });
            socket.emit('assign-role', 'spectator');
            socket.join(roomId);
            socket.emit('game-joined', {roomId, role: 'spectator'});
            return;
        } else {
            await prisma.roomParticipant.create({
              data: { roomId: roomId, userId: userId, permission: 'PLAYER' }
          });
          socket.emit('assign-role', 'yellow');
          socket.emit('game-joined', {roomId, role: 'yellow'} );
        }
        socket.join(roomId);
        players.push(socket.id);
    });


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