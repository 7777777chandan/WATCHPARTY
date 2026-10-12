import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM } from './helpers.js';
import { limiters, rateLimited } from '../utils/limiters.js';
import { getExpectedPosition } from '../rooms/playback.js';
import { emitToRoom } from '../rooms/notify.js';
import { runInRoom } from '../rooms/roomActor.js';
import { newId } from '../utils/ids.js';
import { registerSnapshotSection } from '../rooms/snapshot.js';

const EMOJIS = new Set(config.REACTION_EMOJIS);

// Timestamped reactions are part of the snapshot so late joiners see the "crowd" timeline.
registerSnapshotSection('reactions', (room) =>
  room.reactions.map(({ id, emoji, videoId, videoTime }) => ({ id, emoji, videoId, videoTime })),
);

export function registerReactionHandlers(socket) {
  handle(socket, 'reaction:send', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (typeof payload.emoji !== 'string' || !EMOJIS.has(payload.emoji)) {
      return { ok: false, error: 'Unsupported emoji' };
    }
    if (!limiters.reaction.check(m.user.userId)) return rateLimited('max 5 reactions per second');
    return runInRoom(m.room, (room) => {
      const videoTime = Math.round(getExpectedPosition(room.playback) * 10) / 10;
      const reaction = {
        id: newId(8),
        userId: m.user.userId,
        name: m.user.name,
        emoji: payload.emoji,
        videoId: room.playback.videoId,
        videoTime,
        ts: Date.now(),
      };
      room.stats.reactionCount += 1;
      if (reaction.videoId) {
        room.reactions.push(reaction);
        if (room.reactions.length > config.REACTIONS_STORED) room.reactions.shift();
      }
      emitToRoom(room, 'reaction:show', reaction);
      return { ok: true };
    });
  });
}
