import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM } from './helpers.js';
import { validateCode, validateName, validateUserId } from '../utils/validate.js';
import { addUser, createRoom, getRoom } from '../rooms/roomStore.js';
import { buildSnapshot } from '../rooms/snapshot.js';
import { publicPlayback } from '../rooms/playback.js';
import { broadcastUsers, socketById } from '../rooms/notify.js';
import { markDisconnected, markReconnected, removeUserFully } from '../rooms/membership.js';
import { systemMessage } from '../rooms/chatStore.js';
import { logger } from '../utils/logger.js';

function validateIdentity(payload) {
  const name = validateName(payload.name);
  if (!name.ok) return name;
  const userId = validateUserId(payload.userId);
  if (!userId.ok) return userId;
  return { ok: true, value: { name: name.value, userId: userId.value } };
}

/** Leaves whatever room this socket is currently bound to (without deleting the user). */
function detachSocketFromRoom(socket) {
  const current = membership(socket);
  if (current) {
    socket.leave(current.room.code);
    removeUserFully(current.room, current.user.userId);
  }
  socket.data.roomCode = null;
}

function bindSocket(socket, room, userId) {
  socket.data.userId = userId;
  socket.data.roomCode = room.code;
  socket.join(room.code);
}

/**
 * Same user opened the room in another tab (or reconnected while the old socket still lingers):
 * tell the old socket it was replaced and disconnect it. It does not auto-reconnect after
 * a server-side disconnect, so the tabs don't fight over the session.
 */
function replaceOldSocket(room, user, newSocketId) {
  if (!user.socketId || user.socketId === newSocketId) return;
  const old = socketById(user.socketId);
  if (!old) return;
  old.data.roomCode = null;
  old.leave(room.code);
  old.emit('session:replaced', { code: room.code });
  setTimeout(() => old.disconnect(true), 50);
}

export function registerRoomHandlers(socket) {
  handle(socket, 'room:create', (payload) => {
    const id = validateIdentity(payload);
    if (!id.ok) return id;
    detachSocketFromRoom(socket);
    const room = createRoom(id.value.userId);
    addUser(room, { ...id.value, socketId: socket.id });
    bindSocket(socket, room, id.value.userId);
    logger.info(`[room ${room.code}] created by ${id.value.name}`);
    return { ok: true, code: room.code, room: buildSnapshot(room, id.value.userId) };
  });

  handle(socket, 'room:join', (payload) => {
    const code = validateCode(payload.code);
    if (!code.ok) return code;
    const id = validateIdentity(payload);
    if (!id.ok) return id;
    const { userId, name } = id.value;
    const room = getRoom(code.value);
    if (!room) return { ok: false, error: 'Room not found', code: 'ROOM_NOT_FOUND' };

    const bannedUntil = room.bans.get(userId);
    if (bannedUntil && bannedUntil > Date.now()) {
      return { ok: false, error: 'You were removed from this room. Try again later.', code: 'BANNED' };
    }

    // Leaving a different room first (joining a new one from the same tab).
    if (socket.data.roomCode && socket.data.roomCode !== room.code) detachSocketFromRoom(socket);

    const existing = room.users.get(userId);
    if (existing) {
      // Reconnect / refresh / duplicate tab: same identity, keep host status, no join message.
      replaceOldSocket(room, existing, socket.id);
      existing.name = name;
      bindSocket(socket, room, userId);
      markReconnected(room, existing, socket.id);
    } else {
      if (room.settings.locked) return { ok: false, error: 'This room is locked', code: 'LOCKED' };
      if (room.users.size >= config.MAX_USERS_PER_ROOM) {
        return { ok: false, error: `Room is full (max ${config.MAX_USERS_PER_ROOM})`, code: 'FULL' };
      }
      addUser(room, { userId, name, socketId: socket.id });
      bindSocket(socket, room, userId);
      systemMessage(room, `${name} joined`);
      broadcastUsers(room);
    }
    // Late joiners also get the playback state as a normal event so the same apply path runs.
    socket.emit('playback:state', publicPlayback(room, { snapshot: true }));
    return { ok: true, code: room.code, room: buildSnapshot(room, userId), rejoined: Boolean(existing) };
  });

  handle(socket, 'room:leave', () => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    socket.leave(m.room.code);
    socket.data.roomCode = null;
    removeUserFully(m.room, m.user.userId);
    return { ok: true };
  });

  socket.on('disconnect', (reason) => {
    const m = membership(socket);
    if (!m) return;
    logger.info(`[room ${m.room.code}] ${m.user.name} disconnected (${reason})`);
    markDisconnected(m.room, m.user.userId);
  });
}

/**
 * Socket.IO connection-state recovery restored this socket (same id, same rooms, same data).
 * Rebind the user immediately; the client still sends an explicit room:join too.
 */
export function handleRecoveredSocket(socket) {
  const room = getRoom(socket.data.roomCode);
  const user = room?.users.get(socket.data.userId);
  if (!room || !user) {
    socket.data.roomCode = null;
    return;
  }
  replaceOldSocket(room, user, socket.id);
  markReconnected(room, user, socket.id);
}
