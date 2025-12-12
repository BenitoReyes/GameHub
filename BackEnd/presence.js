// presence.js
// Single authoritative presence system (ESM)
// - initPresence must be called from server.js to provide callbacks & shared resources
// - exports: initPresence, joinRoom, leaveRoom, handleDisconnect, emitToRoom, forceLeaveRoom, safeDeleteRoom

import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const prisma = new PrismaClient().$extends(withAccelerate());

// --- internal in-memory maps (presence single source of truth) ---
const userSockets = new Map();      // userId -> Set(socketIds)
const userRooms = new Map();        // userId -> Set(roomId)  (supports multi-room if you later want it)
const roomUsers = new Map();        // roomId -> Set(userId)
const disconnectTimers = new Map(); // userId -> Map<roomId, timeoutId>
const deletingRooms = new Set();    // roomId -> boolean
const recentRoomCreation = new Map(); // roomId -> createdAt(ms)

// Config / callbacks injected by server
let _io = null;
let _serverClient = null;
let _roomPlayers = null;   // Map reference (server will pass its roomPlayers map)
let _emitRoomList = null;  // function reference
let GRACE_MS = 15000;
let RECENT_ROOM_TTL_MS = 15000;

// ---------- Init ----------
// Must be called once from your server after creating io and other helpers.
// Example:
//   import { initPresence } from './presence.js';
//   initPresence({ io, serverClient, roomPlayers, emitRoomList, graceMs, recentRoomTtl });
export function initPresence({
  io,
  serverClient,
  roomPlayers,
  emitRoomList,
  graceMs = 15000,
  recentRoomTtl = 15000
}) {
  _io = io;
  _serverClient = serverClient;
  _roomPlayers = roomPlayers;
  _emitRoomList = emitRoomList;
  GRACE_MS = graceMs;
  RECENT_ROOM_TTL_MS = recentRoomTtl;
  console.log("[presence] initialized");
}

// ---------- Utilities ----------
function ensureSet(map, k) {
  if (!map.has(k)) map.set(k, new Set());
  return map.get(k);
}

// Emit helper (server previously had an emitToRoom). Use this so presence maps are the source.
export function emitToRoom(roomId, event, payload) {
  const uids = roomUsers.get(roomId) || new Set();
  const socketTargets = [];
  for (const uid of uids) {
    const sset = userSockets.get(uid) || new Set();
    for (const sid of sset) socketTargets.push(sid);
  }
  console.log(`[presence.emitToRoom] ${event} -> room ${roomId} users=${uids.size} sockets=${socketTargets.join(",")}`);
  for (const sid of socketTargets) {
    try { _io.to(sid).emit(event, payload); } catch (e) { /* ignore */ }
  }
}

// ---------- joinRoom ----------
// Called when a socket joins a room (create-game, join-game, join-room, rejoin on reconnect)
export async function joinRoom({ userId, roomId, socket }) {
  if (!userId || !roomId || !socket) {
    console.warn("[presence.joinRoom] missing args", { userId, roomId, socketId: socket?.id });
    return;
  }

  // Track socket
  const sockets = ensureSet(userSockets, userId);
  sockets.add(socket.id);

  // Cancel any pending disconnect timer(s) for this user+room
  if (disconnectTimers.has(userId)) {
    const ut = disconnectTimers.get(userId);
    if (ut && ut.has(roomId)) {
      clearTimeout(ut.get(roomId));
      ut.delete(roomId);
      if (ut.size === 0) disconnectTimers.delete(userId);
      console.log(`[presence] canceled existing leave timer for ${userId} in ${roomId}`);
    }
  }

  // Ensure the userRooms set contains the room
  const urooms = ensureSet(userRooms, userId);
  if (!urooms.has(roomId)) urooms.add(roomId);

  // Add user to roomUsers
  const rset = ensureSet(roomUsers, roomId);
  rset.add(userId);

  // Update DB: set room.inRoom to authoritative count based on roomUsers size OR roomParticipant count
  try {
    // prefer authoritative DB participant count if available (safer), but using our rset is fine
    const count = rset.size;
    await prisma.room.updateMany({
      where: { id: roomId },
      data: { inRoom: count }
    });
  } catch (err) {
    console.error("[presence.joinRoom] failed to update inRoom", err);
  }

  console.log(`[presence] user ${userId} joined room ${roomId} (socket ${socket.id})`);
}

// ---------- leaveRoom ----------
// Remove a specific user from a specific room immediately (used by cleanup)
export async function leaveRoom({ userId, roomId }) {
  if (!userId || !roomId) return;

  // Remove from memory maps
  try {
    if (roomUsers.has(roomId)) {
      roomUsers.get(roomId).delete(userId);
      if (roomUsers.get(roomId).size === 0) roomUsers.delete(roomId);
    }

    if (userRooms.has(userId)) {
      userRooms.get(userId).delete(roomId);
      if (userRooms.get(userId).size === 0) userRooms.delete(userId);
    }
  } catch (e) {
    console.error("[presence.leaveRoom] memory cleanup error", e);
  }

  // Remove DB participant record
  try {
    await prisma.roomParticipant.deleteMany({ where: { userId, roomId } });
  } catch (e) {
    console.warn("[presence.leaveRoom] deleteMany roomParticipant failed (ignored):", e?.message || e);
  }

  // Recompute DB participant count and set inRoom accordingly (safe)
  try {
    const count = await prisma.roomParticipant.count({ where: { roomId } });
    // safe write, updateMany avoids P2025 if room deleted concurrently
    await prisma.room.updateMany({ where: { id: roomId }, data: { inRoom: count } });

    // If DB shows zero participants, schedule/delete the room
    if (count === 0) {
      // if room creation is recent, delay actual delete
      const createdAt = recentRoomCreation.get(roomId) || 0;
      if (Date.now() < createdAt + RECENT_ROOM_TTL_MS) {
        // schedule a short retry after TTL
        scheduleRetryCleanupForRoom(roomId, RECENT_ROOM_TTL_MS - (Date.now() - createdAt) + 500);
      } else {
        await safeDeleteRoom(roomId);
      }
    }
  } catch (e) {
    console.error("[presence.leaveRoom] error reconciling DB inRoom:", e);
  }

  console.log(`[presence] user ${userId} left room ${roomId}`);
}

// ---------- handleDisconnect ----------
// Called when a socket disconnects: will start a single-per-user grace timer for each room the user had active.
export function handleDisconnect(userId, socketId) {
  if (!userId || !socketId) return;

  const sockets = userSockets.get(userId);
  if (!sockets) return;

  // Remove this socket
  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(userId); // no sockets left
  }

  // If user still has other sockets, do nothing
  if (sockets && sockets.size > 0) {
    console.log(`[presence] user ${userId} still has sockets, skipping grace timers`);
    return;
  }

  // For each room the user was in, start a single timer (but ensure no duplicate timer)
  const rooms = userRooms.get(userId);
  if (!rooms || rooms.size === 0) {
    // Nothing to cleanup
    console.log(`[presence] disconnect for ${userId} but userRooms empty`);
    return;
  }

  for (const roomId of rooms) {
    // Ensure only one timer per user+room
    let ut = disconnectTimers.get(userId);
    if (!ut) {
      ut = new Map();
      disconnectTimers.set(userId, ut);
    }

    if (ut.has(roomId)) {
      // timer exists already — clear and set again (refresh)
      clearTimeout(ut.get(roomId));
      ut.delete(roomId);
    }

    console.log(`[presence] user ${userId} disconnected. Starting grace timer for room ${roomId}.`);

    const tid = setTimeout(async () => {
      try {
        // If user reconnected (sockets present), abort
        const still = userSockets.get(userId);
        if (still && still.size > 0) {
          console.log(`[presence] user ${userId} reconnected during grace for ${roomId}; aborting removal`);
          ut.delete(roomId);
          if (ut.size === 0) disconnectTimers.delete(userId);
          return;
        }

        // Double-check room exists
        const r = await prisma.room.findUnique({ where: { id: roomId } });
        if (!r) {
          console.log(`[presence] room ${roomId} no longer exists; cleaning memory for ${userId}`);
          ut.delete(roomId);
          if (ut.size === 0) disconnectTimers.delete(userId);
          userRooms.get(userId)?.delete(roomId);
          return;
        }

        // Now remove the user
        await leaveRoom({ userId, roomId });

        // Also remove role from in-memory roomPlayers if provided
        try {
          if (_roomPlayers && _roomPlayers.has && _roomPlayers.get(roomId)) {
            const playerMap = _roomPlayers.get(roomId) || {};
            // remove any seat with this user's username (look up username)
            // NOTE: we avoid fetching username here to keep this fast; server code can re-broadcast players when needed
            _roomPlayers.delete(roomId); // server can rebuild on next join; or you can adapt to remove seat-by-seat
          }
        } catch (e) {
          /* ignore */
        }

        // final memory cleanup for user+room
        ut.delete(roomId);
        if (ut.size === 0) disconnectTimers.delete(userId);
        userRooms.get(userId)?.delete(roomId);
        if (userRooms.get(userId)?.size === 0) userRooms.delete(userId);
        userSockets.delete(userId);

        // emit updated room list
        try { if (_emitRoomList) await _emitRoomList(); } catch (e) { /* ignore */ }

        console.log(`[presence] user ${userId} permanently removed after grace from room ${roomId}.`);
      } catch (err) {
        console.error("[presence] Error in disconnect cleanup:", err);
        // remove timer entry to avoid leaks
        ut.delete(roomId);
        if (ut.size === 0) disconnectTimers.delete(userId);
      }
    }, GRACE_MS);

    ut.set(roomId, tid);
    disconnectTimers.set(userId, ut);
  }
}

// ---------- safeDeleteRoom ----------
// Deletes room DB record, roomParticipants, stream channel, and clears memory maps.
// Uses updateMany/deleteMany to avoid P2025 when concurrent operations happen.
export async function safeDeleteRoom(roomId) {
  if (!roomId) return;
  if (deletingRooms.has(roomId)) return;
  deletingRooms.add(roomId);

  try {
    // Delete participants (safe)
    try { await prisma.roomParticipant.deleteMany({ where: { roomId } }); } catch (e) { /* ignore */ }

    // Delete room (safe)
    try { await prisma.room.deleteMany({ where: { id: roomId } }); console.log(`[presence] safeDeleteRoom: deleted ${roomId}`); } catch (e) {
      console.warn(`[presence] safeDeleteRoom: delete error (ignored) for ${roomId}`, e?.message || e);
    }

    // In-memory cleanup
    try {
      const rusers = roomUsers.get(roomId) || new Set();
      for (const uid of rusers) {
        const urs = userRooms.get(uid);
        if (urs) {
          urs.delete(roomId);
          if (urs.size === 0) userRooms.delete(uid);
        }
      }
      roomUsers.delete(roomId);
      if (_roomPlayers) _roomPlayers.delete(roomId);
    } catch (e) { /* ignore */ }

    // Attempt to delete Stream channel if server client was provided
    if (_serverClient) {
      try {
        const channel = _serverClient.channel('messaging', roomId);
        await channel.delete();
        console.log(`[presence] safeDeleteRoom: deleted stream channel for ${roomId}`);
      } catch (e) {
        console.warn(`[presence] safeDeleteRoom: stream channel delete failed for ${roomId}:`, e?.message || e);
      }
    }

  } finally {
    deletingRooms.delete(roomId);
  }
}

// ---------- schedule retry cleanup ----------
function scheduleRetryCleanupForRoom(roomId, delayMs = RECENT_ROOM_TTL_MS + 500) {
  setTimeout(async () => {
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { participants: true } });
      if (!room) return;
      const participants = room.participants || [];
      if (participants.length === 0) {
        await safeDeleteRoom(roomId);
      }
    } catch (e) {
      console.error("[presence] scheduleRetryCleanupForRoom error:", e);
    }
  }, delayMs);
}

// ---------- forceLeaveRoom (exposed for server code that needs immediate force) ----------
export async function forceLeaveRoom(userId, roomId) {
  // This will immediately call leaveRoom and update maps
  try {
    await leaveRoom({ userId, roomId });
  } catch (e) {
    console.error("[presence.forceLeaveRoom] error:", e);
  }
}

// ---------- helpers to mark recent creation (server should call when it creates a room) ----------
export function markRoomCreated(roomId) {
  if (!roomId) return;
  recentRoomCreation.set(roomId, Date.now());
  // expire after TTL
  setTimeout(() => recentRoomCreation.delete(roomId), RECENT_ROOM_TTL_MS + 1000);
}

// ---------- getters (optional, exported for server debug) ----------
export function _getMemoryMaps() {
  return { userSockets, userRooms, roomUsers, disconnectTimers, recentRoomCreation };
}