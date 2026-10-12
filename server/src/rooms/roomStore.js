import { createRoomObject } from './room.js';
import { generateRoomCode } from '../utils/ids.js';

const rooms = new Map();
const deleteListeners = new Set();

export function createRoom(hostId) {
  let code;
  do code = generateRoomCode();
  while (rooms.has(code));
  const room = createRoomObject(code, hostId);
  rooms.set(code, room);
  return room;
}

export const getRoom = (code) => rooms.get(code) || null;
export const allRooms = () => rooms.values();
export const roomCount = () => rooms.size;

/** Deletes a room and clears every timer it owns so nothing fires afterwards. */
export function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return false;
  room.deleted = true;
  room.timers.clearAll();
  rooms.delete(code);
  for (const fn of deleteListeners) fn(room);
  return true;
}

export function onRoomDeleted(fn) {
  deleteListeners.add(fn);
  return () => deleteListeners.delete(fn);
}

export function addUser(room, { userId, name, socketId }, now = Date.now()) {
  const user = { userId, name, socketId, connected: true, joinedAt: now, connectedSince: now };
  room.users.set(userId, user);
  return user;
}

export function removeUser(room, userId) {
  room.timers.clear(`remove:${userId}`);
  room.drift.delete(userId);
  room.lastActions.delete(userId);
  return room.users.delete(userId);
}

export function listUsers(room) {
  return [...room.users.values()];
}

/** Test helper. */
export function _resetStore() {
  for (const code of [...rooms.keys()]) deleteRoom(code);
}
