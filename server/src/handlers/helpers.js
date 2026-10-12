import { isPlainObject } from '../utils/validate.js';
import { getRoom } from '../rooms/roomStore.js';
import { logger } from '../utils/logger.js';

/**
 * Registers a socket event handler with uniform behaviour:
 * - payload must be a plain object (or omitted); anything else is rejected
 * - the ack callback is optional; if missing, failures are sent as "action:error"
 * - exceptions never escape (the server must not crash on bad input)
 * The handler returns the ack value ({ ok, ... }) or undefined for "no reply".
 */
export function handle(socket, event, fn) {
  socket.on(event, async (...args) => {
    let ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const payload = args[0] === undefined || args[0] === null ? {} : args[0];
    const reply = (res) => {
      if (!res) return;
      if (ack) {
        ack(res);
        ack = null;
      } else if (res.ok === false) {
        socket.emit('action:error', { event, error: res.error });
      }
    };
    if (!isPlainObject(payload)) return reply({ ok: false, error: 'Invalid payload' });
    try {
      reply(await fn(payload));
    } catch (err) {
      logger.error(`[handler ${event}]`, err);
      reply({ ok: false, error: 'Internal server error' });
    }
  });
}

/** Resolves the room and member for this socket, or null if the socket is not in a room. */
export function membership(socket) {
  const room = getRoom(socket.data.roomCode);
  if (!room) return null;
  const user = room.users.get(socket.data.userId);
  if (!user || user.socketId !== socket.id) return null;
  return { room, user, isHost: room.hostId === user.userId };
}

export const NOT_IN_ROOM = { ok: false, error: 'You are not in a room' };
export const HOST_ONLY = { ok: false, error: 'Only the host can do that' };
