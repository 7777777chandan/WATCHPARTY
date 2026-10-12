import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM } from './helpers.js';
import { limiters, rateLimited } from '../utils/limiters.js';
import { allRooms } from '../rooms/roomStore.js';
import { emitToRoom } from '../rooms/notify.js';

const finite = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;

/** Client reports its smoothed drift (ms), correction count and RTT (ms) every few seconds. */
export function registerDriftHandlers(socket) {
  handle(socket, 'drift:report', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!finite(payload.drift, 1e7)) return { ok: false, error: 'drift must be a number (ms)' };
    const corrections = Number.isInteger(payload.corrections) && payload.corrections >= 0 ? payload.corrections : 0;
    const rtt = finite(payload.rtt, 60_000) && payload.rtt >= 0 ? payload.rtt : null;
    const state = ['synced', 'soft', 'hard', 'paused', 'buffering', 'idle'].includes(payload.state) ? payload.state : null;
    if (!limiters.drift.check(m.user.userId)) return rateLimited('drift reports too frequent');
    m.room.drift.set(m.user.userId, {
      drift: Math.round(payload.drift),
      corrections,
      rtt: rtt === null ? null : Math.round(rtt),
      state,
      at: Date.now(),
    });
    return { ok: true };
  });
}

/** One global timer (not one per room) broadcasts everyone's latest drift every 5 s. */
export function startDriftBroadcaster() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of allRooms()) {
      if (!room.drift.size) continue;
      const rows = [];
      for (const [userId, r] of room.drift) {
        const user = room.users.get(userId);
        if (!user?.connected || now - r.at > config.DRIFT_REPORT_TTL_MS) continue;
        rows.push({ userId, name: user.name, ...r });
      }
      emitToRoom(room, 'drift:update', rows);
    }
  }, config.DRIFT_BROADCAST_MS);
  timer.unref();
  return () => clearInterval(timer);
}
