import { TimerBag } from '../utils/timerBag.js';

/** Creates a fresh in-memory room. All mutable room state lives on this object. */
export function createRoomObject(code, hostId, now = Date.now()) {
  return {
    code,
    hostId,
    createdAt: now,
    users: new Map(), // userId -> { userId, name, socketId, connected, joinedAt, connectedSince }
    settings: { controlMode: 'everyone', chatEnabled: true, locked: false },
    playback: {
      videoId: null,
      playing: false,
      position: 0,
      updatedAt: now,
      seq: 0,
      lastActionBy: null,
    },
    lastActions: new Map(), // userId -> { type, position, at } for duplicate debounce
    chat: [],
    playlist: { items: [], currentItemId: null },
    polls: new Map(),
    reactions: [], // { id, emoji, userId, videoId, videoTime, ts }
    bans: new Map(), // userId -> bannedUntil
    drift: new Map(), // userId -> { drift, corrections, rtt, at }
    countdown: null, // { startAt, seconds, position, by }
    stats: {
      watchMs: 0,
      playingSince: null,
      reactionCount: 0,
      chatCounts: new Map(), // userId -> count
      videosPlayed: 0,
      closedPolls: [],
    },
    timers: new TimerBag(),
    deleted: false,
  };
}

export function serializeUsers(room) {
  return [...room.users.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      isHost: u.userId === room.hostId,
      connected: u.connected,
    }));
}

export function connectedUsers(room) {
  return [...room.users.values()].filter((u) => u.connected);
}
