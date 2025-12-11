import { StreamChat } from "stream-chat";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
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
const userSockets = new Map(); // userId -> Set<socketId>
const userRooms = new Map(); // userId -> Set<roomId>
const roomOnlineUsers = new Map(); // roomId -> Set<userId>
const disconnectTimers = new Map(); // userId -> Map<roomId, timeoutId>
const deletingRooms = new Set(); // Set<roomId> - concurrent delete marker
const recentRoomCreation = new Map(); // roomId -> timestamp (ms) to prevent immediate deletion on redirect
const RECENT_ROOM_TTL_MS = 15000; // increased to 15s  to avoid accidental deletion on quick reloads
const LEAVE_GRACE_PERIOD_MS = 15000; // 15s grace period for leave-game cleanup (allow faster rejoin)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../FrontEnd"))); // Serve frontend files
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.urlencoded({ extended: true })); // parse form bodies if needed

function setAuthCookies(res, userId, token, username) {
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
    cookie.serialize('username', username, {
      httpOnly: false,
      secure: false,
      maxAge: 60 * 60 * 24,
    }),
  ]);
}

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
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      const uname = user?.username || null;
      const rp = roomPlayers.get(roomId) || {};
      Object.keys(rp).forEach(k => { if (rp[k] === uname || rp[k] === undefined || rp[k] === null) delete rp[k]; });
      emitToRoom(roomId, 'all-players-info', rp);
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
function isAjax(req) {
  return (req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
}

// AI endpoints per game are now registered in their modules via the games loader
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../FrontEnd/login-signup/index.html"));
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
    setAuthCookies(res, userId, toke, username );

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
    setAuthCookies(res, user.id, token, username);

    if (isAjax(req)) {
      return res.json({ success: true, redirect: '/homepage.html' });
    }

    res.redirect('/homepage.html');
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/logout', (req, res) => {
  // Clear cookies 
  res.clearCookie('userId'); 
  res.clearCookie('token');  
  res.clearCookie('username');  

  if (isAjax(req)) {
    return res.json({ success: true, redirect: '/login.html' });
  }

  res.redirect('/login.html');
});

app.post('/update-username', async (req, res) => {
  const { userId, username } = req.body;
  try {
    const result = await prisma.user.update({
      where: { id: userId },
      data: { username }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Update failed:', err);
    res.status(500).json({ error: 'Could not update username' });
  }
});



app.post('/update-password', async (req, res) => {
  const { userId, current, newPass } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const valid = await bcrypt.compare(current, user.password);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });

    const hashed = await bcrypt.hash(newPass, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update password' });
  }
});

// Creating the system bot for temporary second player
(async () => {
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
    // Remove participants from DB
    try {
      await prisma.roomParticipant.deleteMany({ where: { roomId } });
    } catch (err) {
      console.warn(`safeDeleteRoom: failed to delete participants for ${roomId}`, err.message);
    }

    // Delete the room record
    try {
      await prisma.room.delete({ where: { id: roomId } });
      console.log(`safeDeleteRoom: deleted room ${roomId}`);
    } catch (err) {
      if (err?.code === 'P2025') {
        console.warn(`safeDeleteRoom: room ${roomId} already deleted`);
      } else {
        console.error(`safeDeleteRoom: failed to delete room ${roomId}`, err);
      }
    }

    // Clean up in‑memory maps
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
    } catch (err) {
      console.error(`safeDeleteRoom: failed to clean in‑memory maps for ${roomId}`, err);
    }

    // Delete Stream channel to avoid orphaned chats
    try {
      const channel = serverClient.channel('messaging', roomId);
      await channel.delete();
      console.log(`safeDeleteRoom: deleted Stream channel for room ${roomId}`);
    } catch (err) {
      console.warn(`safeDeleteRoom: Stream channel delete failed for ${roomId}`, err.message);
    }

  } finally {
    deletingRooms.delete(roomId);
  }
}


function emitToRoom(roomId, event, payload) {
  const userIds = roomOnlineUsers.get(roomId) || new Set();
  const targets = [];
  for (const uid of userIds) {
    const sockets = userSockets.get(uid) || new Set();
    for (const sid of sockets) targets.push(sid);
  }
  console.log(`[emitToRoom] ${event} -> room ${roomId} users=${userIds.size} sockets=${targets.length}`);
  for (const sid of targets) io.to(sid).emit(event, payload);
}

function emitToRoomExcept(roomId, exceptUserId, event, payload) {
  const userIds = roomOnlineUsers.get(roomId) || new Set();
  const targets = [];
  for (const uid of userIds) {
    if (uid === exceptUserId) continue;
    const sockets = userSockets.get(uid) || new Set();
    for (const sid of sockets) targets.push(sid);
  }
  console.log(`[emitToRoomExcept] ${event} -> room ${roomId} excluding ${exceptUserId} sockets=${targets.length}`);
  for (const sid of targets) io.to(sid).emit(event, payload);
}


async function removeUserFromRoom(userId, roomId) {
  const urs = userRooms.get(userId);
  if (urs) {
    urs.delete(roomId);
    if (urs.size === 0) userRooms.delete(userId);
  }
  const rset = roomOnlineUsers.get(roomId);
  if (rset) {
    const hadUser = rset.delete(userId);
    if (hadUser) {
      try {
        const roomAfter = await prisma.room.update({
          where: { id: roomId },
          data: { inRoom: { decrement: 1 } },
          select: { inRoom: true }
        });
        if (roomAfter.inRoom < 0) {
          await prisma.room.update({ where: { id: roomId }, data: { inRoom: 0 } });
        }
      } catch (e) {
        if (e?.code !== 'P2025') console.error('removeUserFromRoom: decrement failed', e);
      }
    }
    if (rset.size === 0) roomOnlineUsers.delete(roomId);
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

io.on('connection', (socket) => {
  const cookies = cookie.parse(socket.handshake.headers.cookie || '');
  const userId = cookies.userId;
  if (!userId) {
    console.warn('Connection without userId, ignoring');
    return;
  }

  // Register this socket under the user
  const sset = userSockets.get(userId) || new Set();
  sset.add(socket.id);
  userSockets.set(userId, sset);
  console.log(`Registered socket ${socket.id} for user ${userId}`);

  // Rejoin any rooms this user is already in
  const rooms = userRooms.get(userId);
  if (rooms) {
    for (const roomId of rooms) {
      socket.join(roomId); // critical: ensures new socket is in the room
      const rset = roomOnlineUsers.get(roomId) || new Set();
      rset.add(userId);
      roomOnlineUsers.set(roomId, rset);
      console.log(`Rejoined socket ${socket.id} to room ${roomId} for user ${userId}`);
    }
  }

  socket.on('create-game', async ({ gameType } = {}) => {
    if (!userId) { socket.emit('error', 'Not authenticated'); return; }

    const game = getGame(gameType);
    if (!game) { socket.emit('error', 'Invalid game type'); return; }

    // Relaxed guard: accept any valid initial state
    const initialState = game.getInitialState?.();
    if (!initialState) {
      socket.emit('error', 'Game failed to initialize');
      return;
    }

    const roomId = crypto.randomUUID();

    // Create room in DB
    await prisma.room.create({
      data: {
        id: roomId,
        host: { connect: { id: userId } },
        isPublic: true,
        board: initialState,
        gameType: game.name,
        inRoom: 1
      }
    });

    // Explicitly mark host as HOST participant
    await prisma.roomParticipant.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { roomId, userId, permission: 'HOST' },
      update: { permission: 'HOST' }
    });

    // Presence tracking
    if (!userRooms.has(userId)) userRooms.set(userId, new Set());
    userRooms.get(userId).add(roomId);
    if (!roomOnlineUsers.has(roomId)) roomOnlineUsers.set(roomId, new Set());
    roomOnlineUsers.get(roomId).add(userId);

    socket.join(roomId);

    // Players map
    if (!roomPlayers.has(roomId)) roomPlayers.set(roomId, {});
    const pList = roomPlayers.get(roomId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    pList['red'] = user.username; // host always red

    emitToRoom(roomId, 'all-players-info', pList);
    socket.emit('assign-role', 'red');
    emitToRoom(roomId, 'sync-board', initialState);

    socket.emit('game-created', {
      roomId,
      userId,
      role: 'red',
      username: user.username,
      gameType: game.name
    });

    // Create Stream channel for this room
    const channel = serverClient.channel('messaging', roomId, {
      created_by_id: userId,
      members: [userId],
    });
    await channel.create();
  });

    socket.on('join-room', async (roomId) => {
      if (!roomId || !userId) return;

      // Subscribe this socket to the Socket.IO room
      socket.join(roomId);

      // Track presence in memory
      const urs = userRooms.get(userId) || new Set();
      urs.add(roomId);
      userRooms.set(userId, urs);

      const rset = roomOnlineUsers.get(roomId) || new Set();
      rset.add(userId);
      roomOnlineUsers.set(roomId, rset);

      console.log(`[join-room] user ${userId} socket ${socket.id} joined ${roomId}`);

      // Update DB inRoom count to reflect actual connected users
      try {
        await prisma.room.update({
          where: { id: roomId },
          data: { inRoom: rset.size }
        });
        console.log(`[join-room] updated inRoom for ${roomId} to ${rset.size}`);
      } catch (err) {
        console.error('[join-room] failed to update inRoom', err);
      }

      // Optionally emit confirmation back to the client
      socket.emit('room-joined', { roomId, userId });
    });

    
    socket.on('chat-message', (msg) => {
      // msg: { roomId, user, role, text }
      if (!msg?.roomId || !msg?.text) return;
      io.to(msg.roomId).emit('chat-message', msg);
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
      emitToRoom(roomId, 'all-players-info', players);
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
      if (!room) { socket.emit('error', 'Room not found'); return; }
      const game = getGame(room.gameType);
      if (!game) { socket.emit('error', 'Game module not found'); return; }

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
        update: { permission }
      });

      console.log(`RoomParticipant upsert for user ${userId} in room ${roomId} with permission ${permission}`);
      socket.emit('assign-role', role);
      console.log(`Emitting assign-role to user ${userId} -> ${role} for room ${roomId} (socket ${socket.id})`);
      socket.join(roomId);
      // NOTE: inRoom increment is handled on 'join-room' to avoid double-counting
      socketMeta.set(socket.id, { roomId });
      // If this user has other active rooms, force them to leave those rooms (we assume single active game per user)
      try {
        const prev = userRooms.get(userId) || new Set();
        for (const r of Array.from(prev)) {
          if (r !== roomId) {
            await forceLeaveRoom(userId, r);
          }
        }
      } catch (e) { console.error('join-game: failed to force leave previous rooms', e); }
      // Cancel any pending disconnect cleanup timer for this user/room (reconnect flow)
      const userTimersJoin = disconnectTimers.get(userId);
      if (userTimersJoin && userTimersJoin.has(roomId)) {
        const timeoutId = userTimersJoin.get(roomId);
        clearTimeout(timeoutId);
        userTimersJoin.delete(roomId);
        if (userTimersJoin.size === 0) disconnectTimers.delete(userId);
        console.log(`Reconnected via join-game: canceled disconnect cleanup for user ${userId} for room ${roomId}`);
      }
      // Also cancel any pending leave-game timeout for this user/room
      const userLeaveTimersJoin = disconnectTimers.get(userId);
      if (userLeaveTimersJoin && userLeaveTimersJoin.has(roomId)) {
        const leaveTimeoutId = userLeaveTimersJoin.get(roomId);
        clearTimeout(leaveTimeoutId);
        userLeaveTimersJoin.delete(roomId);
        if (userLeaveTimersJoin.size === 0) disconnectTimers.delete(userId);
        console.log(`Reconnected via join-game: canceled leave-game cleanup for user ${userId} for room ${roomId}`);
      }
      if (!roomPlayers.has(roomId)) roomPlayers.set(roomId, {});
      const rp = roomPlayers.get(roomId);
      if (role === 'red' || role === 'blue') rp[role] = username;
      emitToRoom(roomId,  'all-players-info', rp);
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

    // client-side handshake to ensure socket listener registration before sending authoritative board
    socket.on('ready-for-sync', async (roomId) => {
      try {
        const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true } });
        console.log(`ready-for-sync: sending board to socket ${socket.id} for room ${roomId}`);
        if (room) socket.emit('sync-board', room.board);
      } catch (e) {
        console.error('ready-for-sync handler error:', e);
      }
    });

    socket.on('leaderboard-update', async ({userId,gameType,score})=>{
      if(gameType=='sliceWorld'){
        const leaderboard = await prisma.leaderboard.findUnique({
          where: {gameType_userId:{gameType: gameType, userId: userId}},
          select: {wins: true}
        })
        if(leaderboard == null){
            await prisma.leaderboard.upsert({
            where: { gameType_userId: { gameType, userId } },
            create: { gameType: gameType, userId: userId, wins: score},
            update: { wins: score }
          })
        } else {
          if(leaderboard.wins < score){
          await prisma.leaderboard.upsert({
            where: { gameType_userId: { gameType, userId } },
            create: { gameType: gameType, userId: userId, wins: score},
            update: { wins: score }
          })}
        }
      } else{
        await prisma.leaderboard.upsert({
          where: { gameType_userId: { gameType, userId } },
          create: { gameType: gameType, userId: userId, wins: 1},
          update: { wins:{increment: 1}}
        })
        await prisma.user.update({
          where: {id: userId},
          data: {totalWins:{increment: 1}},
          select: {totalWins:true}
        })
      }
    });

    socket.on('request-leaderboard', async ({ gameType, userId }) => {
      try {
        // 1. Get top 10 players for this game
        const top10 = await prisma.leaderboard.findMany({
          where: { gameType },
          orderBy: { wins: 'desc' },
          take: 10,
          include: { user: true } // optional: get username
        });

        // 2. Get requesting user's leaderboard entry
        const userEntry = await prisma.leaderboard.findUnique({
          where: { gameType_userId: { gameType, userId } },
          include: { user: true }
        });

        // 3. Get user's rank (count how many have more wins)
        let userRank = null;
        if (userEntry) {
          const countAbove = await prisma.leaderboard.count({
            where: {
              gameType,
              wins: { gt: userEntry.wins }
            }
          });
          userRank = countAbove + 1;
        }

        // 4. Check if user is in top 10
        const isInTop10 = top10.some(entry => entry.userId === userId);

        // 5. Emit leaderboard data back to client
        socket.emit('leaderboard-response', {
              gameType,
              top10: top10.map((entry, i) => ({
                rank: i + 1,
                username: entry.user.username,
                wins: entry.wins,
                userId: entry.userId
              })),
              user: userEntry
                ? {
                    username: userEntry.user.username,
                    wins: userEntry.wins,
                    rank: userRank,
                    isInTop10
                  }
                : null
            });
        } catch (err) {
          console.error('Leaderboard error:', err);
          socket.emit('leaderboard-error', { message: 'Failed to load leaderboard.' });
        }
    });

    socket.on('getScores', async (roomId) => {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { redScore: true, blueScore: true }
      });
      emitToRoom(roomId,  'scoreUpdate', { redScore:room.redScore, blueScore:room.blueScore });
    });

    socket.on('incrementRedScore', async (roomId) => {
      const room = await prisma.room.update({
        where: { id: roomId },
        data: { redScore: { increment: 1 } },
        select: { redScore: true }
      });
      try {
        emitToRoom(roomId,  'scoreUpdate', { redScore: room.redScore, blueScore: (await prisma.room.findUnique({ where: { id: roomId }, select: { blueScore: true } })).blueScore });
      } catch (e) { console.error('Failed to broadcast scoreUpdate for red increment', e); }
    });

    socket.on('incrementBlueScore', async (roomId) => {
      const room = await prisma.room.update({
        where: { id: roomId },
        data: { blueScore: { increment: 1 } },
        select: { blueScore: true }
      });
      try {
        emitToRoom(roomId,  'scoreUpdate', { blueScore: room.blueScore, redScore: (await prisma.room.findUnique({ where: { id: roomId }, select: { redScore: true } })).redScore });
      } catch (e) { console.error('Failed to broadcast scoreUpdate for blue increment', e); }
    });

    socket.on('get-rooms', async ({ gameType } = {}) => {
      console.log(`get-rooms called by socket ${socket.id} for gameType:`, gameType);
      await emitRoomList(socket, gameType);
    });

    socket.on('make-move', async ({ data, roomId }) => {
      console.log(`Move received in room ${roomId}:`, data);

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

      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { board: true, gameType: true }
      });
      if (!room || !room.board) return;

      const board = room.board;
      const game = getGame(room.gameType) || getGame('drop4');
      let newBoard;

      // Turn enforcement
      const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
      let role = 'spectator';
      if (participant) {
        if (participant.permission === 'HOST') role = 'red';
        else if (participant.permission === 'PLAYER') role = 'blue';
      }
      const currentTurn = determineCurrentPlayer(board);
      if (role !== currentTurn) {
        socket.emit('action-error', { message: `Not your turn (expected ${currentTurn})` });
        return;
      }

      // Apply action
      if (game?.validateAction && !game.validateAction(board, data, { userId })) {
        socket.emit('action-error', { message: 'Invalid move' });
        return;
      }
      newBoard = game?.applyAction ? game.applyAction(board, data, { userId }) : board;

      const updated = await prisma.room.update({
        where: { id: roomId },
        data: { board: newBoard },
        select: { id: true, board: true, redScore: true, blueScore: true, gameType: true }
      });

      // Broadcast board
      emitToRoom(roomId, 'sync-board', newBoard);

      // Send opponent move to everyone except actor
      emitToRoomExcept(roomId, userId, 'opponent-move', data);

      // Detect winner/draw
      const gameResult = game?.getResult ? game.getResult(newBoard) : null;
      if (gameResult) {
        if (gameResult.winner) {
          const winner = gameResult.winner;
          const roomScore = await prisma.room.update({
            where: { id: roomId },
            data: winner === 'red' ? { redScore: { increment: 1 } } : { blueScore: { increment: 1 } },
            select: { redScore: true, blueScore: true }
          });
          emitToRoom(roomId, 'game-over', { winner, board: newBoard, redScore: roomScore.redScore, blueScore: roomScore.blueScore });
        } else if (gameResult.draw) {
          emitToRoom(roomId, 'game-over', { winner: null, draw: true, board: newBoard, redScore: updated.redScore, blueScore: updated.blueScore });
        }
      }

      await emitRoomList();
    });


    // sinkEm-specific handlers
    socket.on('place-ships', async ({ roomId, layout } = {}) => {
      if (!userId) { socket.emit('action-error', { message: 'Not authenticated' }); return; }

      try {
        const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true, gameType: true } });
        if (!room) { socket.emit('action-error', { message: 'Room not found' }); return; }

        const game = getGame(room.gameType);
        if (!game) { socket.emit('action-error', { message: 'Game module not found' }); return; }

        const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
        if (!participant) { socket.emit('action-error', { message: 'Not a participant' }); return; }

        const role = participant.permission === 'HOST' ? 'red' : (participant.permission === 'PLAYER' ? 'blue' : 'spectator');
        if (role === 'spectator') { socket.emit('action-error', { message: 'Spectator cannot place ships' }); return; }

        const action = { type: 'place', color: role, layout };
        if (!game.validateAction(room.board, action)) {
          socket.emit('action-error', { message: 'Invalid ship layout' });
          return;
        }

        const res = game.applyAction(room.board, action, { userId, role });
        const newBoard = res?.board || res;

        await prisma.room.update({ where: { id: roomId }, data: { board: newBoard } });
        const updatedRoom = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true } });

        // Log presence from your own maps
        const userIds = roomOnlineUsers.get(roomId) || new Set();
        console.log(`[PLACE-SHIPS] sync-board targets for room ${roomId}: users=${userIds.size}`);

        emitToRoom(roomId, 'sync-board', updatedRoom.board);
        socket.emit('placed-ships', { success: true });
      } catch (err) {
        console.error('place-ships handler error:', err);
        socket.emit('action-error', { message: 'Error placing ships' });
      }
    });

    socket.on('attack', async ({ roomId, x, y } = {}) => {
      if (!userId) { socket.emit('action-error', { message: 'Not authenticated' }); return; }

      try {
        const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true, gameType: true } });
        if (!room) { socket.emit('action-error', { message: 'Room not found' }); return; }

        const game = getGame(room.gameType);
        if (!game) { socket.emit('action-error', { message: 'Game module not found' }); return; }

        const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
        if (!participant) { socket.emit('action-error', { message: 'Not a participant' }); return; }

        const role = participant.permission === 'HOST' ? 'red' : (participant.permission === 'PLAYER' ? 'blue' : 'spectator');
        if (role === 'spectator') { socket.emit('action-error', { message: 'Spectator cannot attack' }); return; }

        const action = { type: 'attack', x, y, player: role };
        if (!game.validateAction(room.board, action)) {
          socket.emit('action-error', { message: 'Invalid attack' });
          return;
        }

        const res = game.applyAction(room.board, action, { userId, role });
        const newBoard = res?.board || res;
        const details = { ...(res?.details || { hit: false, sunk: null }), x, y, player: role };

        const updatedRoom = await prisma.room.update({
          where: { id: roomId },
          data: { board: newBoard },
          select: { redScore: true, blueScore: true, board: true }
        });

        console.log(`[ATTACK] User ${userId} (${role}) attacked ${x},${y} in room ${roomId}. Hit: ${details.hit}, Turn now: ${newBoard.turn}`);

        // Log presence from your own maps
        const userIds = roomOnlineUsers.get(roomId) || new Set();
        console.log(`[ATTACK] sync-board targets for room ${roomId}: users=${userIds.size}`);

        emitToRoom(roomId, 'sync-board', newBoard);
        emitToRoom(roomId, 'attack-result', details);

        const result = game.getResult(newBoard);
        if (result?.winner) {
          emitToRoom(roomId, 'game-over', {
            winner: result.winner,
            board: newBoard,
            redScore: updatedRoom.redScore,
            blueScore: updatedRoom.blueScore
          });
        }
      } catch (err) {
        console.error('attack handler error:', err);
        socket.emit('action-error', { message: 'Error handling attack' });
      }
    });

    socket.on('add-totalgames', async (userId) =>{
      await prisma.user.update({
            where: { id: userId },
            data: { totalGames: { increment: 1 } }
      });
    });

    socket.on('totals-request', async (userId) => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { totalWins: true, totalGames: true }
      });

      const totalLosses = user.totalGames - user.totalWins;

      socket.emit('totals-response', {
        totalGames: user.totalGames,
        totalWins: user.totalWins,
        totalLosses: totalLosses
      });
    });

    socket.on('favorite-games-request', async (userId) => {

    const favorites = await prisma.leaderboard.findMany({
      where: { userId },
      orderBy: { wins: 'desc' },
      take: 5
    });
    socket.emit('favorite-games-response', favorites);
  });


    socket.on('reset-game', async (roomId) => {
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { gameType: true } });
      const game = room && getGame(room.gameType) || getGame('drop4');
      const initialBoard = game?.getInitialState ? game.getInitialState() : Array.from({ length: 6 }, () => Array(7).fill(0));

      const resetRoom = await prisma.room.update({
        where: { id: roomId },
        data: { board: initialBoard },
        select: { redScore: true, blueScore: true }
      });

      // Broadcast reset to all players
      emitToRoom(roomId, 'game-reset', {
        board: initialBoard,
        currentPlayer: 'red',
        redScore: resetRoom.redScore,
        blueScore: resetRoom.blueScore
      });

      await emitRoomList();
    });


    socket.on('leave-game', async (roomId) => {
      console.log('leave-game event received for room:', roomId);

      let username = null;
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
        username = user?.username || null;
      } catch (e) { /* ignore */ }

      // Update in-memory players
      const rp = roomPlayers.get(roomId) || {};
      const roleToRemove = username ? Object.keys(rp).find(k => rp[k] === username) : null;
      if (roleToRemove) {
        if (roleToRemove === 'red' && recentRoomCreation.has(roomId)) {
          console.log(`leave-game: preserving HOST ${username} during recent room create window for ${roomId}`);
        } else {
          delete rp[roleToRemove];
        }
      }

      emitToRoom(roomId, 'player-left', { username, role: roleToRemove || 'spectator' });
      emitToRoom(roomId, 'all-players-info', rp);

      // Schedule delayed cleanup with grace period
      const leaveTimeout = setTimeout(async () => {
        try {
          await removeUserFromRoom(userId, roomId); // centralized helper

          const room = await prisma.room.findUnique({ where: { id: roomId }, include: { participants: true } });
          const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });

          console.log(`User ${userId} left room ${roomId} # current inRoom: ${room?.inRoom}`);

          let shouldDeleteRoom = false;
          if (!room || room.inRoom <= 0 || room.participants.length === 0) {
            if (recentRoomCreation.has(roomId)) {
              console.log(`Skipping deletion for recently-created room ${roomId}`);
              const createdAt = recentRoomCreation.get(roomId) || 0;
              const remaining = Math.max(0, (createdAt + RECENT_ROOM_TTL_MS) - Date.now());
              scheduleRetryCleanupForUser(roomId, userId, remaining + 500);
            } else {
              await safeDeleteRoom(roomId);
              shouldDeleteRoom = true;
            }
            if (shouldDeleteRoom) {
              roomPlayers.delete(roomId);
              console.log(`Room ${roomId} deleted as it became empty`);
            }
          }

          // Remove participant only if room was deleted
          if (shouldDeleteRoom && participant) {
            await prisma.roomParticipant.deleteMany({ where: { userId, roomId } });
            console.log(`Removed participant record for user ${userId} from ${roomId} during delayed leave cleanup`);
          }
          await emitRoomList();
        } catch (err) {
          console.error('Error during delayed cleanup in leave-game:', err);
        }
      }, LEAVE_GRACE_PERIOD_MS);

      // Store timer so it can be canceled if user rejoins quickly
      const userTimers = disconnectTimers.get(userId) || new Map();
      userTimers.set(roomId, leaveTimeout);
      disconnectTimers.set(userId, userTimers);

      await emitRoomList();
    });


    socket.on('disconnect', () => {
      const sset = userSockets.get(userId);
      if (sset) {
        sset.delete(socket.id);

        if (sset.size === 0) {
          // Schedule delayed cleanup instead of immediate removal
          const rooms = userRooms.get(userId) || new Set();
          for (const roomId of rooms) {
            console.log(`Scheduling disconnect cleanup for user ${userId} in room ${roomId}`);

            const timeoutId = setTimeout(async () => {
              const activeSockets = userSockets.get(userId);
              if (!activeSockets || activeSockets.size === 0) {
                await removeUserFromRoom(userId, roomId); // centralized helper
                console.log(`Cleaned up user ${userId} from room ${roomId} after disconnect grace`);
              } else {
                console.log(`User ${userId} reconnected, skipping cleanup for room ${roomId}`);
              }
            }, LEAVE_GRACE_PERIOD_MS);

            const userTimers = disconnectTimers.get(userId) || new Map();
            userTimers.set(roomId, timeoutId);
            disconnectTimers.set(userId, userTimers);
          }
        } else {
          console.log(`User ${userId} still has active sockets, skipping cleanup`);
        }
      }
    });
  });

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
