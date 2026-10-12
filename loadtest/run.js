#!/usr/bin/env node
/**
 * Watch Party load tester.
 *   node run.js --url http://localhost:3001 --clients 15 --duration 120 --actionInterval 3000 --scenario mixed
 * Scenarios: mixed | burst | churn | chat. Writes results/<timestamp>-<scenario>-<clients>.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setupRoom, SCENARIOS } from './lib/scenarios.js';
import { summarize } from './lib/stats.js';
import { testConditions } from './lib/conditions.js';

const TARGET_LATENCY_P95_MS = 250;
const TARGET_DRIFT_MS = 500;

function parseArgs(argv) {
  const args = { url: 'http://localhost:3001', clients: 15, duration: 120, actionInterval: 3000, scenario: 'mixed', out: null, fineRates: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key === 'fineRates' || key === 'quiet') args[key] = true;
    else {
      args[key] = ['clients', 'duration', 'actionInterval'].includes(key) ? Number(next) : next;
      i += 1;
    }
  }
  if (!SCENARIOS[args.scenario]) throw new Error(`Unknown scenario "${args.scenario}" (mixed, burst, churn, chat)`);
  args.out ||= `results/${new Date().toISOString().replace(/[:.]/g, '-')}-${args.scenario}-${args.clients}c.json`;
  return args;
}

const fmt = (v, unit = 'ms') => (v === null || v === undefined ? '–' : `${v} ${unit}`);
const pad = (s, n) => String(s).padEnd(n);

function printTable(title, rows) {
  console.log(`\n${title}`);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)) + 2);
  rows.forEach((r, idx) => {
    console.log(r.map((c, i) => pad(c, widths[i])).join(''));
    if (idx === 0) console.log(widths.map((w) => '-'.repeat(w - 1)).join(' '));
  });
}

export async function runLoadTest(args) {
  const conditions = testConditions(args);
  const sim = { fineRates: args.fineRates };
  if (!args.quiet) console.log(`\n▶ ${args.scenario} · ${args.clients} clients · ${args.duration}s · action every ${args.actionInterval} ms · ${args.url}`);
  const ctx = await setupRoom({ ...args, sim });
  const scenarioResult = await SCENARIOS[args.scenario](ctx, { ...args, sim });

  // Settle: final check that every client ended at the server's state.
  await new Promise((r) => setTimeout(r, 1500));
  const server = (await ctx.controller.emit('playback:get')).state;
  for (const b of ctx.bots) b.stopLoops();
  const connected = ctx.bots.filter((b) => b.socket.connected);
  const finalMismatches = connected.filter((b) => b.lastSeq !== server.seq || b.state.playing !== server.playing).map((b) => ({ name: b.name, seq: b.lastSeq }));

  const allLat = ctx.bots.flatMap((b) => b.latencies.map((l) => l.ms));
  const allS2C = ctx.bots.flatMap((b) => b.serverToClient);
  const allDrift = ctx.bots.flatMap((b) => b.drift.map((d) => Math.abs(d.drift)));
  const afterCorrection = ctx.bots.flatMap((b) => b.drift.filter((d) => !d.triggered).map((d) => Math.abs(d.drift)));
  const latency = summarize(allLat);
  const drift = summarize(afterCorrection);
  const driftAllSamples = summarize(allDrift);
  const perClient = ctx.bots.map((b) => ({
    name: b.name,
    clockOffsetMs: Math.round(b.offset * 10) / 10,
    rttMs: b.rtt === null ? null : Math.round(b.rtt * 10) / 10,
    latency: summarize(b.latencies.map((l) => l.ms)),
    drift: summarize(b.drift.filter((d) => !d.triggered).map((d) => Math.abs(d.drift))),
    hardCorrections: b.drift.filter((d) => d.triggered).length,
    corrections: b.corrector.corrections,
    stalls: b.sim.stallCount,
    seqGaps: b.seqGaps,
    outOfOrder: b.outOfOrder,
    duplicates: b.duplicates,
  }));
  const correctness = {
    finalStateMismatches: finalMismatches.length,
    finalMismatchDetails: finalMismatches,
    outOfOrderEvents: perClient.reduce((a, c) => a + c.outOfOrder, 0),
    lostEvents_seqGaps: perClient.reduce((a, c) => a + c.seqGaps, 0),
    duplicateEvents: perClient.reduce((a, c) => a + c.duplicates, 0),
    serverFinalSeq: server.seq,
  };
  const verdict = {
    latencyP95: { target: TARGET_LATENCY_P95_MS, value: latency.p95, pass: latency.p95 !== null && latency.p95 <= TARGET_LATENCY_P95_MS },
    driftP95: { target: TARGET_DRIFT_MS, value: drift.p95, pass: drift.p95 !== null && drift.p95 <= TARGET_DRIFT_MS },
    driftMax: { target: TARGET_DRIFT_MS, value: drift.max, pass: drift.max !== null && drift.max <= TARGET_DRIFT_MS },
    correctness: { pass: correctness.finalStateMismatches === 0 && correctness.outOfOrderEvents === 0 && correctness.lostEvents_seqGaps === 0 },
  };
  const result = {
    conditions,
    targets: { propagationP95Ms: TARGET_LATENCY_P95_MS, driftAfterCorrectionMs: TARGET_DRIFT_MS },
    method: {
      latency: 'sender stamps sentAt = its serverNow(); every receiver computes its serverNow() - sentAt on playback:state (includes clock-sync error)',
      drift: '|simulated player position - expected room position| sampled every 1 s while playing. "drift" = after correction: every sample except the ones that detected a disturbance and triggered a hard seek (those are, by definition, before the correction; they are kept in driftAllSamples). Not sampled during the 1.5 s settle window after a seek/play, or while the player is stalled (buffering).',
      simulation: 'each bot player gains/loses 20-80 ms per second at random and stalls for 500-1500 ms with 3 % probability per second; seeks cost 40-120 ms; ' + (args.fineRates ? 'fine playback rates available (soft correction)' : 'classic YouTube rate list (no soft correction; hard seek above 0.4 s)'),
    },
    latency,
    serverToClient: summarize(allS2C),
    drift,
    driftAllSamples,
    correctness,
    scenario: scenarioResult,
    verdict,
    perClient,
  };

  for (const b of ctx.bots) b.disconnect();
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(result, null, 2));

  const pf = (ok) => (ok ? 'PASS' : 'FAIL');
  printTable(`Propagation latency (${latency.count} deliveries)`, [
    ['p50', 'p90', 'p95', 'p99', 'max', 'mean', 'target p95', 'result'],
    [fmt(latency.p50), fmt(latency.p90), fmt(latency.p95), fmt(latency.p99), fmt(latency.max), fmt(latency.mean), `${TARGET_LATENCY_P95_MS} ms`, pf(verdict.latencyP95.pass)],
  ]);
  printTable(`Drift: all samples incl. disturbance detections (${driftAllSamples.count})`, [
    ['p50', 'p95', 'p99', 'max'],
    [fmt(driftAllSamples.p50), fmt(driftAllSamples.p95), fmt(driftAllSamples.p99), fmt(driftAllSamples.max)],
  ]);
  printTable(`Drift after correction (${drift.count} samples)`, [
    ['p50', 'p95', 'p99', 'max', 'target', 'p95 result', 'max result'],
    [fmt(drift.p50), fmt(drift.p95), fmt(drift.p99), fmt(drift.max), `${TARGET_DRIFT_MS} ms`, pf(verdict.driftP95.pass), pf(verdict.driftMax.pass)],
  ]);
  printTable('Correctness', [
    ['final-state mismatches', 'out-of-order', 'lost (seq gaps)', 'duplicates', 'result'],
    [correctness.finalStateMismatches, correctness.outOfOrderEvents, correctness.lostEvents_seqGaps, correctness.duplicateEvents, pf(verdict.correctness.pass)],
  ]);
  console.log('\nScenario:', JSON.stringify({ ...scenarioResult, snapshots: undefined, convergenceFailures: scenarioResult.convergenceFailures?.length }));
  console.log(`Saved ${args.out}`);
  return result;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runLoadTest(parseArgs(process.argv.slice(2)))
    .then((r) => process.exit(Object.values(r.verdict).every((v) => v.pass) ? 0 : 1))
    .catch((err) => {
      console.error('Load test failed to run:', err.message);
      process.exit(2);
    });
}

export { parseArgs };
