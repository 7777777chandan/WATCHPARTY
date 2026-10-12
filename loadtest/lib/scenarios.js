import { Bot } from './bot.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const VIDEO = 'dQw4w9WgXcQ';

/** Creates the room with a controller bot, then N-1 joiners; all clock-synced. */
export async function setupRoom(opts) {
  const { url, clients, sim } = opts;
  const controller = new Bot({ url, name: 'controller', sim });
  await controller.connect();
  await controller.syncClock();
  await controller.create();
  const bots = [controller];
  const joiners = [];
  for (let i = 1; i < clients; i++) joiners.push(new Bot({ url, name: `bot${i}`, sim }));
  // Connect in small batches, like people arriving.
  for (let i = 0; i < joiners.length; i += 5) {
    await Promise.all(
      joiners.slice(i, i + 5).map(async (b) => {
        await b.connect();
        await b.syncClock();
        await b.join(controller.code);
      }),
    );
  }
  bots.push(...joiners);
  const vs = await controller.emit('video:set', { videoId: VIDEO });
  if (!vs.ok) throw new Error(`video:set failed: ${vs.error}`);
  await sleep(300);
  await controller.action('play', 0);
  await sleep(500);
  for (const b of bots) b.startLoops();
  return { controller, bots };
}

function randomAction(bot) {
  const r = Math.random();
  const type = r < 0.4 ? 'seek' : bot.state?.playing ? 'pause' : 'play';
  const pos = type === 'seek' ? Math.random() * 500 : bot.sim.time();
  return bot.action(type, pos);
}

/** Random play / pause / seek from random clients every actionInterval ms. */
export async function mixed(ctx, { duration, actionInterval }) {
  const end = Date.now() + duration * 1000;
  let actions = 0;
  while (Date.now() < end) {
    const res = await randomAction(pick(ctx.bots));
    if (res?.ok) actions += 1;
    await sleep(actionInterval);
  }
  return { actionsSent: actions };
}

/**
 * Every actionInterval ms, ALL clients send an action within the same 50 ms window. After each
 * burst we wait and check every client converged to the same final seq and state as the server.
 */
export async function burst(ctx, { duration, actionInterval, url }) {
  const end = Date.now() + duration * 1000;
  let bursts = 0;
  let converged = 0;
  const failures = [];
  while (Date.now() < end) {
    await Promise.all(
      ctx.bots.map(async (b) => {
        await sleep(Math.random() * 50);
        await randomAction(b);
      }),
    );
    bursts += 1;
    await sleep(Math.max(1000, actionInterval / 2));
    const server = (await ctx.controller.emit('playback:get')).state;
    const bad = ctx.bots.filter((b) => b.lastSeq !== server.seq || b.state.playing !== server.playing || Math.abs(b.state.position - server.position) > 1e-6);
    if (bad.length === 0) converged += 1;
    else failures.push({ burst: bursts, serverSeq: server.seq, diverged: bad.map((b) => ({ name: b.name, seq: b.lastSeq })) });
    await sleep(Math.max(0, actionInterval / 2));
  }
  void url;
  return { bursts, converged, convergenceFailures: failures };
}

/**
 * 3 clients disconnect and reconnect every 20 s; late joiners arrive at 1/3 and 2/3 of the run.
 * Each (re)joiner must receive a correct snapshot within 1 s.
 */
export async function churn(ctx, opts) {
  const { duration, actionInterval, url, sim } = opts;
  const end = Date.now() + duration * 1000;
  const snapshots = [];
  let actions = 0;
  let nextChurn = Date.now() + 20_000;
  const lateAt = [Date.now() + (duration * 1000) / 3, Date.now() + (2 * duration * 1000) / 3];
  let lateIdx = 0;

  const checkSnapshot = (bot, kind, ms) => {
    const server = ctx.controller.state;
    const expectedNow = ctx.controller.expected();
    const posErr = Math.abs(bot.expected() - expectedNow);
    snapshots.push({ kind, name: bot.name, ms: Math.round(ms), correct: bot.state.videoId === server.videoId && bot.state.playing === server.playing && posErr < 0.25, positionErrorMs: Math.round(posErr * 1000) });
  };

  const reconnect = async (bot) => {
    bot.disconnect();
    await sleep(500 + Math.random() * 1500);
    const t0 = Date.now();
    await bot.connect();
    await bot.syncClock(4);
    const { ms } = await bot.join(ctx.controller.code);
    bot.startLoops();
    checkSnapshot(bot, 'reconnect', ms + 0 * t0);
  };

  while (Date.now() < end) {
    if (Date.now() >= nextChurn) {
      nextChurn += 20_000;
      const victims = ctx.bots.filter((b) => b !== ctx.controller).sort(() => Math.random() - 0.5).slice(0, 3);
      await Promise.all(victims.map(reconnect));
    }
    if (lateIdx < lateAt.length && Date.now() >= lateAt[lateIdx]) {
      lateIdx += 1;
      const late = new Bot({ url, name: `late${lateIdx}`, sim });
      await late.connect();
      await late.syncClock();
      const { ms } = await late.join(ctx.controller.code);
      late.startLoops();
      ctx.bots.push(late);
      checkSnapshot(late, 'late-join', ms);
    }
    const res = await randomAction(pick(ctx.bots.filter((b) => b.socket.connected)));
    if (res?.ok) actions += 1;
    await sleep(actionInterval);
  }
  return {
    actionsSent: actions,
    snapshots,
    snapshotsWithin1s: snapshots.filter((s) => s.ms <= 1000).length,
    snapshotsCorrect: snapshots.filter((s) => s.correct).length,
  };
}

/** Every client sends chat (1/s = the 5 per 5 s limit) and reactions (5/s) for the whole run. */
export async function chat(ctx, { duration, actionInterval }) {
  const end = Date.now() + duration * 1000;
  let chatSent = 0;
  let chatRejected = 0;
  let reactionsSent = 0;
  let reactionsRejected = 0;
  const emojis = ['😂', '❤️', '😮', '👏', '🔥', '😢', '👍', '🎉'];
  const loops = ctx.bots.map(async (b, i) => {
    await sleep(i * 37);
    let tick = 0;
    while (Date.now() < end) {
      if (tick % 5 === 0) {
        const res = await b.emit('chat:send', { text: `lt:${b.serverNow().toFixed(1)} hello from ${b.name}` });
        if (res?.ok) chatSent += 1;
        else chatRejected += 1;
      }
      const r = await b.emit('reaction:send', { emoji: pick(emojis) });
      if (r?.ok) reactionsSent += 1;
      else reactionsRejected += 1;
      tick += 1;
      await sleep(205);
    }
  });
  let actions = 0;
  const actionLoop = (async () => {
    while (Date.now() < end) {
      const res = await randomAction(pick(ctx.bots));
      if (res?.ok) actions += 1;
      await sleep(actionInterval);
    }
  })();
  await Promise.all([...loops, actionLoop]);
  await sleep(1000);
  const expectedDeliveries = chatSent * ctx.bots.length;
  const delivered = ctx.bots.reduce((a, b) => a + b.chatReceived, 0);
  return { chatSent, chatRejected, reactionsSent, reactionsRejected, actionsSent: actions, chatDeliveries: delivered, chatExpectedDeliveries: expectedDeliveries, chatDeliveryRate: expectedDeliveries ? delivered / expectedDeliveries : null };
}

export const SCENARIOS = { mixed, burst, churn, chat };
