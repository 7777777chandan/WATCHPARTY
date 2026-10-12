import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM, HOST_ONLY } from './helpers.js';
import { validatePosition, validateVideoId } from '../utils/validate.js';
import { applyPlaybackAction, publicPlayback, setVideo } from '../rooms/playback.js';
import { emitToRoom } from '../rooms/notify.js';
import { runInRoom } from '../rooms/roomActor.js';
import { cancelCountdown } from '../rooms/countdown.js';
import { broadcastPlaylist } from '../rooms/playlistOps.js';

const ACTION_TYPES = new Set(['play', 'pause', 'seek']);

export function canControl(room, userId) {
  return room.settings.controlMode === 'everyone' || room.hostId === userId;
}

/** A double-click on play (same type, ~same position) within 150 ms is dropped. */
function isDuplicate(room, userId, type, position, now) {
  const last = room.lastActions.get(userId);
  room.lastActions.set(userId, { type, position, at: now });
  return (
    last &&
    last.type === type &&
    now - last.at < config.DUPLICATE_ACTION_WINDOW_MS &&
    Math.abs(last.position - position) < 0.5
  );
}

export function registerPlaybackHandlers(socket) {
  handle(socket, 'video:set', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    const videoId = validateVideoId(payload.videoId);
    if (!videoId.ok) return videoId;
    return runInRoom(m.room, (room) => {
      cancelCountdown(room);
      room.playlist.currentItemId =
        room.playlist.items.find((i) => i.videoId === videoId.value)?.id ?? null;
      setVideo(room, videoId.value, m.user.userId);
      emitToRoom(room, 'playback:state', publicPlayback(room));
      broadcastPlaylist(room);
      return { ok: true, seq: room.playback.seq };
    });
  });

  handle(socket, 'playback:action', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    const { type, clientSeq, sentAt } = payload;
    if (!ACTION_TYPES.has(type)) return { ok: false, error: 'type must be play, pause or seek' };
    const position = validatePosition(payload.position);
    if (!position.ok) return position;
    if (!m.room.playback.videoId) return { ok: false, error: 'No video selected' };
    if (!canControl(m.room, m.user.userId)) {
      return { ok: false, error: 'Only the host can control playback right now', code: 'HOST_ONLY_MODE' };
    }

    return runInRoom(m.room, (room) => {
      const now = Date.now();
      if (isDuplicate(room, m.user.userId, type, position.value, now)) {
        return { ok: true, deduped: true, seq: room.playback.seq };
      }
      cancelCountdown(room);
      applyPlaybackAction(room, { type, position: position.value }, m.user.userId, now);
      const stale =
        Number.isInteger(clientSeq) && room.playback.seq - 1 - clientSeq > config.STALE_SEQ_THRESHOLD;
      const extra = { action: type };
      if (stale) extra.stale = true;
      // sentAt is echoed back untouched; the load tester uses it to measure propagation latency.
      if (typeof sentAt === 'number' && Number.isFinite(sentAt)) extra.sentAt = sentAt;
      emitToRoom(room, 'playback:state', publicPlayback(room, extra));
      return { ok: true, seq: room.playback.seq };
    });
  });

  /** Lets a client re-fetch authoritative state (e.g. after its local action was rejected). */
  handle(socket, 'playback:get', () => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    return { ok: true, state: publicPlayback(m.room) };
  });
}
