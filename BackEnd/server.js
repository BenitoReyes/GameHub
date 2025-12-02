import { StreamChat } from "stream-chat";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { initGames, getGame } from './games/index.js';
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
const socketMeta = new Map();
const userRooms = new Map(); // userId -> Set<roomId>
const roomOnlineUsers = new Map(); // roomId -> Set<userId>
const disconnectTimers = new Map(); // userId -> Map<roomId, timeoutId>
const deletingRooms = new Set(); // Set<roomId> - concurrent delete marker
const recentRoomCreation = new Map(); // roomId -> timestamp (ms) to prevent immediate deletion on redirect
const RECENT_ROOM_TTL_MS = 30000; // constant used in creation TTL and retry scheduling

// Helper - schedule a retry of cleanup after TTL expires if deletion was skipped due to recent creation
async function attemptRoomCleanup(roomId, userId) {
  try {
    const rset = roomOnlineUsers.get(roomId) || new Set();
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { participants: true } });
    if (!room) return;
    const connected = rset.size;
    // If no users and no participants, delete safely
    if (connected <= 0 && (!room.participants || room.participants.length === 0)) {
      console.log(`attemptRoomCleanup: deleting room ${roomId} (empty)`);
      await safeDeleteRoom(roomId);
      return;
    }
    // If there is a participant for userId, delete it if allowed (e.g., not HOST TTL)
    if (userId) {
      const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
      if (participant) {
        const createdAt = recentRoomCreation.get(roomId) || 0;
        const now = Date.now();
        if (participant.permission !== 'HOST' || (now > createdAt + RECENT_ROOM_TTL_MS)) {
          console.log(`attemptRoomCleanup: removing participant ${userId} from ${roomId} during retry`);
          try { await prisma.roomParticipant.deleteMany({ where: { userId, roomId } }); } catch (e) { /* ignore */ }
        } else {
          console.log(`attemptRoomCleanup: not removing HOST ${userId} during retry; still in TTL`);
        }
      }
      // After potential participant deletion, reconcile DB inRoom with our rset size (unique users)
      try { await prisma.room.update({ where: { id: roomId }, data: { inRoom: rset.size } }); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    console.error('attemptRoomCleanup failed:', e);
  }
}

// Force the given user to leave the specified room immediately (cleanup and DB updates)
async function forceLeaveRoom(userId, roomId) {
  try {
    console.log(`forceLeaveRoom: forcing ${userId} to leave ${roomId}`);
    // Remove user from roomOnlineUsers and userRooms and update DB inRoom if needed
    const rset = roomOnlineUsers.get(roomId) || new Set();
    const wasCounted = rset.has(userId);
    if (wasCounted) {
      rset.delete(userId);
      const urs = userRooms.get(userId);
      if (urs) {
        urs.delete(roomId);
        if (urs.size === 0) userRooms.delete(userId);
      }
      if (rset.size === 0) roomOnlineUsers.delete(roomId);
      try {
        const roomAfter = await prisma.room.update({ where: { id: roomId }, data: { inRoom: { decrement: 1 } }, select: { inRoom: true } });
        if (roomAfter && roomAfter.inRoom < 0) {
          await prisma.room.update({ where: { id: roomId }, data: { inRoom: 0 } });
        }
      } catch (e) {
        if (e?.code !== 'P2025') console.error('forceLeaveRoom: failed to decrement inRoom', e);
      }
    }

    // Remove participant entry
    try { await prisma.roomParticipant.deleteMany({ where: { userId, roomId } }); console.log(`forceLeaveRoom: removed participant ${userId} from ${roomId}`); } catch (e) { /* ignore */ }

    // Update in-memory players
    try {
      const rp = roomPlayers.get(roomId) || {};
      Object.keys(rp).forEach(k => { if (rp[k] === userId || rp[k] === undefined || rp[k] === null) delete rp[k]; });
      io.to(roomId).emit('all-players-info', rp);
    } catch (e) { /* ignore */ }

    // If the room is now empty, delete it (unless recent)
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { participants: true } });
      const rset2 = roomOnlineUsers.get(roomId) || new Set();
      if ((!room || (room.inRoom <= 0)) && (!room || (room.participants && room.participants.length === 0)) ) {
        if (recentRoomCreation.has(roomId)) {
          console.log(`forceLeaveRoom: ${roomId} is newly created; scheduling retry cleanup instead of immediate delete`);
          const createdAt = recentRoomCreation.get(roomId) || 0;
          const remaining = Math.max(0, (createdAt + RECENT_ROOM_TTL_MS) - Date.now());
          scheduleRetryCleanupForUser(roomId, userId, remaining + 500);
        } else {
          await safeDeleteRoom(roomId);
        }
      }
    } catch (e) { console.error('forceLeaveRoom: error while checking/deleting room', e); }
  } catch (e) {
    console.error('forceLeaveRoom failed:', e);
  }
}

function scheduleRetryCleanupForUser(roomId, userId, delayMs) {
  if (!userId) return setTimeout(() => attemptRoomCleanup(roomId, null), delayMs);
  const userTimers = disconnectTimers.get(userId) || new Map();
  if (userTimers.has(roomId)) {
    try { clearTimeout(userTimers.get(roomId)); } catch (e) { /* ignore */ }
  }
  const tid = setTimeout(async () => {
    try { await attemptRoomCleanup(roomId, userId); } catch (e) { /* ignore */ }
    // cleanup the timer entry
    const ut = disconnectTimers.get(userId);
    if (ut && ut.get(roomId) === tid) {
      ut.delete(roomId);
      if (ut.size === 0) disconnectTimers.delete(userId);
    }
  }, delayMs);
  userTimers.set(roomId, tid);
  disconnectTimers.set(userId, userTimers);
  return tid;
}
app.use(express.static('FrontEnd')); // Serve frontend files
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.urlencoded({ extended: true })); // parse form bodies if needed

function setAuthCookies(res, userId, token) {
  res.setHeader('Set-Cookie', [
    cookie.serialize('userId', userId, {
      httpOnly: false,
      secure: false,
      maxAge: 60 * 60 * 24,
    }),
    cookie.serialize('token', token, {
      httpOnly: false,
      secure: false,
      maxAge: 60 * 60 * 24,
    }),
  ]);
}

function isAjax(req) {
  return (req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
}

// AI endpoints per game are now registered in their modules via the games loader
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'FrontEnd/index.html'));
});

// Allows frontend to fetch the Stream API key
app.get('/config', (req, res) => {
  res.json({ apiKey:process.env.STREAM_API_KEY});
});


// SIGNUP ROUTE
app.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userId = v4();
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const user = await prisma.user.create({
      data: { id: userId, username, password: hashedPassword },
    });

    await serverClient.upsertUser({ id: userId, name: username });
    const token = serverClient.createToken(userId);

    console.log('User created with ID:', userId);
    setAuthCookies(res, userId, token);

    if (isAjax(req)) {
      return res.json({ success: true, redirect: '/homepage.html' });
    }

    res.redirect('/homepage.html');
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// LOGIN ROUTE
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    await prisma.$connect();

    const user = await prisma.user.findUnique({ where: { username } });
    const valid = user && await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const token = serverClient.createToken(user.id);
    setAuthCookies(res, user.id, token);

    if (isAjax(req)) {
      return res.json({ success: true, redirect: '/homepage.html' });
    }

    res.redirect('/homepage.html');
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Creating the system bot for temporary second player
(async () => {
  const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
  await serverClient.upsertUser({ id: 'system-bot', name: 'System Bot' });
})();

// Store room player information
const roomPlayers = new Map(); // roomId -> { red: username, blue: username }

// Broadcast current public rooms to all connected clients
async function emitRoomList(socket = null, gameType = null) {
  try {
    const where = { isPublic: true };
    if (gameType) where.gameType = gameType;
    const rooms = await prisma.room.findMany({
      where,
      select: {
        id: true,
        host: true,
        gameType: true,
          participants: true,
          inRoom: true
      }
    });
    if (socket && typeof socket.emit === 'function') {
      socket.emit('room-list', rooms);
    } else {
      io.emit('room-list', rooms);
    }
  } catch (err) {
    console.error('Failed to emit room list:', err);
  }
}

async function safeDeleteRoom(roomId) {
  if (deletingRooms.has(roomId)) return;
  deletingRooms.add(roomId);
  try {
    await prisma.roomParticipant.deleteMany({ where: { roomId } });
  } catch (e) { /* ignore */ }
  try {
    await prisma.room.delete({ where: { id: roomId } });
    console.log(`safeDeleteRoom: deleted ${roomId}`);
    // Clean up in-memory maps to avoid leaking state
    try {
      const rset = roomOnlineUsers.get(roomId);
      if (rset && rset.size > 0) {
        for (const uid of rset) {
          const urs = userRooms.get(uid);
          if (urs) {
            urs.delete(roomId);
            if (urs.size === 0) userRooms.delete(uid);
          }
        }
      }
      roomOnlineUsers.delete(roomId);
      roomPlayers.delete(roomId);
    } catch (err) { /* ignore */ }
  } catch (e) {
    if (e?.code === 'P2025') {
      console.warn(`safeDeleteRoom: room ${roomId} already deleted`);
    } else {
      console.error('safeDeleteRoom: failed to delete room', e);
    }
  } finally {
    deletingRooms.delete(roomId);
  }
}

//once the backend and frontend are connected via socket.io, at the very start of the projects lifecycle
// Initialize games loader before socket connection handling
await initGames({ app, io, prisma, serverClient });

// Periodic sweep to cleanup empty rooms (defensive against manual DB changes)
setInterval(async () => {
  try {
    const rooms = await prisma.room.findMany({ include: { participants: true } });
    for (const r of rooms) {
      try {
        // recompute actual connected users for the room using server-side maps where possible
        const rset = roomOnlineUsers.get(r.id) || new Set();
        const connected = rset ? rset.size : 0;
        // Fix the DB to be consistent with actual sockets
        if (r.inRoom !== connected) {
          await prisma.room.update({ where: { id: r.id }, data: { inRoom: connected } });
          console.log(`Periodic sweep: corrected inRoom for ${r.id} to ${connected}`);
        }
        // If there are no connected sockets and no participants, delete the room
        const roomLatest = await prisma.room.findUnique({ where: { id: r.id }, include: { participants: true } });
        if ((!roomLatest || (roomLatest.inRoom <= 0)) && (!roomLatest || (roomLatest.participants && roomLatest.participants.length === 0))) {
          if (recentRoomCreation.has(r.id)) {
            console.log(`Periodic cleanup: skipping deletion for newly created room ${r.id}`);
            // If we skip deletion due to TTL, schedule a retry once the TTL expires to perform cleanup
            const createdAt = recentRoomCreation.get(r.id) || 0;
            const remaining = Math.max(0, (createdAt + RECENT_ROOM_TTL_MS) - Date.now());
            scheduleRetryCleanupForUser(r.id, null, remaining + 500);
            continue;
          }
          if (!deletingRooms.has(r.id)) {
            deletingRooms.add(r.id);
            try {
              await prisma.roomParticipant.deleteMany({ where: { roomId: r.id } });
            } catch (err) { /* ignore */ }
            try {
              await prisma.room.delete({ where: { id: r.id } });
              roomPlayers.delete(r.id);
              console.log(`Periodic cleanup: deleted empty room ${r.id}`);
            } catch (err) {
              if (err?.code === 'P2025') {
                // room already deleted concurrently, ignore
                console.warn(`Periodic cleanup: room ${r.id} already deleted`);
              } else {
                console.error('Error during periodic cleanup for room', r.id, err);
              }
            } finally {
              deletingRooms.delete(r.id);
            }
          }
        }
      } catch (err) {
        console.error('Error processing room in periodic sweep', r.id, err);
      }
    }
    await emitRoomList();
  } catch (err) { console.error('Error during periodic room sweep', err); }
}, 10000); // every 10s

io.on('connection', async (socket) => {
  // Send the latest room-list to the newly-connected socket immediately
  try { await emitRoomList(socket); } catch (e) { console.error('emitRoomList failed on new connection', e); }
    var cookies = cookie.parse(socket.handshake.headers.cookie || '');
    const userId = cookies.userId;
    socket.on('create-game', async ({ gameType } = {}) => {
      if (!userId) { socket.emit('error', 'Not authenticated'); return; }
      const roomId = v4().slice(0,8); // generate a unique room ID
      const token = serverClient.createToken(userId);
      const game = getGame(gameType) || getGame('drop4');
      const initialState = game && typeof game.getInitialState === 'function' ? game.getInitialState() : Array.from({ length: 6 }, () => Array(7).fill(0));
      await prisma.room.create({
        data: { id: roomId, host: {connect: {id:userId}}, isPublic: true, board: initialState, gameType: game?.name || 'drop4', inRoom: 1 }
      });
      // record recent creation time to avoid deleting during redirect/client reload
      recentRoomCreation.set(roomId, Date.now());
      // Schedule cleanup of this marker after 30s
      setTimeout(() => recentRoomCreation.delete(roomId), 30000);
      await prisma.user.update({
        where: { id: userId },
        data: { rooms: { connect: {id:roomId }} }
      });
      await prisma.roomParticipant.create({
        data: { roomId: roomId, userId: userId, permission: 'HOST'}
      });
      console.log(`RoomParticipant created for host ${userId} in room ${roomId}`);
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
      // Mark socket meta for this socket (so we can map socket->room if needed for socket-level events)
      socketMeta.set(socket.id, { roomId });
      // Track the user->room and room->user mappings for unique-user inRoom accounting
      if (!userRooms.has(userId)) userRooms.set(userId, new Set());
      userRooms.get(userId).add(roomId);
      if (!roomOnlineUsers.has(roomId)) roomOnlineUsers.set(roomId, new Set());
      roomOnlineUsers.get(roomId).add(userId);
      // Record host name locally to manage in-memory player list and broadcast to room
      if (!roomPlayers.has(roomId)) roomPlayers.set(roomId, {});
      const pList = roomPlayers.get(roomId);
      pList['red'] = username;
      io.to(roomId).emit('all-players-info', pList);
      socket.emit('assign-role', 'red');
      console.log(`assign-role emitted to host ${userId} as 'red' for room ${roomId}`);
      // Immediately send the initial board to the creator to reduce race conditions
      try { socket.emit('sync-board', initialState); } catch (e) { console.error('Failed to emit sync-board to creator:', e); }
      // In-room is initialized to 1 in DB on creation and mapped in roomOnlineUsers above.
      try { await emitRoomList(); } catch (e) { /* ignore */ }
      socket.emit('game-created', {roomId, userId, token, role:'red', username, gameType: game?.name || 'drop4'});
      console.log(`game-created emitted to host for room ${roomId}`);
      console.log(`Room created: ${roomId} (gameType: ${game?.name || 'drop4'}) by user ${userId}`);
      try { await emitRoomList(); } catch (e) { console.error('emitRoomList failed after create-game', e); }
      //players.push(socket.id);
    });

    socket.on('join-room', async (roomId) => {
      if (!userId) { socket.emit('error', 'Not authenticated'); return; }
      socket.join(roomId);
      socketMeta.set(socket.id, {roomId});
      // Recomputing the inRoom count for the room based on connected sockets
      const userTimers = disconnectTimers.get(userId);
      if (userTimers && userTimers.has(roomId)) {
        const timeoutId = userTimers.get(roomId);
        clearTimeout(timeoutId);
        userTimers.delete(roomId);
        if (userTimers.size === 0) disconnectTimers.delete(userId);
        console.log(`Reconnected: canceled cleanup for user ${userId} for room ${roomId}`);
      } else if (userTimers && userTimers.size > 0) {
        console.log(`User ${userId} rejoined a different room (${roomId}), existing pending cleanup(s) remain for other rooms`);
      }

      // Update inRoom via unique user presence maps. Avoid double-counting across multiple sockets.
      try {
        if (!userRooms.has(userId)) userRooms.set(userId, new Set());
        const userRoomSetJM = userRooms.get(userId);
        if (!userRoomSetJM.has(roomId)) {
          userRoomSetJM.add(roomId);
          if (!roomOnlineUsers.has(roomId)) roomOnlineUsers.set(roomId, new Set());
          const rset = roomOnlineUsers.get(roomId);
          if (!rset.has(userId)) {
            rset.add(userId);
            try {
              const roomAfter = await prisma.room.update({ where: { id: roomId }, data: { inRoom: { increment: 1 } }, select: { inRoom: true } });
              console.log(`join-room: updated inRoom for ${roomId} to ${roomAfter.inRoom} after join by ${userId}`);
            } catch (e) {
              if (e?.code === 'P2025') {
                console.warn(`join-room: room ${roomId} does not exist when updating inRoom (skipping)`);
              } else {
                console.error('join-room: failed to update inRoom', e);
              }
            }
          }
        }
      } catch (err) {
        console.error('join-room: failed to update inRoom via roomOnlineUsers:', err);
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
      // Update server-side presence maps to ensure inRoom reflects unique users
      try {
        if (!userRooms.has(userId)) userRooms.set(userId, new Set());
        const usr = userRooms.get(userId);
        if (!usr.has(roomId)) {
          usr.add(roomId);
          if (!roomOnlineUsers.has(roomId)) roomOnlineUsers.set(roomId, new Set());
          const rset = roomOnlineUsers.get(roomId);
          if (!rset.has(userId)) {
            rset.add(userId);
            (async () => {
              try {
                await prisma.room.update({ where: { id: roomId }, data: { inRoom: { increment: 1 } } });
                await emitRoomList();
              } catch (e) {
                console.error('player-joined: failed to increment inRoom', e);
              }
            })();
          }
        }
      } catch (e) { console.error('player-joined: update presence maps failed', e); }
      // Cancel pending cleanup timers for this user+room if they exist
      const userTimers = disconnectTimers.get(userId);
      if (userTimers && userTimers.has(roomId)) {
        clearTimeout(userTimers.get(roomId));
        userTimers.delete(roomId);
        if (userTimers.size === 0) disconnectTimers.delete(userId);
        console.log(`player-joined: canceled pending cleanup for ${userId} in ${roomId}`);
      }
    });

    // Handle request for current player names
    socket.on('request-player-names', (roomId) => {
      const players = roomPlayers.get(roomId);
      if (players) {
        socket.emit('all-players-info', players);
      }
    });

    socket.on('join-game', async (roomId) => {
      if (!userId) { socket.emit('error', 'Not authenticated'); return; }
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
      console.log(`RoomParticipant upsert for user ${userId} in room ${roomId} with permission ${permission}`);
      socket.emit('assign-role', role);
      console.log(`Emitting assign-role to user ${userId} -> ${role} for room ${roomId}`);
      socket.join(roomId);
      // NOTE: inRoom increment is handled on 'join-room' to avoid double-counting
      socketMeta.set(socket.id, { roomId });
      // Cancel any pending disconnect cleanup timer for this user/room (reconnect flow)
      const userTimersJoin = disconnectTimers.get(userId);
      if (userTimersJoin && userTimersJoin.has(roomId)) {
        const timeoutId = userTimersJoin.get(roomId);
        clearTimeout(timeoutId);
        userTimersJoin.delete(roomId);
        if (userTimersJoin.size === 0) disconnectTimers.delete(userId);
        console.log(`Reconnected via join-game: canceled cleanup for user ${userId} for room ${roomId}`);
      } else if (userTimersJoin && userTimersJoin.size > 0) {
        console.log(`User ${userId} rejoined a different room (${roomId}), existing pending cleanup(s) remain for other rooms`);
      }
      if (!roomPlayers.has(roomId)) roomPlayers.set(roomId, {});
      const rp = roomPlayers.get(roomId);
      if (role === 'red' || role === 'blue') rp[role] = username;
      io.to(roomId).emit('all-players-info', rp);
      // include gameType for the redirecting client
      const joinRoom = await prisma.room.findUnique({ where: { id: roomId }, select: { gameType: true } });
      socket.emit('game-joined', { roomId, userId, token, role, username, gameType: joinRoom?.gameType || 'drop4' });
      try { socket.emit('sync-board', room.board); } catch (e) { console.error('Failed to emit sync-board to joining client:', e); }
      try { await emitRoomList(); } catch (e) { console.error('emitRoomList failed after join-game', e); }
      const channel = serverClient.channel('messaging', roomId);
      await channel.addMembers([userId]);
      // Maintain per-user room presence and update inRoom only for unique users
      try {
        if (!userRooms.has(userId)) userRooms.set(userId, new Set());
        const userRoomSet = userRooms.get(userId);
        if (!userRoomSet.has(roomId)) {
          userRoomSet.add(roomId);
          if (!roomOnlineUsers.has(roomId)) roomOnlineUsers.set(roomId, new Set());
          const rset = roomOnlineUsers.get(roomId);
          if (!rset.has(userId)) {
            rset.add(userId);
            try {
              const roomAfter = await prisma.room.update({ where: { id: roomId }, data: { inRoom: { increment: 1 } }, select: { inRoom: true } });
              console.log(`join-game: updated inRoom for ${roomId} to ${roomAfter.inRoom} after join by ${userId}`);
            } catch (e) {
              if (e?.code === 'P2025') {
                console.warn(`join-game: room ${roomId} does not exist when updating inRoom (skip)`);
              } else {
                console.error('join-game: failed to update inRoom', e);
              }
            }
          }
        }
      } catch (err) {
        console.error('join-game: failed to update inRoom via roomOnlineUsers:', err);
      }
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
      io.to(roomId).emit('scoreUpdate', { redScore:room.redScore, blueScore:room.blueScore });
    });

    socket.on('incrementRedScore', async (roomId) => {
      const room = await prisma.room.update({
        where: { id: roomId },
        data: { redScore: { increment: 1 } },
        select: { redScore: true }
      });
      try {
        io.to(roomId).emit('scoreUpdate', { redScore: room.redScore, blueScore: (await prisma.room.findUnique({ where: { id: roomId }, select: { blueScore: true } })).blueScore });
      } catch (e) { console.error('Failed to broadcast scoreUpdate for red increment', e); }
    });

    socket.on('incrementBlueScore', async (roomId) => {
      const room = await prisma.room.update({
        where: { id: roomId },
        data: { blueScore: { increment: 1 } },
        select: { blueScore: true }
      });
      try {
        io.to(roomId).emit('scoreUpdate', { blueScore: room.blueScore, redScore: (await prisma.room.findUnique({ where: { id: roomId }, select: { redScore: true } })).redScore });
      } catch (e) { console.error('Failed to broadcast scoreUpdate for blue increment', e); }
    });

    socket.on('get-rooms', async ({ gameType } = {}) => {
      console.log(`get-rooms called by socket ${socket.id} for gameType:`, gameType);
      await emitRoomList(socket, gameType);
    });

    socket.on('make-move', async ({data, roomId}) => {
      console.log(`Move received in room ${roomId}:`, data);
      // Determine current turn by counting existing pieces
      function determineCurrentPlayer(board) {
        let redCount = 0, blueCount = 0;
        for (let r = 0; r < board.length; r++) {
          for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] === 'red') redCount++;
            if (board[r][c] === 'blue') blueCount++;
          }
        }
        return redCount <= blueCount ? 'red' : 'blue';
      }
      // Fetch current board
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { board: true, gameType: true }
      });
      if (!room || !room.board) {
        console.error(`Room ${roomId} not found or board missing`);
        return;
      }
      // Update board using the relevant game module
      const board = room.board;
      const game = getGame(room.gameType) || getGame('drop4');
      let newBoard;
      // Server-side role/turn enforcement
      try {
        // find username for this userId to cleanup roomPlayers map
        let username = null;
        try {
          const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
          username = user?.username || null;
        } catch (err) {
          console.warn('Could not find user for leave-game cleanup', userId, err);
        }
        const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
        let role = 'spectator';
        if (participant) {
          if (participant.permission === 'HOST') role = 'red';
          else if (participant.permission === 'PLAYER') role = 'blue';
        }
        const currentTurn = determineCurrentPlayer(board);
        console.log(`User ${userId} role=${role} currentTurn=${currentTurn}`);
        if (role !== currentTurn) {
          console.warn(`Move rejected: user role (${role}) does not match current turn (${currentTurn})`);
          socket.emit('action-error', { message: `Not your turn (expected ${currentTurn})` });
          return;
        }
      } catch (err) {
        console.error('Error validating turn enforcement:', err);
        socket.emit('action-error', { message: 'Server error validating turn' });
        return;
      }
      try {
        if (game && typeof game.validateAction === 'function') {
          const valid = game.validateAction(board, data, { userId });
          if (!valid) {
            console.warn('Invalid action detected, rejected.');
            socket.emit('action-error', { message: 'Invalid move' });
            return;
          }
        }
        if (game && typeof game.applyAction === 'function') {
          newBoard = game.applyAction(board, data, { userId });
        } else {
          // fallback: basic array update (legacy behavior)
          const fallback = board.map(r => r.slice());
          fallback[data.row][data.col] = data.player;
          newBoard = fallback;
        }
      } catch (err) {
        console.error('Error applying action:', err);
        return;
      }

      // Save updated board to DB and eval winner via module
      const updated = await prisma.room.update({ where: { id: roomId }, data: { board: newBoard }, select: { id: true, board: true, redScore: true, blueScore: true, gameType: true } });
      // Keep board in sync in the room
      io.to(roomId).emit('sync-board', newBoard);
      // Send opponent-move to other clients (not to the actor)
      socket.to(roomId).emit('opponent-move', data);

      // detect winner/draw using game's module if exported
      try {
        const gameResult = game && typeof game.getResult === 'function' ? game.getResult(newBoard) : null;
        if (gameResult) {
          if (gameResult.winner) {
            // increment DB score for winner inside server atomically
            if (gameResult.winner === 'red') {
              const roomScore = await prisma.room.update({ where: { id: roomId }, data: { redScore: { increment: 1 } }, select: { redScore: true, blueScore: true } });
              io.to(roomId).emit('game-over', { winner: 'red', board: newBoard, redScore: roomScore.redScore, blueScore: roomScore.blueScore });
            } else {
              const roomScore = await prisma.room.update({ where: { id: roomId }, data: { blueScore: { increment: 1 } }, select: { redScore: true, blueScore: true } });
              io.to(roomId).emit('game-over', { winner: 'blue', board: newBoard, redScore: roomScore.redScore, blueScore: roomScore.blueScore });
            }
          } else if (gameResult.draw) {
            io.to(roomId).emit('game-over', { winner: null, draw: true, board: newBoard, redScore: updated.redScore, blueScore: updated.blueScore });
          }
        }
      } catch (err) {
        console.error('Error while computing game result after move:', err);
      }
      try { await emitRoomList(); } catch (e) { /* ignore */ }
    });

    socket.on('reset-game', async (roomId) => {
      // Reset using the game's initial state so different games can control defaults.
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { gameType: true } });
      const game = room && getGame(room.gameType) || getGame('drop4');
      const initialBoard = game && typeof game.getInitialState === 'function' ? game.getInitialState() : Array.from({ length: 6 }, () => Array(7).fill(0));
      const resetRoom = await prisma.room.update({ where: { id: roomId }, data: { board: initialBoard }, select: { redScore: true, blueScore: true } });
      // Broadcast the reset board to all players (include sender)
      io.to(roomId).emit('game-reset', { board: initialBoard, currentPlayer: 'red', redScore: resetRoom.redScore, blueScore: resetRoom.blueScore });
      try { await emitRoomList(); } catch (e) { /* ignore */ }
    });

    socket.on('leave-game', async (roomId ) => {
      console.log('leave-game event received for room:', roomId);
      let username = null;
      try { const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } }); username = user?.username || null; } catch (e) { /* ignore */ }
      try {
        // leave the socket room immediately so we don't route events to them
        socket.leave(roomId);
        socketMeta.delete(socket.id);
        // Do not immediately remove the participant from the DB on leave - schedule a delayed cleanup
        // to allow for brief reloads and prevent immediately kicking the host out during redirect.
        console.log(`leave-game: scheduling removal for participant ${userId} in room ${roomId} (delayed cleanup)`);
        const rp = roomPlayers.get(roomId) || {};
        // find role for this user and remove it (but preserve host name briefly if room was just created)
        const roleToRemove = username ? Object.keys(rp).find(k => rp[k] === username) : Object.keys(rp).find(k => rp[k] === undefined || rp[k] === null);
        if (roleToRemove) {
          if (roleToRemove === 'red' && recentRoomCreation.has(roomId)) {
            console.log(`leave-game: preserving HOST player ${username} in-memory during recent room create window for ${roomId}`);
          } else {
            delete rp[roleToRemove];
          }
        }
        io.to(roomId).emit('player-left', { username, role: roleToRemove || 'spectator' });
        io.to(roomId).emit('all-players-info', rp);
        try { await emitRoomList(); } catch (e) { console.error('emitRoomList failed after leave-game participant removal', e); }
      } catch (e) {
        console.error('Error processing leave-game:', e);
      }

      // Schedule a delayed cleanup which recomputes inRoom based on actual socket count (allow rejoin within grace)
      const leaveTimeout = setTimeout(async () => {
        try {
          // Use server-side unique user presence to update inRoom
          const rset = roomOnlineUsers.get(roomId) || new Set();
          const wasCounted = rset.has(userId);
          let oldroom = null;
          if (wasCounted) {
            rset.delete(userId);
            const urs = userRooms.get(userId);
            if (urs) urs.delete(roomId);
            // no op: do not remove room map entries here — they were handled in wasCounted branch
            try {
              oldroom = await prisma.room.update({ where: { id: roomId }, data: { inRoom: { decrement: 1 } }, select: { inRoom: true } });
              if (oldroom && oldroom.inRoom < 0) {
                await prisma.room.update({ where: { id: roomId }, data: { inRoom: 0 } });
                console.warn(`leave-game cleanup: clamped inRoom for ${roomId} to 0 to avoid negative`);
              }
            } catch (e) {
              if (e?.code === 'P2025') {
                console.warn(`leave-game cleanup: room ${roomId} not found when decrementing inRoom (skipping)`);
                return; // room was deleted
              }
              throw e;
            }
          } else {
            // If user was not counted, just read the latest room for checks
            try {
              oldroom = await prisma.room.findUnique({ where: { id: roomId }, select: { inRoom: true } });
            } catch (e) {
              if (e?.code === 'P2025') {
                console.warn(`leave-game cleanup: room ${roomId} not found when reading inRoom (skipping)`);
                return;
              }
              throw e;
            }
              if (rset.size === 0) roomOnlineUsers.delete(roomId);
              if (urs && urs.size === 0) userRooms.delete(userId);
          }
          const room = await prisma.room.findUnique({ where: { id: roomId }, select: { inRoom: true, participants: true } });
          const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
          console.log(`User ${userId} left room ${roomId} # current inRoom: ${room?.inRoom}`);
          if (!room || room.inRoom <= 0 || !(room.participants && room.participants.length > 0)) {
            // If the room was created recently, skip deletion to allow client redirect/reconnect
            if (recentRoomCreation.has(roomId)) {
              console.log(`Skipping deletion for recently-created room ${roomId}`);
              // schedule retry cleanup once TTL expires
              const createdAt = recentRoomCreation.get(roomId) || 0;
              const remaining = Math.max(0, (createdAt + RECENT_ROOM_TTL_MS) - Date.now());
              scheduleRetryCleanupForUser(roomId, userId, remaining + 500);
            } else {
              // Use safe helper to delete the room which avoids racing deletes
              await safeDeleteRoom(roomId);
            }
            roomPlayers.delete(roomId);
            console.log(`Room ${roomId} deleted as it became empty or had no participants`);
          }
          // If this was a leaving user, remove their participant DB entry now (unless host + recent creation window)
          try {
            if (participant && !(recentRoomCreation.has(roomId) && participant.permission === 'HOST')) {
              await prisma.roomParticipant.deleteMany({ where: { userId, roomId } });
              console.log(`Removed participant record for user ${userId} from ${roomId} during delayed leave cleanup`);
            } else if (participant && recentRoomCreation.has(roomId) && participant.permission === 'HOST') {
              console.log(`Skipping participant deletion for host ${userId} during recent creation window in ${roomId}`);
            }
          } catch (e) { console.error('Failed to delete roomParticipant during delayed leave cleanup:', e); }
          try { await emitRoomList(); } catch (e) { console.error('emitRoomList failed after leave-game cleanup', e); }
        } catch (err) {
          console.error('Error during delayed cleanup in leave-game:', err);
        }
      }, 20000); // increase grace period to 20s for leave-game

      // Store a leave cleanup so we can cancel if the user rejoins quickly
      const userTimers2 = disconnectTimers.get(userId) || new Map();
      userTimers2.set(roomId, leaveTimeout);
      disconnectTimers.set(userId, userTimers2);
      try { await emitRoomList(); } catch (e) { console.error('emitRoomList failed after leave-game', e); }
    });

    socket.on('disconnect', async () => {
      console.log(`Socket ${socket.id} disconnected`);
      // On disconnect, schedule cleanup for all rooms the user was a member of (unique-user accounting)
      const rooms = userRooms.get(userId) || new Set();
      if (!rooms || rooms.size === 0) return;
      for (const roomId of rooms) {
        // Store disconnect timer keyed by userId and roomId
        const timeoutId = setTimeout(async () => {
          console.log(`Cleaning up user ${userId} from room ${roomId} after grace period`);

        try {
            // Use the server-side roomOnlineUsers set to determine whether this unique user is still counted
            const rset = roomOnlineUsers.get(roomId) || new Set();
            const wasCounted = rset.has(userId);
            let oldroom = null;
              if (wasCounted) {
              rset.delete(userId);
              // Also drop the mapping in userRooms
              const urs = userRooms.get(userId);
              if (urs) urs.delete(roomId);
              try {
                oldroom = await prisma.room.update({ where: { id: roomId }, data: { inRoom: { decrement: 1 } } });
                if (oldroom && oldroom.inRoom < 0) {
                  await prisma.room.update({ where: { id: roomId }, data: { inRoom: 0 } });
                  console.warn(`disconnect cleanup: clamped inRoom for ${roomId} to 0 to avoid negative`);
                }
              } catch (e) {
                if (e?.code === 'P2025') {
                  console.warn(`disconnect cleanup: room ${roomId} was already deleted when decrementing inRoom (skipping)`);
                  // If the room doesn't exist, skip further cleanup for this room
                  try { socketMeta.delete(socket.id); } catch (err) { /* ignore */ }
                  const ut = disconnectTimers.get(userId);
                  if (ut && ut.has(roomId) && ut.get(roomId) === timeoutId) {
                    ut.delete(roomId);
                    if (ut.size === 0) disconnectTimers.delete(userId);
                  }
                  return;
                } else {
                  throw e;
                }
              }
              if (rset.size === 0) roomOnlineUsers.delete(roomId);
              if (urs && urs.size === 0) userRooms.delete(userId);
            }

          const room = await prisma.room.findUnique({ where: { id: roomId }, select: { inRoom: true, participants: true } });

          const participant = await prisma.roomParticipant.findUnique({
            where: { userId_roomId: { userId, roomId } }
          });

          let role = 'spectator';
          let username = null;
          try { const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } }); username = user?.username || null; } catch (e) { /* ignore */ }
          if (participant) {
            if (participant.permission === 'HOST') role = 'red';
            else if (participant.permission === 'PLAYER') role = 'blue';
          } else {
            console.warn(`No participant found for user ${userId} in room ${roomId}`);
          }

          io.to(roomId).emit('player-left', { username, role });
            try {
            // Remove participant entry for disconnected user if the cleanup matured (and not Host in TTL)
                if (participant) {
                  if (recentRoomCreation.has(roomId) && participant?.permission === 'HOST') {
                    console.log(`Skipping removal of HOST participant ${userId} during recent room creation window for ${roomId}`);
                  } else {
                    try { await prisma.roomParticipant.deleteMany({ where: { userId, roomId } }); console.log(`Removed participant record for ${userId} during disconnect cleanup in ${roomId}`); } catch (e) { /* ignore */ }
                  }
                }
            const rp = roomPlayers.get(roomId) || {};
            if (username) {
              Object.keys(rp).forEach(k => {
                if (rp[k] === username) {
                  // keep the host in-memory if the room was recently created to prevent transient UI flicker
                  if (k === 'red' && recentRoomCreation.has(roomId)) {
                    console.log(`disconnect cleanup: preserving HOST ${username} in-memory for ${roomId} due to recent creation`);
                  } else {
                    delete rp[k];
                  }
                }
              });
            } else if (role === 'red' || role === 'blue') {
              if (!(role === 'red' && recentRoomCreation.has(roomId))) {
                delete rp[role];
              } else {
                console.log(`disconnect cleanup: preserving HOST in-memory (${role}) for ${roomId} due to recent creation`);
              }
            }
            io.to(roomId).emit('all-players-info', rp);
          } catch (e) { console.error('Failed to update roomPlayers on disconnect:', e); }

          if (!room || room.inRoom <= 0 || !(room.participants && room.participants.length > 0)) {
            if (recentRoomCreation.has(roomId)) {
              console.log(`Skipping deletion for newly created room ${roomId} during disconnect cleanup`);
              // schedule retry cleanup once TTL expires
              const createdAt = recentRoomCreation.get(roomId) || 0;
              const remaining = Math.max(0, (createdAt + RECENT_ROOM_TTL_MS) - Date.now());
              setTimeout(() => { attemptRoomCleanup(roomId, userId); }, remaining + 500);
            } else {
              await safeDeleteRoom(roomId);
            }
            try { await emitRoomList(); } catch (e) { console.error('emitRoomList failed after deleting room on disconnect', e); }
          }
        } catch (err) {
          // Gracefully ignore missing room errors caused by concurrent deletion
          if (err?.code === 'P2025') {
            console.warn(`Disconnect cleanup: room ${roomId} already deleted (P2025) - ignoring`);
          } else {
            console.error(`Error cleaning up room ${roomId}:`, err);
          }
        }

        // cleanup socketMeta entries for this socket
        try { socketMeta.delete(socket.id); } catch (e) { /* ignore */ }
        const userTimers3 = disconnectTimers.get(userId);
        if (userTimers3 && userTimers3.has(roomId) && userTimers3.get(roomId) === timeoutId) {
            userTimers3.delete(roomId);
            if (userTimers3.size === 0) disconnectTimers.delete(userId);
          }
        // Remove roomPlayers state for this user in case the DB was manually cleared
          try {
          const rp = roomPlayers.get(roomId);
          if (rp) {
            // remove any entries matching this user's username if present
            Object.keys(rp).forEach(k => { if (rp[k] === username || rp[k] === undefined || rp[k] === null) delete rp[k]; });
            io.to(roomId).emit('all-players-info', rp);
            if (Object.keys(rp).length === 0) roomPlayers.delete(roomId);
          }
        } catch (e) { /* ignore */ }
      }, 20000); // 20-second grace period

        const userTimers4 = disconnectTimers.get(userId) || new Map();
        userTimers4.set(roomId, timeoutId);
        disconnectTimers.set(userId, userTimers4);
        console.log(`Set disconnect cleanup for user ${userId} in room ${roomId} with timeout ${timeoutId}`);
      }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});