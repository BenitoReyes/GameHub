import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import { fileURLToPath } from "url";
import path from "path";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { StreamChat } from "stream-chat";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { initGames, getGame } from "./games/index.js";
import crypto from "crypto";
import bcrypt from "bcrypt";
import cookie from "cookie";
import { v4 } from "uuid";

import {
  initPresence,
  joinRoom,
  leaveRoom,
  handleDisconnect,
  emitToRoom,      // presence's emit helper
  forceLeaveRoom,  // presence's force leave wrapper
  safeDeleteRoom,
  markRoomCreated,
  _getMemoryMaps
} from "./presence.js";

// --- Prisma + Stream + app + io setup ---
const prisma = new PrismaClient().$extends(withAccelerate());
const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_SECRET = process.env.STREAM_SECRET;
const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// serve static
app.use(express.static(path.join(__dirname, "../FrontEnd")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper to set cookies on signup/login
function setAuthCookies(res, userId, token, username) {
  res.setHeader("Set-Cookie", [
    cookie.serialize("userId", userId, {
      httpOnly: false,
      secure: false,
      maxAge: 60 * 60 * 24
    }),
    cookie.serialize("token", token, {
      httpOnly: false,
      secure: false,
      maxAge: 60 * 60 * 24
    }),
    cookie.serialize("username", username, {
      httpOnly: false,
      secure: false,
      maxAge: 60 * 60 * 24
    })
  ]);
}

// -------------------------------
// In-memory structures the server still uses (not presence state)
// -------------------------------
const socketMeta = new Map(); // optional meta per socket (you used earlier)
const roomPlayers = new Map(); // roomId -> { red: username, blue: username }
const LEAVE_GRACE_PERIOD_MS = 15000;
const RECENT_ROOM_TTL_MS = 15000;

// ---------- emitRoomList ----------
async function emitRoomList(socket = null, gameType = null) {
  try {
    const where = { isPublic: true };
    if (gameType) where.gameType = gameType;
    const rooms = await prisma.room.findMany({
      where,
      select: { id: true, host: true, gameType: true, participants: true, inRoom: true }
    });
    if (socket && typeof socket.emit === "function") {
      socket.emit("room-list", rooms);
    } else {
      io.emit("room-list", rooms);
    }
  } catch (err) {
    console.error("Failed to emit room list:", err);
  }
}

// -----------------------------
// Signup / Login / Logout routes
// -----------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../FrontEnd/login-signup/index.html"));
});

app.get("/config", (req, res) => {
  res.json({ apiKey: process.env.STREAM_API_KEY });
});

app.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    const userId = v4();
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const user = await prisma.user.create({
      data: { id: userId, username, password: hashedPassword }
    });

    await serverClient.upsertUser({ id: userId, name: username });
    const token = serverClient.createToken(userId);

    setAuthCookies(res, userId, token, username);

    if ((req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest") {
      return res.json({ success: true, redirect: "/homepage.html" });
    }

    res.redirect("/homepage.html");
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    await prisma.$connect();

    const user = await prisma.user.findUnique({ where: { username } });
    const valid = user && (await bcrypt.compare(password, user.password));

    if (!valid) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    const token = serverClient.createToken(user.id);
    setAuthCookies(res, user.id, token, username);

    if ((req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest") {
      return res.json({ success: true, redirect: "/homepage.html" });
    }

    res.redirect("/homepage.html");
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("userId");
  res.clearCookie("token");
  res.clearCookie("username");
  if ((req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest") {
    return res.json({ success: true, redirect: "/login.html" });
  }
  res.redirect("/login.html");
});

app.post("/update-username", async (req, res) => {
  const { userId, username } = req.body;
  try {
    await prisma.user.update({ where: { id: userId }, data: { username } });
    res.json({ success: true });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ error: "Could not update username" });
  }
});

app.post("/update-password", async (req, res) => {
  const { userId, current, newPass } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const valid = await bcrypt.compare(current, user.password);
    if (!valid) return res.status(400).json({ error: "Current password incorrect" });

    const hashed = await bcrypt.hash(newPass, 10);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Could not update password" });
  }
});

// Create system bot
(async () => {
  await serverClient.upsertUser({ id: "system-bot", name: "System Bot" });
})();

// -----------------------------
// Initialize games loader & presence
// -----------------------------
await initGames({ app, io, prisma, serverClient });

// Initialize presence after games (and after emitRoomList definition)
initPresence({
  io,
  serverClient,
  roomPlayers,
  emitRoomList,
  graceMs: LEAVE_GRACE_PERIOD_MS,
  recentRoomTtl: RECENT_ROOM_TTL_MS
});

// ---------------------------------
// Defensive periodic sweep (uses DB only; presence controls deletion)
// ---------------------------------
setInterval(async () => {
  try {
    const rooms = await prisma.room.findMany({ include: { participants: true } });
    for (const r of rooms) {
      try {
        // Calculate connected sockets for this room using presence memory if available
        const maps = _getMemoryMaps();
        const rset = (maps.roomUsers && maps.roomUsers.get(r.id)) || new Set();
        const connected = rset ? rset.size : 0;

        // Fix DB inRoom if inconsistent
        if (r.inRoom !== connected) {
          await prisma.room.updateMany({ where: { id: r.id }, data: { inRoom: connected } });
          console.log(`Periodic sweep: corrected inRoom for ${r.id} to ${connected}`);
        }

        // If DB says empty and participants empty, delegate to presence safeDeleteRoom
        const roomLatest = await prisma.room.findUnique({ where: { id: r.id }, include: { participants: true } });
        if ((!roomLatest || roomLatest.inRoom <= 0) && (!roomLatest || (roomLatest.participants && roomLatest.participants.length === 0))) {
          // respect recent creation TTL by presence if needed; presence.safeDeleteRoom is safe
          await safeDeleteRoom(r.id);
        }
      } catch (err) {
        console.error("Error processing room in periodic sweep", r.id, err);
      }
    }
    await emitRoomList();
  } catch (err) {
    console.error("Error during periodic room sweep", err);
  }
}, 10000); // every 10s

// -----------------------------
// Socket.io connection handling
// -----------------------------
io.on("connection", (socket) => {
  const cookies = cookie.parse(socket.handshake.headers.cookie || "");
  const userId = cookies.userId;
  if (!userId) {
    console.warn("Connection without userId, ignoring");
    return;
  }

  // store optional socket metadata
  socketMeta.set(socket.id, { userId, connectedAt: Date.now() });

  // No manual presence maps here - delegate to presence.joinRoom when they join
  console.log(`Registered socket ${socket.id} for user ${userId}`);

  // If the client stores rooms in cookies/local state and wants to rejoin, it should call join-game/join-room.
  // If you want to auto-rejoin rooms from DB, you can fetch user roomParticipants here and call joinRoom for each.
  // For now we rely on client to call join-game/create-game which call joinRoom.

  // --------------------------
  // Socket handlers
  // --------------------------

  socket.on("create-game", async ({ gameType } = {}) => {
    if (!userId) return socket.emit("error", "Not authenticated");

    const game = getGame(gameType);
    if (!game) return socket.emit("error", "Invalid game type");

    const initialState = game.getInitialState?.();
    if (!initialState) return socket.emit("error", "Game failed to initialize");

    const roomId = crypto.randomUUID();

    // Create Room in DB (host counts as 1 initially)
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

    // Mark host participant
    await prisma.roomParticipant.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { roomId, userId, permission: "HOST" },
      update: { permission: "HOST" }
    });

    // mark room created recently to protect from immediate deletion on redirect
    markRoomCreated(roomId);

    // Join socket.io room (adds socket to socket.io's internal room)
    socket.join(roomId);

    // Presence: register user/socket into presence module
    await joinRoom({ userId, roomId, socket });

    // Players map + broadcast
    if (!roomPlayers.has(roomId)) roomPlayers.set(roomId, {});
    const pList = roomPlayers.get(roomId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    pList["red"] = user.username;

    emitToRoom(roomId, "all-players-info", pList);
    socket.emit("assign-role", "red");
    emitToRoom(roomId, "sync-board", initialState);

    socket.emit("game-created", {
      roomId,
      userId,
      role: "red",
      username: user.username,
      gameType: game.name
    });

    // Create Stream chat channel
    const channel = serverClient.channel("messaging", roomId, {
      created_by_id: userId,
      members: [userId]
    });
    await channel.create();

    await emitRoomList();
  });

  socket.on("chat-message", async (msg) => {
  try {
    const { roomId, text, userId } = msg;
    if (!roomId || !text || !userId) return;

    const channel = _serverClient.channel("messaging", roomId);
    const message = await channel.sendMessage({
      text,
      user: { id: userId }
    });
    await joinRoom({ userId, roomId, socket });
    // Use presence to broadcast to all sockets
    emitToRoom(roomId, "chat-message", {
      id: message.id,
      text: message.text,
      userId,
      created_at: message.created_at
    });
  } catch (e) {
    console.error("[chat-message] error sending message:", e);
  }
});

  socket.on("player-joined", async ({ roomId, role, username }) => {
    console.log(`Player ${username} (${role}) joined room ${roomId}`);

    if (!roomPlayers.has(roomId)) roomPlayers.set(roomId, {});
    const players = roomPlayers.get(roomId);
    if (role === "red" || role === "blue") players[role] = username;

    emitToRoom(roomId, "all-players-info", players);

    // Presence: register the socket+user if not already (cancel timers)
    try {
      // ensure socket is tracked in presence
      await joinRoom({ userId, roomId, socket });
    } catch (e) {
      console.error("player-joined: joinRoom failed", e);
    }

    await emitRoomList();
  });

  socket.on("join-game", async (roomId) => {
    if (!userId) return socket.emit("error", "Not authenticated");

    const token = serverClient.createToken(userId);
    const room = await prisma.room.findFirst({ where: { id: roomId }, include: { participants: true } });
    if (!room) return socket.emit("error", "Room not found");

    const game = getGame(room.gameType);
    if (!game) return socket.emit("error", "Game module not found");

    const roomPartnum = room.participants.length || 0;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const username = user.username;

    // assign role logic
    let role;
    let permission;
    const participant = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId } }
    });

    if (!participant) {
      if (roomPartnum >= 2) {
        role = "spectator";
        permission = "SPECTATOR";
      } else {
        role = "blue";
        permission = "PLAYER";
      }
    } else {
      if (participant.permission === "PLAYER") role = "blue";
      else if (participant.permission === "HOST") role = "red";
      else role = "spectator";
      permission = participant.permission;
    }

    await prisma.roomParticipant.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { roomId, userId, permission },
      update: { permission }
    });

    socket.emit("assign-role", role);

    // Join Socket.IO room
    socket.join(roomId);

    // Presence system
    await joinRoom({ userId, roomId, socket });

    // Player list / board sync
    if (!roomPlayers.has(roomId)) roomPlayers.set(roomId, {});
    const rp = roomPlayers.get(roomId);
    if (role === "red" || role === "blue") rp[role] = username;

    emitToRoom(roomId, "all-players-info", rp);

    socket.emit("game-joined", { roomId, userId, token, role, username, gameType: room.gameType });
    socket.emit("sync-board", room.board);

    try { await emitRoomList(); } catch (e) { console.error("emitRoomList failed", e); }

    const channel = serverClient.channel("messaging", roomId);
    await channel.addMembers([userId]);
  });

  socket.on("request-board", async (roomId) => {
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true } });
    if (room) socket.emit("sync-board", room.board);
  });

  socket.on("ready-for-sync", async (roomId) => {
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true } });
      if (room) socket.emit("sync-board", room.board);
    } catch (e) { console.error("ready-for-sync handler error:", e); }
  });

  // leaderboard, game actions, etc. — keep as-is but DO NOT modify presence maps directly
  socket.on("leaderboard-update", async ({ userId: uid, gameType, score }) => {
    // same logic as before, using uid to avoid shadowing outer userId
    try {
      if (gameType === "sliceWorld" || gameType === "pigLaunch") {
        const leaderboard = await prisma.leaderboard.findUnique({
          where: { gameType_userId: { gameType, userId: uid } },
          select: { wins: true }
        });
        if (leaderboard == null) {
          await prisma.leaderboard.upsert({
            where: { gameType_userId: { gameType, userId: uid } },
            create: { gameType, userId: uid, wins: score },
            update: { wins: score }
          });
        } else {
          if (leaderboard.wins < score) {
            await prisma.leaderboard.upsert({
              where: { gameType_userId: { gameType, userId: uid } },
              create: { gameType, userId: uid, wins: score },
              update: { wins: score }
            });
          }
        }
      } else {
        await prisma.leaderboard.upsert({
          where: { gameType_userId: { gameType, userId: uid } },
          create: { gameType, userId: uid, wins: 1 },
          update: { wins: { increment: 1 } }
        });
        await prisma.user.update({ where: { id: uid }, data: { totalWins: { increment: 1 } } });
      }
    } catch (e) {
      console.error("leaderboard-update error:", e);
    }
  });

  socket.on("request-leaderboard", async ({ gameType, userId: uid }) => {
    try {
      const top10 = await prisma.leaderboard.findMany({
        where: { gameType },
        orderBy: { wins: "desc" },
        take: 10,
        include: { user: true }
      });
      const userEntry = await prisma.leaderboard.findUnique({
        where: { gameType_userId: { gameType, userId: uid } },
        include: { user: true }
      });
      let userRank = null;
      if (userEntry) {
        const countAbove = await prisma.leaderboard.count({
          where: { gameType, wins: { gt: userEntry.wins } }
        });
        userRank = countAbove + 1;
      }
      const isInTop10 = top10.some((entry) => entry.userId === uid);
      socket.emit("leaderboard-response", {
        gameType,
        top10: top10.map((entry, i) => ({ rank: i + 1, username: entry.user.username, wins: entry.wins, userId: entry.userId })),
        user: userEntry
          ? { username: userEntry.user.username, wins: userEntry.wins, rank: userRank, isInTop10 }
          : null
      });
    } catch (err) {
      console.error("Leaderboard error:", err);
      socket.emit("leaderboard-error", { message: "Failed to load leaderboard." });
    }
  });

  socket.on("getScores", async (roomId) => {
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { redScore: true, blueScore: true } });
      emitToRoom(roomId, "scoreUpdate", { redScore: room.redScore, blueScore: room.blueScore });
    } catch (e) { console.error("getScores error:", e); }
  });

  socket.on("incrementRedScore", async (roomId) => {
    try {
      const room = await prisma.room.update({ where: { id: roomId }, data: { redScore: { increment: 1 } }, select: { redScore: true } });
      const blue = (await prisma.room.findUnique({ where: { id: roomId }, select: { blueScore: true } })).blueScore;
      emitToRoom(roomId, "scoreUpdate", { redScore: room.redScore, blueScore: blue });
    } catch (e) { console.error("incrementRedScore error:", e); }
  });

  socket.on("incrementBlueScore", async (roomId) => {
    try {
      const room = await prisma.room.update({ where: { id: roomId }, data: { blueScore: { increment: 1 } }, select: { blueScore: true } });
      const red = (await prisma.room.findUnique({ where: { id: roomId }, select: { redScore: true } })).redScore;
      emitToRoom(roomId, "scoreUpdate", { blueScore: room.blueScore, redScore: red });
    } catch (e) { console.error("incrementBlueScore error:", e); }
  });

  socket.on("get-rooms", async ({ gameType } = {}) => {
    await emitRoomList(socket, gameType);
  });

  socket.on("make-move", async ({ data, roomId }) => {
    try {
      function determineCurrentPlayer(board) {
        let redCount = 0, blueCount = 0;
        for (let r = 0; r < board.length; r++) {
          for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] === "red") redCount++;
            if (board[r][c] === "blue") blueCount++;
          }
        }
        return redCount <= blueCount ? "red" : "blue";
      }

      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true, gameType: true } });
      if (!room || !room.board) return;
      const board = room.board;
      const game = getGame(room.gameType) || getGame("drop4");

      const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
      let role = "spectator";
      if (participant) {
        if (participant.permission === "HOST") role = "red";
        else if (participant.permission === "PLAYER") role = "blue";
      }
      const currentTurn = determineCurrentPlayer(board);
      if (role !== currentTurn) {
        socket.emit("action-error", { message: `Not your turn (expected ${currentTurn})` });
        return;
      }

      if (game?.validateAction && !game.validateAction(board, data, { userId })) {
        socket.emit("action-error", { message: "Invalid move" });
        return;
      }

      const newBoard = game?.applyAction ? game.applyAction(board, data, { userId }) : board;
      const updated = await prisma.room.update({ where: { id: roomId }, data: { board: newBoard }, select: { id: true, board: true, redScore: true, blueScore: true, gameType: true } });

      emitToRoom(roomId, "sync-board", newBoard);
      emitToRoomExcept(roomId, userId, "opponent-move", data);

      const gameResult = game?.getResult ? game.getResult(newBoard) : null;
      if (gameResult) {
        if (gameResult.winner) {
          const winner = gameResult.winner;
          const roomScore = await prisma.room.update({
            where: { id: roomId },
            data: winner === "red" ? { redScore: { increment: 1 } } : { blueScore: { increment: 1 } },
            select: { redScore: true, blueScore: true }
          });
          emitToRoom(roomId, "game-over", { winner, board: newBoard, redScore: roomScore.redScore, blueScore: roomScore.blueScore });
        } else if (gameResult.draw) {
          emitToRoom(roomId, "game-over", { winner: null, draw: true, board: newBoard, redScore: updated.redScore, blueScore: updated.blueScore });
        }
      }
      await emitRoomList();
    } catch (err) {
      console.error("make-move error:", err);
    }
  });

  // sinkEm handlers (place-ships, attack) are preserved but rely on presence for emits
  socket.on("place-ships", async ({ roomId, layout } = {}) => {
    if (!userId) return socket.emit("action-error", { message: "Not authenticated" });
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true, gameType: true } });
      if (!room) return socket.emit("action-error", { message: "Room not found" });
      const game = getGame(room.gameType);
      if (!game) return socket.emit("action-error", { message: "Game module not found" });
      const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
      if (!participant) return socket.emit("action-error", { message: "Not a participant" });
      const role = participant.permission === "HOST" ? "red" : (participant.permission === "PLAYER" ? "blue" : "spectator");
      if (role === "spectator") return socket.emit("action-error", { message: "Spectator cannot place ships" });
      const action = { type: "place", color: role, layout };
      if (!game.validateAction(room.board, action)) return socket.emit("action-error", { message: "Invalid ship layout" });
      const res = game.applyAction(room.board, action, { userId, role });
      const newBoard = res?.board || res;
      await prisma.room.update({ where: { id: roomId }, data: { board: newBoard } });
      const updatedRoom = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true } });
      emitToRoom(roomId, "sync-board", updatedRoom.board);
      socket.emit("placed-ships", { success: true });
    } catch (err) {
      console.error("place-ships handler error:", err);
      socket.emit("action-error", { message: "Error placing ships" });
    }
  });

  socket.on("attack", async ({ roomId, x, y } = {}) => {
    if (!userId) return socket.emit("action-error", { message: "Not authenticated" });
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { board: true, gameType: true } });
      if (!room) return socket.emit("action-error", { message: "Room not found" });
      const game = getGame(room.gameType);
      if (!game) return socket.emit("action-error", { message: "Game module not found" });
      const participant = await prisma.roomParticipant.findUnique({ where: { userId_roomId: { userId, roomId } } });
      if (!participant) return socket.emit("action-error", { message: "Not a participant" });
      const role = participant.permission === "HOST" ? "red" : (participant.permission === "PLAYER" ? "blue" : "spectator");
      if (role === "spectator") return socket.emit("action-error", { message: "Spectator cannot attack" });
      const action = { type: "attack", x, y, player: role };
      if (!game.validateAction(room.board, action)) return socket.emit("action-error", { message: "Invalid attack" });
      const res = game.applyAction(room.board, action, { userId, role });
      const newBoard = res?.board || res;
      const details = { ...(res?.details || { hit: false, sunk: null }), x, y, player: role };
      const updatedRoom = await prisma.room.update({ where: { id: roomId }, data: { board: newBoard }, select: { redScore: true, blueScore: true, board: true } });
      emitToRoom(roomId, "sync-board", newBoard);
      emitToRoom(roomId, "attack-result", details);
      const result = game.getResult(newBoard);
      if (result?.winner) {
        emitToRoom(roomId, "game-over", { winner: result.winner, board: newBoard, redScore: updatedRoom.redScore, blueScore: updatedRoom.blueScore });
      }
    } catch (err) {
      console.error("attack handler error:", err);
      socket.emit("action-error", { message: "Error handling attack" });
    }
  });

  socket.on("add-totalgames", async (uid) => {
    try {
      await prisma.user.update({ where: { id: uid }, data: { totalGames: { increment: 1 } } });
    } catch (e) { console.error("add-totalgames error:", e); }
  });

  socket.on("totals-request", async (uid) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: uid }, select: { totalWins: true, totalGames: true } });
      const totalLosses = user.totalGames - user.totalWins;
      socket.emit("totals-response", { totalGames: user.totalGames, totalWins: user.totalWins, totalLosses });
    } catch (e) { console.error("totals-request error:", e); }
  });

  socket.on("favorite-games-request", async (uid) => {
    try {
      const favorites = await prisma.leaderboard.findMany({ where: { userId: uid }, orderBy: { wins: "desc" }, take: 5 });
      socket.emit("favorite-games-response", favorites);
    } catch (e) { console.error("favorite-games-request error:", e); }
  });

  // reset-game
  socket.on("reset-game", async (roomId) => {
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { gameType: true } });
      const game = (room && getGame(room.gameType)) || getGame("drop4");
      const initialBoard = game?.getInitialState ? game.getInitialState() : Array.from({ length: 6 }, () => Array(7).fill(0));
      const resetRoom = await prisma.room.update({ where: { id: roomId }, data: { board: initialBoard }, select: { redScore: true, blueScore: true } });
      emitToRoom(roomId, "game-reset", { board: initialBoard, currentPlayer: "red", redScore: resetRoom.redScore, blueScore: resetRoom.blueScore });
      await emitRoomList();
    } catch (e) { console.error("reset-game error:", e); }
  });

  // leave-game: treat as immediate leave through presence.leaveRoom (client initiated leave)
  socket.on("leave-game", async (roomId) => {
    try {
      // update roomPlayers UI quickly
      let username = null;
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
        username = user?.username || null;
      } catch (e) { /* ignore */ }

      const rp = roomPlayers.get(roomId) || {};
      const roleToRemove = username ? Object.keys(rp).find(k => rp[k] === username) : null;
      if (roleToRemove) delete rp[roleToRemove];

      emitToRoom(roomId, "player-left", { username, role: roleToRemove || "spectator" });
      emitToRoom(roomId, "all-players-info", rp);

      // Call presence.leaveRoom (immediate)
      await leaveRoom({ userId, roomId });
      await emitRoomList();
    } catch (err) {
      console.error("leave-game handler error:", err);
    }
  });

  // disconnect -> presence handles timers + cleanup
  socket.on("disconnect", () => {
    console.log(`[disconnect] user ${userId}, socket ${socket.id}`);
    handleDisconnect(userId, socket.id);
    socketMeta.delete(socket.id);
  });

  // convenience helper used in some handlers: emitToRoomExcept
  function emitToRoomExcept(roomId, exceptUserId, event, payload) {
    // uses presence.emitToRoom but filters the exceptUserId
    const maps = _getMemoryMaps();
    const uids = (maps.roomUsers && maps.roomUsers.get(roomId)) || new Set();
    for (const uid of uids) {
      if (uid === exceptUserId) continue;
      const sset = (maps.userSockets && maps.userSockets.get(uid)) || new Set();
      for (const sid of sset) io.to(sid).emit(event, payload);
    }
  }
});

// ---------------------------------
// Start server
// ---------------------------------
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});