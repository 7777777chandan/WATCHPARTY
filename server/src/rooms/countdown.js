import { publicPlayback, applyPlaybackAction } from './playback.js';
import { emitToRoom } from './notify.js';

/**
 * Synchronized "Starting in N..." countdown. The room is paused at `position`, everyone
 * renders the countdown against the shared `startAt` (server clock), and at startAt the
 * server flips playback to playing with updatedAt = startAt, so even a client that receives
 * the broadcast late extrapolates to the same position.
 */
export function startCountdown(room, { seconds, position, by, leadMs }) {
  const now = Date.now();
  const startAt = now + seconds * 1000 + leadMs;
  applyPlaybackAction(room, { type: 'pause', position }, by, now);
  room.countdown = { startAt, seconds, position, by, seq: room.playback.seq };
  emitToRoom(room, 'playback:state', publicPlayback(room, { action: 'pause' }));
  emitToRoom(room, 'countdown:show', room.countdown);
  room.timers.set(
    'countdown',
    () => {
      if (!room.countdown) return;
      room.countdown = null;
      applyPlaybackAction(room, { type: 'play', position }, by, startAt);
      emitToRoom(room, 'playback:state', publicPlayback(room, { action: 'play', countdown: true }));
    },
    Math.max(0, startAt - Date.now()),
  );
  return room.countdown;
}

/** Any manual playback action cancels a running countdown. */
export function cancelCountdown(room) {
  if (!room.countdown) return;
  room.countdown = null;
  room.timers.clear('countdown');
  emitToRoom(room, 'countdown:cancel', {});
}
