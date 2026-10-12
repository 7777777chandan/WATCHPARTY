import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, emit, waitFor, uid } from './helpers.js';

let srv;
before(async () => (srv = await startServer()));
after(async () => srv.stop());

test('create + join, both see each other, host flagged', async () => {
  const a = await srv.connect();
  const b = await srv.connect();
  const created = await emit(a, 'room:create', { name: 'Alice', userId: uid() });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const usersOnA = waitFor(a, 'room:users', (u) => u.length === 2);
  const joined = await emit(b, 'room:join', { code: created.code.toLowerCase(), name: '  Bob  ', userId: uid() });
  assert.equal(joined.ok, true);
  assert.equal(joined.room.users.length, 2);
  const users = await usersOnA;
  assert.deepEqual(users.map((u) => [u.name, u.isHost]), [['Alice', true], ['Bob', false]]);
});

test('join validation errors', async () => {
  const s = await srv.connect();
  assert.equal((await emit(s, 'room:join', { code: 'ZZZZZZ', name: 'X', userId: uid() })).error, 'Room not found');
  assert.match((await emit(s, 'room:join', { code: 'AB', name: 'X', userId: uid() })).error, /6 letters/);
  const created = await emit(s, 'room:create', { name: 'Host', userId: uid() });
  const t = await srv.connect();
  assert.match((await emit(t, 'room:join', { code: created.code, name: '   ', userId: uid() })).error, /empty/);
  assert.match((await emit(t, 'room:join', { code: created.code, name: 'x'.repeat(25), userId: uid() })).error, /24/);
  assert.equal((await emit(t, 'room:join', 'not-an-object')).error, 'Invalid payload');
  assert.equal((await emit(t, 'room:join', { code: created.code, name: 'ok', userId: 5 })).error, 'Invalid userId');
});

test('rejoin with same userId keeps host and does not duplicate', async () => {
  const hostId = uid();
  const a = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'Host', userId: hostId });
  a.disconnect();
  const a2 = await srv.connect();
  const res = await emit(a2, 'room:join', { code, name: 'Host', userId: hostId });
  assert.equal(res.ok, true);
  assert.equal(res.rejoined, true);
  assert.equal(res.room.hostId, hostId);
  assert.equal(res.room.users.length, 1);
  assert.equal(res.room.users[0].connected, true);
});

test('duplicate tab gets session:replaced', async () => {
  const id = uid();
  const a = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'Dup', userId: id });
  const replaced = waitFor(a, 'session:replaced');
  const b = await srv.connect();
  await emit(b, 'room:join', { code, name: 'Dup', userId: id });
  assert.equal((await replaced).code, code);
  await waitFor(a, 'disconnect');
  // The new socket is still the active member.
  const res = await emit(b, 'chat:send', { text: 'still here' });
  assert.equal(res.ok, true);
});

test('playback actions broadcast with increasing seq; invalid ones rejected', async () => {
  const a = await srv.connect();
  const b = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'A', userId: uid() });
  await emit(b, 'room:join', { code, name: 'B', userId: uid() });
  assert.match((await emit(b, 'playback:action', { type: 'play', position: 0 })).error, /No video/);
  assert.equal((await emit(b, 'video:set', { videoId: 'dQw4w9WgXcQ' })).error, 'Only the host can do that');
  assert.equal((await emit(a, 'video:set', { videoId: 'bad' })).ok, false);
  const setState = waitFor(b, 'playback:state', (s) => s.videoId === 'dQw4w9WgXcQ');
  assert.equal((await emit(a, 'video:set', { videoId: 'dQw4w9WgXcQ' })).ok, true);
  const s1 = await setState;
  const played = waitFor(a, 'playback:state', (s) => s.seq === s1.seq + 1);
  const res = await emit(b, 'playback:action', { type: 'play', position: 12.5, clientSeq: s1.seq, sentAt: 123 });
  assert.equal(res.ok, true);
  const s2 = await played;
  assert.equal(s2.playing, true);
  assert.equal(s2.position, 12.5);
  assert.equal(s2.sentAt, 123);
  for (const bad of [{ type: 'play', position: -1 }, { type: 'play', position: '5' }, { type: 'jump', position: 1 }, { type: 'seek', position: Infinity }]) {
    assert.equal((await emit(b, 'playback:action', bad)).ok, false, JSON.stringify(bad));
  }
});

test('duplicate action within 150 ms is debounced; host-only mode blocks guests', async () => {
  const a = await srv.connect();
  const b = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'A', userId: uid() });
  await emit(b, 'room:join', { code, name: 'B', userId: uid() });
  await emit(a, 'video:set', { videoId: 'dQw4w9WgXcQ' });
  const r1 = await emit(b, 'playback:action', { type: 'play', position: 1 });
  const r2 = await emit(b, 'playback:action', { type: 'play', position: 1 });
  assert.equal(r1.deduped, undefined);
  assert.equal(r2.deduped, true);
  assert.equal((await emit(b, 'room:settings', { controlMode: 'host-only' })).error, 'Only the host can do that');
  const settings = waitFor(b, 'room:settings');
  assert.equal((await emit(a, 'room:settings', { controlMode: 'host-only' })).ok, true);
  assert.equal((await settings).controlMode, 'host-only');
  assert.equal((await emit(b, 'playback:action', { type: 'pause', position: 3 })).code, 'HOST_ONLY_MODE');
  assert.equal((await emit(a, 'playback:action', { type: 'pause', position: 3 })).ok, true);
  assert.equal((await emit(a, 'room:settings', { bogus: 1 })).ok, false);
});

test('stale actions are flagged', async () => {
  const a = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'A', userId: uid() });
  await emit(a, 'video:set', { videoId: 'dQw4w9WgXcQ' });
  for (let i = 0; i < 8; i++) await emit(a, 'playback:action', { type: 'seek', position: i * 10 });
  const stale = waitFor(a, 'playback:state', (s) => s.stale === true);
  await emit(a, 'playback:action', { type: 'seek', position: 999, clientSeq: 0 });
  assert.ok(await stale);
  assert.ok(code);
});

test('host transfer, kick and ban, lock', async () => {
  const a = await srv.connect();
  const b = await srv.connect();
  const c = await srv.connect();
  const bId = uid();
  const cId = uid();
  const { code } = await emit(a, 'room:create', { name: 'A', userId: uid() });
  await emit(b, 'room:join', { code, name: 'B', userId: bId });
  await emit(c, 'room:join', { code, name: 'C', userId: cId });
  const hostEvt = waitFor(c, 'room:host');
  assert.equal((await emit(a, 'host:transfer', { toUserId: bId })).ok, true);
  assert.equal((await hostEvt).hostId, bId);
  assert.equal((await emit(a, 'user:kick', { userId: cId })).error, 'Only the host can do that');
  const kicked = waitFor(c, 'kicked');
  assert.equal((await emit(b, 'user:kick', { userId: cId })).ok, true);
  await kicked;
  const again = await emit(c, 'room:join', { code, name: 'C', userId: cId });
  assert.equal(again.code, 'BANNED');
  await emit(b, 'room:settings', { locked: true });
  const d = await srv.connect();
  assert.equal((await emit(d, 'room:join', { code, name: 'D', userId: uid() })).code, 'LOCKED');
});

test('same socket switching identity in a room does not leave a ghost member', async () => {
  const a = await srv.connect();
  const s = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'Host', userId: uid() });
  await emit(s, 'room:join', { code, name: 'First', userId: uid() });
  const res = await emit(s, 'room:join', { code, name: 'Second', userId: uid() });
  assert.deepEqual(res.room.users.map((u) => u.name), ['Host', 'Second']);
});

test('a stale leave for the previous room does not leave the new one', async () => {
  const s = await srv.connect();
  const id = uid();
  const first = await emit(s, 'room:create', { name: 'Me', userId: id });
  const second = await emit(s, 'room:create', { name: 'Me', userId: id });
  assert.equal((await emit(s, 'room:leave', { code: first.code })).ignored, true);
  assert.equal((await emit(s, 'chat:send', { text: 'still in the second room' })).ok, true);
  assert.ok(second.ok);
});
