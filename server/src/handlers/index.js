import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { registerTimeHandlers } from './timeHandlers.js';
import { registerRoomHandlers, handleRecoveredSocket } from './roomHandlers.js';
import { registerPlaybackHandlers } from './playbackHandlers.js';
import { registerHostHandlers } from './hostHandlers.js';
import { registerChatHandlers } from './chatHandlers.js';
import { registerReactionHandlers } from './reactionHandlers.js';
import { registerPlaylistHandlers } from './playlistHandlers.js';
import { registerPollHandlers } from './pollHandlers.js';
import { registerDriftHandlers } from './driftHandlers.js';
import { registerCountdownHandlers } from './countdownHandlers.js';
import { registerStatsHandlers } from './statsHandlers.js';

/**
 * Per-socket budget across all events (default 50/s). Events over budget are dropped;
 * a socket that goes over budget in 3 separate seconds within 10 s is disconnected.
 */
function attachSocketRateLimit(socket) {
  let windowStart = Date.now();
  let count = 0;
  let strikes = 0;
  let lastStrikeAt = 0;
  let notified = false;
  socket.use((packet, next) => {
    if (typeof packet[0] !== 'string') return; // drop malformed packets
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
      notified = false;
    }
    count += 1;
    if (count <= config.SOCKET_EVENTS_PER_SEC) return next();
    if (!notified) {
      notified = true;
      if (now - lastStrikeAt > 10_000) strikes = 0;
      strikes += 1;
      lastStrikeAt = now;
      logger.warn(`[abuse] ${socket.id} over ${config.SOCKET_EVENTS_PER_SEC} events/s (strike ${strikes})`);
      socket.emit('rate:limited', { limit: config.SOCKET_EVENTS_PER_SEC, strikes });
      if (strikes >= config.SOCKET_ABUSE_STRIKES) {
        socket.emit('abuse:disconnect', { reason: 'Too many events' });
        socket.disconnect(true);
      }
    }
    // Over budget: drop the event (do not call next).
  });
}

export function registerHandlers(socket) {
  attachSocketRateLimit(socket);
  registerTimeHandlers(socket);
  registerRoomHandlers(socket);
  registerPlaybackHandlers(socket);
  registerHostHandlers(socket);
  registerChatHandlers(socket);
  registerReactionHandlers(socket);
  registerPlaylistHandlers(socket);
  registerPollHandlers(socket);
  registerDriftHandlers(socket);
  registerCountdownHandlers(socket);
  registerStatsHandlers(socket);
  if (socket.recovered) handleRecoveredSocket(socket);
}
