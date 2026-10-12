/**
 * Holds the Socket.IO server instance so room logic that runs from timers
 * (grace periods, poll closing, countdowns) can broadcast without a socket in hand.
 */
import { serializeUsers } from './room.js';

let io = null;

export function setIo(instance) {
  io = instance;
}

export function getIo() {
  return io;
}

export function emitToRoom(room, event, payload) {
  if (io && !room.deleted) io.to(room.code).emit(event, payload);
}

export function emitToUser(room, userId, event, payload) {
  const user = room.users.get(userId);
  if (io && user?.connected && user.socketId) io.to(user.socketId).emit(event, payload);
}

export function socketById(socketId) {
  return io?.sockets.sockets.get(socketId) || null;
}

export function broadcastUsers(room) {
  emitToRoom(room, 'room:users', serializeUsers(room));
}
