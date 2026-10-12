import { connectedUsers } from './room.js';

const BUCKET_SEC = 5;

/** "Watch together" recap computed from the room's running counters. */
export function computeRecap(room, now = Date.now()) {
  const s = room.stats;
  const watchMs = s.watchMs + (s.playingSince !== null ? now - s.playingSince : 0);

  const buckets = new Map();
  for (const r of room.reactions) {
    const start = Math.floor(r.videoTime / BUCKET_SEC) * BUCKET_SEC;
    const key = `${r.videoId}:${start}`;
    const b = buckets.get(key) || { videoId: r.videoId, time: start, count: 0, emojis: {} };
    b.count += 1;
    b.emojis[r.emoji] = (b.emojis[r.emoji] || 0) + 1;
    buckets.set(key, b);
  }
  let mostReacted = null;
  for (const b of buckets.values()) if (!mostReacted || b.count > mostReacted.count) mostReacted = b;
  if (mostReacted) {
    mostReacted.topEmoji = Object.entries(mostReacted.emojis).sort((a, b) => b[1] - a[1])[0][0];
  }

  let topChatter = null;
  let chatTotal = 0;
  for (const [userId, count] of s.chatCounts) {
    chatTotal += count;
    if (!topChatter || count > topChatter.count) {
      const name = room.users.get(userId)?.name ?? room.chat.findLast((m) => m.userId === userId)?.name ?? 'Someone who left';
      topChatter = { userId, name, count };
    }
  }

  return {
    code: room.code,
    durationSec: Math.round((now - room.createdAt) / 1000),
    watchTimeSec: Math.round(watchMs / 1000),
    videosPlayed: s.videosPlayed,
    reactionCount: s.reactionCount,
    mostReacted,
    chatCount: chatTotal,
    topChatter,
    polls: s.closedPolls.slice(-10),
    peopleNow: connectedUsers(room).length,
    peopleTotal: room.users.size,
  };
}
