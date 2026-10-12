/**
 * NTP-style clock offset estimation (pure functions, unit tested).
 *
 * For one ping: client sends at t0, server stamps ts, client receives at t1 (client clock).
 *   rtt    = t1 - t0
 *   offset = ts - (t0 + rtt / 2)      // server clock minus client clock
 * This assumes the request and response legs take equal time. When they don't (asymmetric
 * latency) the error is at most rtt / 2, so low-RTT samples are the most trustworthy.
 *
 * Selection: drop the worst 25% of samples by RTT, then take the MEDIAN offset of the best
 * half. We chose the median of the best half over the single lowest-RTT sample because one
 * "lucky" fast sample can still be badly asymmetric; the median of several good samples is
 * robust to one outlier while still ignoring slow (queued/retransmitted) pings.
 */
export function computeSample(t0, t1, ts) {
  const rtt = t1 - t0;
  return { rtt, offset: ts - (t0 + rtt / 2) };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function selectOffset(samples) {
  const valid = samples.filter((s) => Number.isFinite(s.rtt) && s.rtt >= 0 && Number.isFinite(s.offset));
  if (!valid.length) return null;
  const byRtt = [...valid].sort((a, b) => a.rtt - b.rtt);
  const kept = byRtt.slice(0, Math.max(1, Math.ceil(byRtt.length * 0.75))); // drop worst 25%
  const bestHalf = kept.slice(0, Math.max(1, Math.ceil(kept.length / 2)));
  return {
    offset: median(bestHalf.map((s) => s.offset)),
    rtt: byRtt[0].rtt,
    medianRtt: median(kept.map((s) => s.rtt)),
    samples: valid.length,
  };
}

/** Smoothing: ignore offset changes below `minChangeMs` to avoid jitter in corrections. */
export function nextOffset(previous, candidate, minChangeMs = 20) {
  if (previous === null || previous === undefined) return candidate;
  return Math.abs(candidate - previous) < minChangeMs ? previous : candidate;
}
