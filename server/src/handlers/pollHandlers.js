import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM } from './helpers.js';
import { isPlainObject, validateId, validateInt, validateText, validateVideoId } from '../utils/validate.js';
import { limiters, rateLimited } from '../utils/limiters.js';
import { broadcastPoll, closePoll, createPoll, maybeCloseSkipEarly, openPolls } from '../rooms/pollOps.js';
import { runInRoom } from '../rooms/roomActor.js';

/** An option is a string, or { text, meta: { videoId?, tmdbId? } } when it came from a playlist item or movie. */
function validateOption(v) {
  const raw = isPlainObject(v) ? v.text : v;
  const text = validateText(raw, { max: 60, field: 'Option' });
  if (!text.ok) return text;
  let meta = null;
  if (isPlainObject(v) && isPlainObject(v.meta)) {
    meta = {};
    if (v.meta.videoId !== undefined) {
      const vid = validateVideoId(v.meta.videoId);
      if (!vid.ok) return vid;
      meta.videoId = vid.value;
    }
    if (v.meta.tmdbId !== undefined) {
      if (!Number.isInteger(v.meta.tmdbId) || v.meta.tmdbId <= 0) return { ok: false, error: 'Invalid tmdbId' };
      meta.tmdbId = v.meta.tmdbId;
    }
    if (!Object.keys(meta).length) meta = null;
  }
  return { ok: true, value: { text: text.value, meta } };
}

function checkOpenLimits(room, userId) {
  const open = openPolls(room);
  if (open.length >= config.POLL_MAX_OPEN_PER_ROOM) return { ok: false, error: `Max ${config.POLL_MAX_OPEN_PER_ROOM} open polls per room` };
  if (open.filter((p) => p.createdBy === userId).length >= config.POLL_MAX_OPEN_PER_USER) {
    return { ok: false, error: 'You already have an open poll' };
  }
  return null;
}

export function registerPollHandlers(socket) {
  handle(socket, 'poll:create', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    const question = validateText(payload.question, { max: 120, field: 'Question' });
    if (!question.ok) return question;
    if (!Array.isArray(payload.options) || payload.options.length < 2 || payload.options.length > 5) {
      return { ok: false, error: 'A poll needs 2 to 5 options' };
    }
    const options = [];
    for (const o of payload.options) {
      const res = validateOption(o);
      if (!res.ok) return res;
      options.push(res.value);
    }
    if (new Set(options.map((o) => o.text.toLowerCase())).size !== options.length) {
      return { ok: false, error: 'Options must be different' };
    }
    let durationSec = null;
    if (payload.durationSec !== undefined && payload.durationSec !== null) {
      const d = validateInt(payload.durationSec, { min: 15, max: 600, field: 'durationSec' });
      if (!d.ok) return d;
      durationSec = d.value;
    }
    if (!limiters.poll.check(m.user.userId)) return rateLimited('too many poll actions');
    return runInRoom(m.room, (room) => {
      const limit = checkOpenLimits(room, m.user.userId);
      if (limit) return limit;
      const poll = createPoll(room, {
        question: question.value,
        options,
        durationSec,
        createdBy: m.user.userId,
        createdByName: m.user.name,
      });
      return { ok: true, pollId: poll.id };
    });
  });

  /** "Skip this video?" quick poll: Yes/No, 30 s, majority of connected users skips. */
  handle(socket, 'poll:createSkip', () => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.room.playback.videoId) return { ok: false, error: 'Nothing is playing' };
    if (!limiters.poll.check(m.user.userId)) return rateLimited('too many poll actions');
    return runInRoom(m.room, (room) => {
      if (openPolls(room).some((p) => p.kind === 'skip')) return { ok: false, error: 'A skip vote is already running' };
      const limit = checkOpenLimits(room, m.user.userId);
      if (limit) return limit;
      const poll = createPoll(room, {
        kind: 'skip',
        question: 'Skip this video?',
        options: [{ text: 'Yes, skip' }, { text: 'No, keep watching' }],
        durationSec: config.SKIP_POLL_SECONDS,
        createdBy: m.user.userId,
        createdByName: m.user.name,
      });
      return { ok: true, pollId: poll.id };
    });
  });

  handle(socket, 'poll:vote', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    const pollId = validateId(payload.pollId, 'pollId');
    if (!pollId.ok) return pollId;
    const optionId = validateId(payload.optionId, 'optionId');
    if (!optionId.ok) return optionId;
    const poll = m.room.polls.get(pollId.value);
    if (!poll) return { ok: false, error: 'Poll not found' };
    if (poll.status !== 'open') return { ok: false, error: 'This poll is closed' };
    if (!poll.options.some((o) => o.id === optionId.value)) return { ok: false, error: 'Unknown option' };
    if (!limiters.poll.check(`vote:${m.user.userId}`)) return rateLimited('too many votes');
    return runInRoom(m.room, (room) => {
      const prev = poll.votes.get(m.user.userId);
      if (prev && !poll.allowChange) return { ok: false, error: 'You already voted' };
      if (prev?.optionId !== optionId.value) poll.votes.set(m.user.userId, { optionId: optionId.value, at: Date.now() });
      broadcastPoll(room, poll);
      maybeCloseSkipEarly(room, poll);
      return { ok: true };
    });
  });

  handle(socket, 'poll:close', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    const pollId = validateId(payload.pollId, 'pollId');
    if (!pollId.ok) return pollId;
    const poll = m.room.polls.get(pollId.value);
    if (!poll) return { ok: false, error: 'Poll not found' };
    if (!m.isHost && poll.createdBy !== m.user.userId) return { ok: false, error: 'Only the creator or the host can close this poll' };
    if (poll.status !== 'open') return { ok: false, error: 'This poll is already closed' };
    return runInRoom(m.room, (room) => {
      closePoll(room, poll, 'manual');
      return { ok: true };
    });
  });
}
