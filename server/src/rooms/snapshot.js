import { config } from '../config.js';
import { serializeUsers } from './room.js';
import { publicPlayback } from './playback.js';

/**
 * Serializers for optional features register themselves here so the snapshot module
 * does not need to know about every feature (chat, playlist, polls, reactions, ...).
 */
const sections = new Map();

export function registerSnapshotSection(key, fn) {
  sections.set(key, fn);
}

/** Everything a client needs to render the room from scratch (join, rejoin, late join). */
export function buildSnapshot(room, userId) {
  const snap = {
    code: room.code,
    hostId: room.hostId,
    you: userId,
    createdAt: room.createdAt,
    users: serializeUsers(room),
    settings: { ...room.settings },
    playback: publicPlayback(room),
    chat: room.chat.slice(-config.CHAT_SNAPSHOT),
    countdown: room.countdown,
    serverTime: Date.now(),
  };
  for (const [key, fn] of sections) snap[key] = fn(room, userId);
  return snap;
}
