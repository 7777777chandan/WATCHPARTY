// Failure-handling tests: malformed and abusive input over a raw socket.io-client.
process.env.LOG_LEVEL = 'silent';
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, emit, waitFor, sleep, uid } = await import('./helpers.js');

let srv;
before(async () => (srv = await startServer()));
after(async () => srv.stop());

async function roomWithVideo() {
  const s = await srv.connect();
  const { code } = await emit(s, 'room:create', { name: 'Host', userId: uid() });
  await emit(s, 'video:set', { videoId: 'dQw4w9WgXcQ' });
  return { s, code };
}

test('malformed playback payloads are rejected and the server stays healthy', async () => {
  const { s } = await roomWithVideo();
  const bad = [
    { type: 'play', position: -5 },
    { type: 'play', position: '12' },
    { type: 'seek', position: NaN },
    { type: 'seek', position: 1e12 },
    { type: 'seek', position: null },
    { type: 'explode', position: 1 },
    { type: ['play'], position: 1 },
    { position: 1 },
  ];
  for (const p of bad) {
    const res = await emit(s, 'playback:action', p);
    assert.equal(res.ok, false, JSON.stringify(p));
  }
  for (const p of ['string', 42, [1, 2], true]) assert.equal((await emit(s, 'playback:action', p)).error, 'Invalid payload');
  // Prototype-pollution shaped payloads are just ignored data.
  assert.equal((await emit(s, 'room:settings', JSON.parse('{"__proto__": {"polluted": true}}'))).ok, false);
  assert.equal({}.polluted, undefined);
  const health = await fetch(`${srv.url}/health`).then((r) => r.json());
  assert.equal(health.status, 'ok');
});

test('wrong types and oversized fields everywhere', async () => {
  const { s } = await roomWithVideo();
  const cases = [
    ['chat:send', { text: { nested: true } }],
    ['chat:send', { text: 'x'.repeat(5000) }],
    ['reaction:send', { emoji: '💩' }],
    ['reaction:send', { emoji: 123 }],
    ['poll:create', { question: 'Q', options: Array(50).fill('a') }],
    ['poll:create', { question: 'Q', options: 'a,b' }],
    ['poll:vote', { pollId: '../../etc', optionId: 'x' }],
    ['playlist:add', { url: 'javascript:alert(1)' }],
    ['playlist:reorder', { itemId: 'nope', newIndex: -1 }],
    ['host:transfer', { toUserId: { $ne: null } }],
    ['user:kick', { userId: '' }],
    ['countdown:start', { seconds: 9999 }],
    ['drift:report', { drift: 'fast' }],
    ['video:set', { videoId: '<img src=x>' }],
    ['room:join', { code: 'AAAAAA', name: 'x', userId: 'short' }],
  ];
  for (const [evt, payload] of cases) {
    const res = await emit(s, evt, payload);
    assert.equal(res.ok, false, `${evt} ${JSON.stringify(payload).slice(0, 60)}`);
  }
});

test('events without an ack get an action:error event instead', async () => {
  const { s } = await roomWithVideo();
  const err = waitFor(s, 'action:error', (e) => e.event === 'playback:action');
  s.emit('playback:action', { type: 'play', position: -1 });
  assert.match((await err).error, />= 0/);
});

test('a 1 MB chat message closes that socket; the server keeps running', async () => {
  const { s } = await roomWithVideo();
  const other = await srv.connect();
  const closed = waitFor(s, 'disconnect');
  s.emit('chat:send', { text: 'x'.repeat(1024 * 1024) });
  assert.ok(await closed);
  const res = await emit(other, 'room:create', { name: 'Still works', userId: uid() });
  assert.equal(res.ok, true);
});

test('1000 events per second: dropped beyond 50/s, then the socket is disconnected', async () => {
  const { s } = await roomWithVideo();
  const limited = waitFor(s, 'rate:limited');
  const kicked = waitFor(s, 'abuse:disconnect', () => true, 5000);
  const flood = (async () => {
    for (let second = 0; second < 4 && s.connected; second++) {
      for (let i = 0; i < 1000; i++) s.emit('reaction:send', { emoji: '🔥' });
      await sleep(1000);
    }
  })();
  assert.ok(await limited);
  assert.ok(await kicked);
  await flood;
  const fresh = await srv.connect();
  assert.equal((await emit(fresh, 'time:ping', { t0: 1 })).t0, 1);
});

test('30-user join and leave storm keeps a consistent room', async () => {
  const host = await srv.connect();
  const { code } = await emit(host, 'room:create', { name: 'Host', userId: uid() });
  const sockets = await Promise.all(Array.from({ length: 30 }, () => srv.connect()));
  const ids = sockets.map(() => uid());
  await Promise.all(sockets.map((s, i) => emit(s, 'room:join', { code, name: `U${i}`, userId: ids[i] })));
  // Half leave, a quarter disconnect abruptly, then they all come back at once.
  await Promise.all(sockets.slice(0, 15).map((s) => emit(s, 'room:leave')));
  sockets.slice(15, 23).forEach((s) => s.disconnect());
  const back = await Promise.all(sockets.slice(15, 23).map(() => srv.connect()));
  await Promise.all([
    ...sockets.slice(0, 15).map((s, i) => emit(s, 'room:join', { code, name: `U${i}`, userId: ids[i] })),
    ...back.map((s, j) => emit(s, 'room:join', { code, name: `U${15 + j}`, userId: ids[15 + j] })),
  ]);
  const snap = await emit(host, 'room:join', { code, name: 'Host', userId: (await emit(host, 'stats:get')).ok ? undefined : undefined }).catch(() => null);
  void snap;
  const res = await emit(sockets[0], 'room:join', { code, name: 'U0', userId: ids[0] });
  assert.equal(res.room.users.length, 31);
  assert.equal(res.room.users.filter((u) => u.connected).length, 31);
  assert.equal(new Set(res.room.users.map((u) => u.userId)).size, 31);
});
