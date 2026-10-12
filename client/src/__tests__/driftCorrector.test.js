import { describe, expect, it } from 'vitest';
import { DriftCorrector } from '../sync/driftCorrector.js';

/** A fake player whose drift we control directly. */
function fakePlayer({ drift = 0, rates = [0.95, 1, 1.05] } = {}) {
  const p = {
    t: 0,
    drift,
    _rate: 1,
    seeks: [],
    now: () => p.t,
    active: () => true,
    status: () => 'playing',
    lastMoveAt: () => -10_000,
    currentTime: () => 100 + p.drift,
    expected: () => 100,
    rate: () => p._rate,
    setRate: (r) => (p._rate = r),
    availableRates: () => rates,
    hardSeek: (lead) => {
      p.seeks.push(lead);
      p.drift = 0;
    },
  };
  return p;
}

const run = (c, p, n) => {
  let last;
  for (let i = 0; i < n; i++) {
    p.t += 1000;
    last = c.tick();
  }
  return last;
};

describe('DriftCorrector', () => {
  it('soft-corrects 0.3 s behind with 1.05x, then restores 1x', () => {
    const p = fakePlayer({ drift: -0.3 });
    const c = new DriftCorrector(p);
    expect(run(c, p, 1).action).toBe('soft');
    expect(p._rate).toBe(1.05);
    p.drift = -0.02;
    run(c, p, 3);
    expect(p._rate).toBe(1);
  });

  it('hard-seeks 3 s off, with a cooldown before the next hard seek', () => {
    const p = fakePlayer({ drift: 3 });
    const c = new DriftCorrector(p);
    expect(run(c, p, 1).action).toBe('hard');
    p.drift = 3;
    expect(run(c, p, 1).action).toBe('none'); // still in the 3 s cooldown
    run(c, p, 2); // cooldown over at t = 4 s
    expect(p.seeks.length).toBe(2);
  });

  it('without fine rates tolerates 0.3 s and hard-seeks 0.6 s', () => {
    const p = fakePlayer({ drift: 0.3, rates: [0.5, 1, 1.5] });
    const c = new DriftCorrector(p);
    expect(run(c, p, 3).action).toBe('none');
    expect(p.seeks.length).toBe(0);
    p.drift = 0.6;
    run(c, p, 3);
    expect(p.seeks.length).toBe(1);
  });

  it('reacts to a 1 s step immediately instead of averaging it away', () => {
    const p = fakePlayer({ drift: 0.02, rates: [0.5, 1, 1.5] });
    const c = new DriftCorrector(p);
    run(c, p, 2);
    p.drift = -1.1; // a stall just ended
    expect(run(c, p, 1).action).toBe('hard');
  });

  it('suggests "catch up" after 3 hard seeks that do not stick', () => {
    const p = fakePlayer({ drift: 5 });
    p.hardSeek = () => {}; // the seek never takes effect
    const c = new DriftCorrector(p);
    let suggested = false;
    for (let i = 0; i < 12 && !suggested; i++) suggested = run(c, p, 1).suggestCatchUp;
    expect(suggested).toBe(true);
  });

  it('learns a seek lead when seeks land late', () => {
    const p = fakePlayer({ drift: 2 });
    p.hardSeek = (lead) => {
      p.seeks.push(lead);
      p.drift = -0.2 + lead; // the player resumes 200 ms late
    };
    const c = new DriftCorrector(p);
    run(c, p, 1);
    run(c, p, 1); // measures the -0.2 residual
    expect(c.seekLead).toBeCloseTo(0.1, 5);
  });
});
