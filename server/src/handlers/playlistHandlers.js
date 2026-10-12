import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM, HOST_ONLY } from './helpers.js';
import { validateId, validateInt, validateText } from '../utils/validate.js';
import { limiters, rateLimited } from '../utils/limiters.js';
import { fetchOEmbed, parseYouTubeId, thumbnailFor } from '../services/youtube.js';
import { broadcastPlaylist, playItem, playNext, removeItem } from '../rooms/playlistOps.js';
import { getRoom } from '../rooms/roomStore.js';
import { runInRoom } from '../rooms/roomActor.js';
import { newId } from '../utils/ids.js';

function findItem(room, payload) {
  const id = validateId(payload.itemId, 'itemId');
  if (!id.ok) return id;
  const item = room.playlist.items.find((i) => i.id === id.value);
  return item ? { ok: true, value: item } : { ok: false, error: 'Playlist item not found' };
}

export function registerPlaylistHandlers(socket) {
  handle(socket, 'playlist:add', async (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    const videoId = parseYouTubeId(payload.videoId ?? payload.url);
    if (!videoId) return { ok: false, error: 'Not a valid YouTube link or video id' };
    let title = null;
    if (payload.title !== undefined) {
      const t = validateText(payload.title, { max: 120, field: 'title' });
      if (!t.ok) return t;
      title = t.value;
    }
    const source = payload.source === 'tmdb' ? 'tmdb' : 'youtube';
    if (!limiters.playlist.check(m.user.userId)) return rateLimited('too many playlist changes');

    const precheck = (room) => {
      if (room.playlist.items.length >= config.PLAYLIST_MAX) return { ok: false, error: `Playlist is full (max ${config.PLAYLIST_MAX})` };
      if (room.playlist.items.some((i) => i.videoId === videoId)) return { ok: false, error: 'That video is already in the playlist' };
      return null;
    };
    const early = precheck(m.room);
    if (early) return early;

    // Slow network call happens outside the room's serial section.
    if (!title) title = (await fetchOEmbed(videoId))?.title ?? `YouTube video ${videoId}`;

    const room = getRoom(m.room.code);
    if (!room) return { ok: false, error: 'Room no longer exists' };
    return runInRoom(room, () => {
      const late = precheck(room); // state may have changed while we awaited oEmbed
      if (late) return late;
      const item = {
        id: newId(8),
        source,
        videoId,
        title,
        thumbnail: thumbnailFor(videoId),
        addedBy: m.user.userId,
        addedByName: m.user.name,
        addedAt: Date.now(),
        votes: new Set(),
      };
      room.playlist.items.push(item);
      broadcastPlaylist(room);
      return { ok: true, item: { id: item.id, title } };
    });
  });

  handle(socket, 'playlist:vote', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    const found = findItem(m.room, payload);
    if (!found.ok) return found;
    if (!limiters.playlist.check(`vote:${m.user.userId}`)) return rateLimited('too many votes');
    return runInRoom(m.room, (room) => {
      const votes = found.value.votes;
      if (votes.has(m.user.userId)) votes.delete(m.user.userId);
      else votes.add(m.user.userId);
      broadcastPlaylist(room);
      return { ok: true, voted: votes.has(m.user.userId) };
    });
  });

  handle(socket, 'playlist:remove', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    const found = findItem(m.room, payload);
    if (!found.ok) return found;
    if (!m.isHost && found.value.addedBy !== m.user.userId) {
      return { ok: false, error: 'Only the host or the person who added it can remove it' };
    }
    return runInRoom(m.room, (room) => {
      removeItem(room, found.value.id);
      broadcastPlaylist(room);
      return { ok: true };
    });
  });

  handle(socket, 'playlist:reorder', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    const found = findItem(m.room, payload);
    if (!found.ok) return found;
    const items = m.room.playlist.items;
    const newIndex = validateInt(payload.newIndex, { min: 0, max: Math.max(0, items.length - 1), field: 'newIndex' });
    if (!newIndex.ok) return newIndex;
    return runInRoom(m.room, (room) => {
      const list = room.playlist.items;
      list.splice(list.indexOf(found.value), 1);
      list.splice(newIndex.value, 0, found.value);
      broadcastPlaylist(room);
      return { ok: true };
    });
  });

  handle(socket, 'playlist:sortByVotes', () => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    return runInRoom(m.room, (room) => {
      // Array.prototype.sort is stable, so equal votes keep their current order.
      room.playlist.items.sort((a, b) => b.votes.size - a.votes.size);
      broadcastPlaylist(room);
      return { ok: true };
    });
  });

  handle(socket, 'playlist:playNow', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    const found = findItem(m.room, payload);
    if (!found.ok) return found;
    return runInRoom(m.room, (room) => {
      playItem(room, found.value, m.user.userId);
      return { ok: true };
    });
  });

  /**
   * Host-only. Sent automatically by the host's client when a video ends, with the seq it
   * saw; if the room already moved on (seq changed), the duplicate is ignored.
   */
  handle(socket, 'playlist:next', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    if (payload.seq !== undefined) {
      if (!Number.isInteger(payload.seq)) return { ok: false, error: 'seq must be an integer' };
      if (payload.seq !== m.room.playback.seq) return { ok: true, ignored: true };
    }
    return runInRoom(m.room, (room) => {
      const next = playNext(room, m.user.userId);
      return next ? { ok: true, itemId: next.id } : { ok: false, error: 'No next item in the playlist' };
    });
  });
}
