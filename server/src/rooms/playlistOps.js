import { emitToRoom } from './notify.js';
import { publicPlayback, setVideo } from './playback.js';
import { registerSnapshotSection } from './snapshot.js';
import { systemMessage } from './chatStore.js';

export function serializePlaylist(room) {
  return {
    currentItemId: room.playlist.currentItemId,
    items: room.playlist.items.map((i) => ({
      id: i.id,
      source: i.source,
      videoId: i.videoId,
      title: i.title,
      thumbnail: i.thumbnail,
      addedBy: i.addedBy,
      addedByName: i.addedByName,
      addedAt: i.addedAt,
      votes: i.votes.size,
      voters: [...i.votes],
    })),
  };
}

registerSnapshotSection('playlist', serializePlaylist);

export function broadcastPlaylist(room) {
  emitToRoom(room, 'playlist:update', serializePlaylist(room));
}

/** Makes `item` the room video and starts it playing for everyone. */
export function playItem(room, item, byUserId) {
  room.playlist.currentItemId = item.id;
  room.playlist.resumeIndex = null;
  setVideo(room, item.videoId, byUserId, Date.now(), { autoplay: true });
  emitToRoom(room, 'playback:state', publicPlayback(room, { action: 'video' }));
  broadcastPlaylist(room);
}

/** Plays the item after the current one. Returns the item, or null at the end of the queue. */
export function playNext(room, byUserId) {
  const { items, currentItemId, resumeIndex } = room.playlist;
  const idx = items.findIndex((i) => i.id === currentItemId);
  const nextIndex = idx >= 0 ? idx + 1 : (resumeIndex ?? 0);
  const next = items[nextIndex];
  if (!next) {
    systemMessage(room, 'End of the playlist');
    return null;
  }
  playItem(room, next, byUserId);
  return next;
}

/** Removing the playing item keeps its slot, so "next" continues from the same place. */
export function removeItem(room, itemId) {
  const items = room.playlist.items;
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return null;
  const [removed] = items.splice(idx, 1);
  if (room.playlist.currentItemId === itemId) {
    room.playlist.currentItemId = null;
    room.playlist.resumeIndex = idx;
  }
  return removed;
}
