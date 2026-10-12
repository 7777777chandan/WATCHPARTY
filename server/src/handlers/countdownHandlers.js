import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM, HOST_ONLY } from './helpers.js';
import { validateInt } from '../utils/validate.js';
import { cancelCountdown, startCountdown } from '../rooms/countdown.js';
import { getExpectedPosition } from '../rooms/playback.js';
import { runInRoom } from '../rooms/roomActor.js';

export function registerCountdownHandlers(socket) {
  handle(socket, 'countdown:start', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    if (!m.room.playback.videoId) return { ok: false, error: 'Pick a video first' };
    const seconds = validateInt(payload.seconds ?? 10, { min: config.COUNTDOWN_MIN, max: config.COUNTDOWN_MAX, field: 'seconds' });
    if (!seconds.ok) return seconds;
    return runInRoom(m.room, (room) => {
      const position = Math.round(getExpectedPosition(room.playback) * 1000) / 1000;
      const cd = startCountdown(room, { seconds: seconds.value, position, by: m.user.userId, leadMs: config.COUNTDOWN_LEAD_MS });
      return { ok: true, startAt: cd.startAt };
    });
  });

  handle(socket, 'countdown:cancel', () => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    return runInRoom(m.room, (room) => {
      cancelCountdown(room);
      return { ok: true };
    });
  });
}
