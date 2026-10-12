import { describe, expect, it } from 'vitest';
import { computeSample, nextOffset, selectOffset } from '../utils/clockSync.js';

/** Simulates one ping with a true offset and the given uplink/downlink delays (ms). */
function ping(trueOffset, clientSendAt, up, down) {
  const t0 = clientSendAt;
  const ts = clientSendAt + up + trueOffset; // server clock when the request arrives
  const t1 = clientSendAt + up + down; // client clock when the reply arrives
  return computeSample(t0, t1, ts);
}

describe('computeSample', () => {
  it('is exact for symmetric latency', () => {
    const s = ping(250, 1000, 20, 20);
    expect(s.rtt).toBe(40);
    expect(s.offset).toBe(250);
  });

  it('errs by (up - down) / 2 for asymmetric latency', () => {
    const s = ping(-500, 1000, 80, 20);
    expect(s.rtt).toBe(100);
    expect(s.offset).toBe(-500 + (80 - 20) / 2);
  });
});

describe('selectOffset', () => {
  it('ignores slow, asymmetric outliers and stays within a few ms of the truth', () => {
    const trueOffset = 1234;
    const legs = [
      [10, 12], [11, 10], [9, 13], [12, 11], // good, nearly symmetric
      [300, 10], [10, 250], [150, 20], [40, 200], // queued / asymmetric
    ];
    const samples = legs.map(([up, down], i) => ping(trueOffset, i * 100, up, down));
    const best = selectOffset(samples);
    expect(Math.abs(best.offset - trueOffset)).toBeLessThanOrEqual(2);
    expect(best.rtt).toBe(21);
  });

  it('is robust to a single fast but very asymmetric sample', () => {
    const trueOffset = 0;
    // 8 rounds (as in the client): one fast but asymmetric sample (8 ms RTT, 3 ms off) plus normal ones.
    const legs = [[1, 7], [5, 5], [6, 5], [5, 6], [6, 6], [7, 6], [9, 9], [20, 30]];
    const samples = legs.map(([up, down], i) => ping(0, i, up, down));
    // The lowest-RTT sample does not win on its own: the median of the best half does.
    expect(Math.abs(selectOffset(samples).offset - trueOffset)).toBeLessThan(1);
  });

  it('returns null without valid samples', () => {
    expect(selectOffset([])).toBeNull();
    expect(selectOffset([{ rtt: NaN, offset: 1 }])).toBeNull();
  });
});

describe('nextOffset smoothing', () => {
  it('keeps the old offset for changes under 20 ms', () => {
    expect(nextOffset(100, 115)).toBe(100);
    expect(nextOffset(100, 130)).toBe(130);
    expect(nextOffset(null, 42)).toBe(42);
  });
});
