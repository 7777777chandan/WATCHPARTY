import { describe, expect, it } from 'vitest';
import { decideCorrection, hasFineRates, pickRate, smooth } from '../sync/driftAlgo.js';
import { expectedPosition } from '../sync/expected.js';
import { createRingBuffer } from '../sync/driftLog.js';

describe('decideCorrection', () => {
  it('does nothing when in sync', () => {
    expect(decideCorrection({ drift: 0.05 }).action).toBe('none');
  });
  it('speeds up when behind and slows down when ahead', () => {
    expect(decideCorrection({ drift: -0.5 })).toEqual({ action: 'soft', rate: 1.05 });
    expect(decideCorrection({ drift: 0.5 })).toEqual({ action: 'soft', rate: 0.95 });
  });
  it('restores rate 1 once under 0.1 s', () => {
    expect(decideCorrection({ drift: 0.08, currentRate: 1.05 })).toEqual({ action: 'restore', rate: 1 });
    expect(decideCorrection({ drift: 0.12, currentRate: 1.05 }).action).toBe('none');
  });
  it('hard seeks at 1.5 s, except during cooldown', () => {
    expect(decideCorrection({ drift: 3 }).action).toBe('hard');
    expect(decideCorrection({ drift: -1.5 }).action).toBe('hard');
    expect(decideCorrection({ drift: 3, inCooldown: true }).action).toBe('none');
  });
  it('without fine rates: tolerate up to 0.4 s, hard seek above', () => {
    expect(decideCorrection({ drift: 0.3, fineRates: false }).action).toBe('none');
    expect(decideCorrection({ drift: 0.5, fineRates: false }).action).toBe('hard');
  });
});

describe('helpers', () => {
  it('smooth averages the last 3', () => {
    const s = [];
    smooth(s, 3);
    smooth(s, 0);
    smooth(s, 0);
    expect(smooth(s, 0)).toBe(0);
    expect(s.length).toBe(3);
  });
  it('detects fine playback rates', () => {
    expect(hasFineRates([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])).toBe(false);
    expect(hasFineRates([0.95, 1, 1.05])).toBe(true);
    expect(pickRate(1.05, [0.95, 1, 1.05, 1.1])).toBe(1.05);
  });
  it('expectedPosition extrapolates only while playing', () => {
    expect(expectedPosition({ playing: true, position: 10, updatedAt: 1000 }, 3500)).toBe(12.5);
    expect(expectedPosition({ playing: false, position: 10, updatedAt: 1000 }, 3500)).toBe(10);
  });
  it('ring buffer keeps the newest entries', () => {
    const rb = createRingBuffer(3);
    [1, 2, 3, 4, 5].forEach((x) => rb.push(x));
    expect(rb.toArray()).toEqual([3, 4, 5]);
  });
});
