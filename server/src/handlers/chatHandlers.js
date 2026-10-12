import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM } from './helpers.js';
import { isPlainObject, validateText } from '../utils/validate.js';
import { limiters, rateLimited } from '../utils/limiters.js';
import { pushChatMessage } from '../rooms/chatStore.js';
import { runInRoom } from '../rooms/roomActor.js';

const POSTER_PREFIX = 'https://image.tmdb.org/t/p/';

/** Validates the movie card attached to a "suggestion" chat message. */
function validateMovieCard(v) {
  if (!isPlainObject(v)) return { ok: false, error: 'movie must be an object' };
  if (!Number.isInteger(v.id) || v.id <= 0) return { ok: false, error: 'Invalid movie id' };
  const title = validateText(v.title, { max: 120, field: 'title' });
  if (!title.ok) return title;
  const posterUrl = typeof v.posterUrl === 'string' && v.posterUrl.startsWith(POSTER_PREFIX) && v.posterUrl.length < 200
    ? v.posterUrl : null;
  const year = Number.isInteger(v.year) && v.year > 1800 && v.year < 2200 ? v.year : null;
  const rating = typeof v.rating === 'number' && v.rating >= 0 && v.rating <= 10 ? Math.round(v.rating * 10) / 10 : null;
  return { ok: true, value: { id: v.id, title: title.value, posterUrl, year, rating } };
}

export function registerChatHandlers(socket) {
  handle(socket, 'chat:send', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.room.settings.chatEnabled && !m.isHost) return { ok: false, error: 'Chat is disabled by the host', code: 'CHAT_DISABLED' };
    const text = validateText(payload.text, { max: config.CHAT_MAX_LEN, field: 'Message', multiline: true });
    if (!text.ok) return text;
    if (!limiters.chat.check(m.user.userId)) return rateLimited('max 5 messages every 5 seconds');
    return runInRoom(m.room, (room) => {
      const counts = room.stats.chatCounts;
      counts.set(m.user.userId, (counts.get(m.user.userId) || 0) + 1);
      const msg = pushChatMessage(room, { type: 'user', userId: m.user.userId, name: m.user.name, text: text.value });
      return { ok: true, id: msg.id };
    });
  });

  handle(socket, 'chat:suggest', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.room.settings.chatEnabled && !m.isHost) return { ok: false, error: 'Chat is disabled by the host', code: 'CHAT_DISABLED' };
    const movie = validateMovieCard(payload.movie);
    if (!movie.ok) return movie;
    if (!limiters.chat.check(m.user.userId)) return rateLimited('max 5 messages every 5 seconds');
    return runInRoom(m.room, (room) => {
      const msg = pushChatMessage(room, {
        type: 'suggestion',
        userId: m.user.userId,
        name: m.user.name,
        text: `${m.user.name} suggested ${movie.value.title}`,
        movie: movie.value,
      });
      return { ok: true, id: msg.id };
    });
  });
}
