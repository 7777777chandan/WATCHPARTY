#!/usr/bin/env node
/**
 * Runs every scenario plus scaling runs (10 / 15 / 30 clients) and prints one summary table.
 *   node all.js [--url http://localhost:3001] [--short]   (--short: 20 s runs for a quick check)
 */
import { writeFileSync } from 'node:fs';
import { runLoadTest } from './run.js';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://localhost:3001';
const short = argv.includes('--short');
const d = (sec) => (short ? Math.min(sec, 20) : sec);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const RUNS = [
  { label: 'mixed · 10 clients', scenario: 'mixed', clients: 10, duration: d(60), actionInterval: 3000 },
  { label: 'mixed · 15 clients', scenario: 'mixed', clients: 15, duration: d(120), actionInterval: 3000 },
  { label: 'mixed · 30 clients', scenario: 'mixed', clients: 30, duration: d(60), actionInterval: 3000 },
  { label: 'mixed · 15 clients · fine rates', scenario: 'mixed', clients: 15, duration: d(60), actionInterval: 3000, fineRates: true },
  { label: 'burst · 15 clients', scenario: 'burst', clients: 15, duration: d(60), actionInterval: 3000 },
  { label: 'churn · 15 clients', scenario: 'churn', clients: 15, duration: short ? 45 : 90, actionInterval: 3000 },
  { label: 'chat · 15 clients', scenario: 'chat', clients: 15, duration: d(60), actionInterval: 3000 },
];

const rows = [];
for (const run of RUNS) {
  const out = `results/${stamp}-${run.scenario}-${run.clients}c${run.fineRates ? '-fine' : ''}.json`;
  try {
    const r = await runLoadTest({ url, fineRates: false, ...run, out });
    rows.push({ ...run, out, ok: true, latency: r.latency, drift: r.drift, correctness: r.correctness, verdict: r.verdict, scenarioResult: r.scenario });
  } catch (err) {
    console.error(`✖ ${run.label}: ${err.message}`);
    rows.push({ ...run, ok: false, error: err.message });
  }
  await new Promise((r) => setTimeout(r, 1500));
}

const pf = (b) => (b ? 'PASS' : 'FAIL');
console.log('\n================ SUMMARY ================');
console.log('run'.padEnd(34) + 'lat p50'.padEnd(10) + 'lat p95'.padEnd(10) + 'lat max'.padEnd(10) + 'drift p95'.padEnd(11) + 'drift max'.padEnd(11) + 'correct'.padEnd(9) + 'verdict');
for (const r of rows) {
  if (!r.ok) {
    console.log(r.label.padEnd(34) + `ERROR ${r.error}`);
    continue;
  }
  const all = Object.values(r.verdict).every((v) => v.pass);
  console.log(
    r.label.padEnd(34) +
      `${r.latency.p50}`.padEnd(10) +
      `${r.latency.p95}`.padEnd(10) +
      `${r.latency.max}`.padEnd(10) +
      `${r.drift.p95}`.padEnd(11) +
      `${r.drift.max}`.padEnd(11) +
      pf(r.verdict.correctness.pass).padEnd(9) +
      pf(all),
  );
}
const summaryPath = `results/${stamp}-summary.json`;
writeFileSync(summaryPath, JSON.stringify(rows, null, 2));
console.log(`\nSummary saved to ${summaryPath} (all values in ms)`);
process.exit(rows.every((r) => r.ok && Object.values(r.verdict).every((v) => v.pass)) ? 0 : 1);
