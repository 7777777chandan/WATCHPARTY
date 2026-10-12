import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, emit, waitFor, uid } from './helpers.js';

let srv;
before(async () => (srv = await startServer()));
after(async () => srv.stop());

async function room(n = 2) {
  const sockets = [];
  const ids = [];
  for (let i = 0; i < n; i++) sockets.push(await srv.connect());
  ids.push(uid());
  const { code } = await emit(sockets[0], 'room:create', { name: 'U0', userId: ids[0] });
  for (let i = 1; i < n; i++) {
    ids.push(uid());
    await emit(sockets[i], 'room:join', { code, name: `U${i}`, userId: ids[i] });
  }
  return { code, sockets, ids };
}

test('chat: broadcast, html kept as plain text, rate limit, history in snapshot', async () => {
  const { code, sockets: [a, b] } = await room();
  const got = waitFor(b, 'chat:message', (m) => m.type === 'user');
  assert.equal((await emit(a, 'chat:send', { text: '<script>alert(1)</script>' })).ok, true);
  assert.equal((await got).text, '<script>alert(1)</script>');
  assert.equal((await emit(a, 'chat:send', { text: '   ' })).ok, false);
  assert.equal((await emit(a, 'chat:send', { text: 'x'.repeat(501) })).ok, false);
  assert.equal((await emit(a, 'chat:send', { text: 42 })).ok, false);
  let limited = null;
  for (let i = 0; i < 6; i++) limited = await emit(a, 'chat:send', { text: `m${i}` });
  assert.equal(limited.code, 'RATE_LIMITED');
  const c = await srv.connect();
  const snap = await emit(c, 'room:join', { code, name: 'Late', userId: uid() });
  assert.ok(snap.room.chat.some((m) => m.text === '<script>alert(1)</script>'));
});

test('reactions: whitelist and rate limit', async () => {
  const { sockets: [a, b] } = await room();
  await emit(a, 'video:set', { videoId: 'dQw4w9WgXcQ' });
  const shown = waitFor(b, 'reaction:show');
  assert.equal((await emit(a, 'reaction:send', { emoji: '🔥' })).ok, true);
  assert.equal((await shown).emoji, '🔥');
  assert.equal((await emit(a, 'reaction:send', { emoji: '💩' })).ok, false);
  let res;
  for (let i = 0; i < 6; i++) res = await emit(a, 'reaction:send', { emoji: '👍' });
  assert.equal(res.code, 'RATE_LIMITED');
});

test('polls: vote, change vote, anonymous tallies with myVote, close with winner', async () => {
  const { sockets: [a, b, c] } = await room(3);
  const first = waitFor(b, 'poll:update', (p) => p.question === 'Pizza?');
  const created = await emit(a, 'poll:create', { question: 'Pizza?', options: ['Yes', 'No', 'Maybe'] });
  assert.equal(created.ok, true);
  assert.equal((await emit(a, 'poll:create', { question: 'Again?', options: ['a', 'b'] })).ok, false); // 1 open per user
  const upd = await first;
  const [yes, no] = upd.options;
  await emit(b, 'poll:vote', { pollId: created.pollId, optionId: no.id });
  await emit(c, 'poll:vote', { pollId: created.pollId, optionId: yes.id });
  const mine = waitFor(b, 'poll:update', (p) => p.myVote === yes.id);
  await emit(b, 'poll:vote', { pollId: created.pollId, optionId: yes.id });
  const p = await mine;
  assert.equal(p.options[0].votes, 2);
  assert.equal(p.voters, undefined);
  assert.equal((await emit(b, 'poll:close', { pollId: created.pollId })).ok, false);
  const closed = waitFor(c, 'poll:update', (x) => x.status === 'closed');
  await emit(a, 'poll:close', { pollId: created.pollId });
  assert.equal((await closed).winnerId, yes.id);
  assert.equal((await emit(c, 'poll:vote', { pollId: created.pollId, optionId: no.id })).ok, false);
  assert.equal((await emit(a, 'poll:create', { question: 'Bad', options: ['only one'] })).ok, false);
  assert.equal((await emit(a, 'poll:create', { question: 'Bad', options: ['a', 'b'], durationSec: 5 })).ok, false);
});

test('playlist: add (explicit title), dedupe, vote, reorder, play next with seq guard, skip poll', async () => {
  const { sockets: [a, b, c] } = await room(3);
  const add = (s, url, title) => emit(s, 'playlist:add', { url, title });
  assert.equal((await add(b, 'https://youtu.be/dQw4w9WgXcQ', 'Rick')).ok, true);
  assert.equal((await add(a, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Rick')).ok, false);
  assert.equal((await add(a, 'https://example.com/x', 'Nope')).ok, false);
  const second = await add(a, 'https://www.youtube.com/embed/9bZkp7q19f0', 'Gangnam');
  const third = await add(c, 'kJQP7kiw5Fk', 'Despacito');
  const voted = await emit(b, 'playlist:vote', { itemId: third.item.id });
  assert.equal(voted.voted, true);
  assert.equal((await emit(b, 'playlist:reorder', { itemId: third.item.id, newIndex: 0 })).ok, false);
  const reordered = waitFor(b, 'playlist:update', (p) => p.items[0].id === third.item.id);
  await emit(a, 'playlist:sortByVotes');
  await reordered;
  const playing = waitFor(b, 'playback:state', (s) => s.videoId === 'kJQP7kiw5Fk');
  await emit(a, 'playlist:playNow', { itemId: third.item.id });
  const st = await playing;
  assert.equal(st.playing, true);
  // ENDED from the host with a stale seq is ignored; the right seq advances.
  assert.equal((await emit(a, 'playlist:next', { seq: st.seq - 1 })).ignored, true);
  const next = waitFor(c, 'playback:state', (s) => s.seq === st.seq + 1);
  assert.equal((await emit(a, 'playlist:next', { seq: st.seq })).ok, true);
  assert.equal((await next).videoId, 'dQw4w9WgXcQ');
  // Skip poll: 2 of 3 yes is a majority and plays the following item.
  const skipPoll = waitFor(a, 'poll:update', (p) => p.kind === 'skip');
  const sp = await emit(b, 'poll:createSkip');
  const poll = await skipPoll;
  assert.equal(poll.id, sp.pollId);
  const skipped = waitFor(c, 'playback:state', (s) => s.videoId === '9bZkp7q19f0');
  await emit(a, 'poll:vote', { pollId: sp.pollId, optionId: poll.options[0].id });
  await emit(c, 'poll:vote', { pollId: sp.pollId, optionId: poll.options[0].id });
  assert.ok(await skipped);
  assert.ok(second.ok);
});

test('countdown starts playback at startAt; stats recap', async () => {
  const { sockets: [a, b] } = await room();
  await emit(a, 'video:set', { videoId: 'dQw4w9WgXcQ' });
  assert.equal((await emit(b, 'countdown:start', { seconds: 3 })).ok, false);
  const shown = waitFor(b, 'countdown:show');
  const res = await emit(a, 'countdown:start', { seconds: 3 });
  assert.equal(res.ok, true);
  const cd = await shown;
  const play = await waitFor(b, 'playback:state', (s) => s.playing && s.countdown, 5000);
  assert.equal(play.updatedAt, cd.startAt);
  await emit(a, 'reaction:send', { emoji: '🎉' });
  await emit(b, 'chat:send', { text: 'hi' });
  const recap = await emit(b, 'stats:get');
  assert.equal(recap.recap.reactionCount, 1);
  assert.equal(recap.recap.topChatter.name, 'U1');
  const ended = waitFor(b, 'room:ended');
  await emit(a, 'room:end');
  assert.ok((await ended).recap);
});
