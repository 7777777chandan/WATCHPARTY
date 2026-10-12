/**
 * Join / leave / disconnect / host-transfer rules. Identity is the persistent userId;
 * socket ids are only the user's current connection.
 */
import { config } from '../config.js';
import { connectedUsers } from './room.js';
import { deleteRoom, removeUser } from './roomStore.js';
import { broadcastUsers, emitToRoom } from './notify.js';
import { systemMessage } from './chatStore.js';
import { logger } from '../utils/logger.js';

/** Picks the user who has been continuously connected the longest (excluding `exceptId`). */
export function pickNextHost(room, exceptId = null) {
  const candidates = [...room.users.values()].filter((u) => u.userId !== exceptId);
  if (!candidates.length) return null;
  const connected = candidates.filter((u) => u.connected);
  const pool = connected.length ? connected : candidates;
  pool.sort((a, b) => (a.connected ? a.connectedSince : a.joinedAt) - (b.connected ? b.connectedSince : b.joinedAt));
  return pool[0];
}

export function setHost(room, userId, { reason = 'transfer' } = {}) {
  if (room.hostId === userId) return;
  room.hostId = userId;
  room.timers.clear('hostGrace');
  const name = room.users.get(userId)?.name ?? 'Someone';
  emitToRoom(room, 'room:host', { hostId: userId, name, reason });
  systemMessage(room, `${name} is now the host`);
  broadcastUsers(room);
  logger.info(`[room ${room.code}] host -> ${name} (${reason})`);
}

/** Deletes the room when nobody is left in it. Returns true if it was deleted. */
function deleteIfEmpty(room) {
  if (room.users.size > 0) return false;
  logger.info(`[room ${room.code}] empty, deleting`);
  deleteRoom(room.code);
  return true;
}

/** Removes a user for good (explicit leave, kick or grace-period expiry). */
export function removeUserFully(room, userId, { announce = 'left' } = {}) {
  const user = room.users.get(userId);
  if (!user) return;
  removeUser(room, userId);
  if (deleteIfEmpty(room)) return;
  if (announce) systemMessage(room, `${user.name} ${announce}`);
  if (room.hostId === userId) {
    const next = pickNextHost(room);
    if (next) setHost(room, next.userId, { reason: 'host-left' });
  }
  broadcastUsers(room);
}

/**
 * Socket dropped: keep the user (greyed out) and schedule removal after the grace period.
 * If they were the host, schedule a host transfer after the (shorter) host grace period.
 */
export function markDisconnected(room, userId) {
  const user = room.users.get(userId);
  if (!user) return;
  user.connected = false;
  user.socketId = null;
  broadcastUsers(room);

  room.timers.set(
    `remove:${userId}`,
    () => removeUserFully(room, userId, { announce: 'left (connection lost)' }),
    config.USER_REMOVAL_GRACE_MS,
  );

  if (room.hostId === userId) {
    room.timers.set(
      'hostGrace',
      () => {
        const host = room.users.get(room.hostId);
        if (host?.connected) return;
        const next = connectedUsers(room).sort((a, b) => a.connectedSince - b.connectedSince)[0];
        if (next) setHost(room, next.userId, { reason: 'host-timeout' });
      },
      config.HOST_GRACE_MS,
    );
  }
}

/** A known user came back (refresh, reconnect): rebind without announcing a new join. */
export function markReconnected(room, user, socketId, now = Date.now()) {
  room.timers.clear(`remove:${user.userId}`);
  const wasConnected = user.connected;
  user.socketId = socketId;
  user.connected = true;
  if (!wasConnected) user.connectedSince = now;
  if (room.hostId === user.userId) room.timers.clear('hostGrace');
  ensureConnectedHost(room);
  broadcastUsers(room);
}

/**
 * If the host is disconnected and no grace timer is pending (it already expired with
 * nobody to hand over to), give host to the longest-connected user now.
 */
export function ensureConnectedHost(room) {
  const host = room.users.get(room.hostId);
  if (host?.connected || room.timers.has('hostGrace')) return;
  const next = connectedUsers(room).sort((a, b) => a.connectedSince - b.connectedSince)[0];
  if (next && next.userId !== room.hostId) setHost(room, next.userId, { reason: 'host-timeout' });
}
