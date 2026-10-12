import { handle, membership, NOT_IN_ROOM, HOST_ONLY } from './helpers.js';
import { computeRecap } from '../rooms/stats.js';
import { emitToRoom, socketById } from '../rooms/notify.js';
import { deleteRoom } from '../rooms/roomStore.js';
import { logger } from '../utils/logger.js';

export function registerStatsHandlers(socket) {
  handle(socket, 'stats:get', () => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    return { ok: true, recap: computeRecap(m.room) };
  });

  /** Host ends the party: everyone gets the recap, then the room is deleted. */
  handle(socket, 'room:end', () => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    const room = m.room;
    const recap = computeRecap(room);
    emitToRoom(room, 'room:ended', { recap, by: m.user.name });
    for (const user of room.users.values()) {
      const s = user.socketId && socketById(user.socketId);
      if (s) {
        s.leave(room.code);
        s.data.roomCode = null;
      }
    }
    deleteRoom(room.code);
    logger.info(`[room ${room.code}] ended by host`);
    return { ok: true, recap };
  });
}
