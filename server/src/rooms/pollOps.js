import { config } from '../config.js';
import { newId } from '../utils/ids.js';
import { emitToUser } from './notify.js';
import { connectedUsers } from './room.js';
import { registerSnapshotSection } from './snapshot.js';
import { systemMessage } from './chatStore.js';
import { playNext } from './playlistOps.js';

export function tallies(poll) {
  const counts = new Map(poll.options.map((o) => [o.id, { votes: 0, firstAt: Infinity }]));
  for (const { optionId, at } of poll.votes.values()) {
    const c = counts.get(optionId);
    if (!c) continue;
    c.votes += 1;
    c.firstAt = Math.min(c.firstAt, at);
  }
  return counts;
}

/** Most votes wins; ties go to the option whose (current) earliest vote came first. */
export function computeWinner(poll) {
  let best = null;
  for (const [optionId, c] of tallies(poll)) {
    if (c.votes === 0) continue;
    if (!best || c.votes > best.votes || (c.votes === best.votes && c.firstAt < best.firstAt)) {
      best = { optionId, ...c };
    }
  }
  return best?.optionId ?? null;
}

/** Public view: tallies only, never who voted for what. `myVote` is added per recipient. */
export function serializePoll(room, poll, userId = null) {
  const counts = tallies(poll);
  return {
    id: poll.id,
    kind: poll.kind,
    question: poll.question,
    options: poll.options.map((o) => ({ id: o.id, text: o.text, meta: o.meta ?? null, votes: counts.get(o.id).votes })),
    totalVotes: poll.votes.size,
    createdBy: poll.createdBy,
    createdByName: poll.createdByName,
    createdAt: poll.createdAt,
    closesAt: poll.closesAt,
    status: poll.status,
    allowChange: poll.allowChange,
    winnerId: poll.winnerId,
    closedReason: poll.closedReason ?? null,
    myVote: userId ? (poll.votes.get(userId)?.optionId ?? null) : null,
  };
}

registerSnapshotSection('polls', (room, userId) =>
  [...room.polls.values()].sort((a, b) => a.createdAt - b.createdAt).map((p) => serializePoll(room, p, userId)),
);

/** Sends each member the poll with their own vote filled in. */
export function broadcastPoll(room, poll) {
  for (const user of room.users.values()) {
    if (user.connected) emitToUser(room, user.userId, 'poll:update', serializePoll(room, poll, user.userId));
  }
}

export const openPolls = (room) => [...room.polls.values()].filter((p) => p.status === 'open');

export function createPoll(room, { question, options, durationSec, createdBy, createdByName, kind = 'normal' }) {
  const now = Date.now();
  const poll = {
    id: newId(8),
    kind,
    question,
    options: options.map((o) => ({ id: newId(6), text: o.text, meta: o.meta ?? null })),
    votes: new Map(),
    createdBy,
    createdByName,
    createdAt: now,
    closesAt: durationSec ? now + durationSec * 1000 : null,
    status: 'open',
    allowChange: true,
    winnerId: null,
  };
  room.polls.set(poll.id, poll);
  if (poll.closesAt) room.timers.set(`poll:${poll.id}`, () => closePoll(room, poll, 'timer'), durationSec * 1000);
  broadcastPoll(room, poll);
  systemMessage(room, `${createdByName} started a poll: ${question}`);
  return poll;
}

function pruneClosedPolls(room) {
  const closed = [...room.polls.values()].filter((p) => p.status === 'closed').sort((a, b) => a.createdAt - b.createdAt);
  while (closed.length > config.POLL_KEEP_CLOSED) room.polls.delete(closed.shift().id);
}

export function closePoll(room, poll, reason = 'manual') {
  if (poll.status !== 'open' || room.deleted) return;
  poll.status = 'closed';
  poll.closedReason = reason;
  poll.winnerId = computeWinner(poll);
  room.timers.clear(`poll:${poll.id}`);
  const winner = poll.options.find((o) => o.id === poll.winnerId);
  room.stats.closedPolls.push({ question: poll.question, winner: winner?.text ?? null, totalVotes: poll.votes.size });

  if (poll.kind === 'skip') {
    const yes = poll.options[0];
    const yesVotes = tallies(poll).get(yes.id).votes;
    const majority = yesVotes > connectedUsers(room).length / 2;
    poll.winnerId = majority ? yes.id : poll.options[1].id;
    broadcastPoll(room, poll);
    if (majority) {
      systemMessage(room, `Skip vote passed (${yesVotes} yes). Playing the next video.`);
      playNext(room, poll.createdBy);
    } else {
      systemMessage(room, `Skip vote failed (${yesVotes} yes). Keep watching!`);
    }
  } else {
    broadcastPoll(room, poll);
    systemMessage(room, winner ? `Poll "${poll.question}" closed. Winner: ${winner.text}` : `Poll "${poll.question}" closed with no votes`);
  }
  pruneClosedPolls(room);
}

/** A skip poll is decided as soon as the outcome can no longer change. */
export function maybeCloseSkipEarly(room, poll) {
  if (poll.kind !== 'skip' || poll.status !== 'open') return;
  const counts = tallies(poll);
  const yes = counts.get(poll.options[0].id).votes;
  const no = counts.get(poll.options[1].id).votes;
  const n = connectedUsers(room).length;
  if (yes > n / 2 || no >= n / 2) closePoll(room, poll, 'decided');
}
