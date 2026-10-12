// Short timers so the 60 s / 15 s grace rules can be tested quickly.
process.env.USER_REMOVAL_GRACE_MS = '600';
process.env.HOST_GRACE_MS = '300';
process.env.LOG_LEVEL = 'warn';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, emit, waitFor, sleep, uid } = await import('./helpers.js');

let srv;
before(async () => (srv = await startServer()));
after(async () => srv.stop());

test('disconnected user greys out, then is removed after the grace period', async () => {
  const a = await srv.connect();
  const b = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'A', userId: uid() });
  await emit(b, 'room:join', { code, name: 'B', userId: uid() });
  const grey = waitFor(a, 'room:users', (u) => u.some((x) => x.name === 'B' && !x.connected));
  b.disconnect();
  await grey;
  await waitFor(a, 'room:users', (u) => u.length === 1, 2000);
});

test('host back within grace keeps host; absent beyond grace transfers', async () => {
  const hostId = uid();
  const a = await srv.connect();
  const b = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'Host', userId: hostId });
  await emit(b, 'room:join', { code, name: 'Guest', userId: uid() });

  a.disconnect();
  await sleep(100);
  const a2 = await srv.connect();
  const back = await emit(a2, 'room:join', { code, name: 'Host', userId: hostId });
  assert.equal(back.room.hostId, hostId);
  await sleep(400); // past the host grace: must still be host
  const snap = await emit(a2, 'room:join', { code, name: 'Host', userId: hostId });
  assert.equal(snap.room.hostId, hostId);

  const transfer = waitFor(b, 'room:host');
  a2.disconnect();
  const evt = await transfer;
  assert.notEqual(evt.hostId, hostId);
});

test('room is deleted after everyone has gone', async () => {
  const a = await srv.connect();
  const { code } = await emit(a, 'room:create', { name: 'Solo', userId: uid() });
  a.disconnect();
  await sleep(800);
  const b = await srv.connect();
  assert.equal((await emit(b, 'room:join', { code, name: 'Late', userId: uid() })).code, 'ROOM_NOT_FOUND');
});
