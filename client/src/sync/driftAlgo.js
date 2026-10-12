import { SYNC } from './syncConfig.js';

/** Moving average over the last N raw drift samples. */
export function smooth(samples, value, n = SYNC.DRIFT_SAMPLES) {
  samples.push(value);
  while (samples.length > n) samples.shift();
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/**
 * Does the player support rates close to 1 (e.g. 1.05)? The classic YouTube list is
 * [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; setPlaybackRate(1.05) would be rounded to 1,
 * so soft correction would do nothing. Newer players expose finer steps.
 */
export function hasFineRates(rates) {
  return Array.isArray(rates) && rates.some((r) => r !== 1 && Math.abs(r - 1) <= 0.1);
}

/** Closest available rate to the wanted one (or the wanted one if the list is unknown). */
export function pickRate(wanted, rates) {
  if (!Array.isArray(rates) || !rates.length) return wanted;
  return rates.reduce((best, r) => (Math.abs(r - wanted) < Math.abs(best - wanted) ? r : best), rates[0]);
}

/**
 * Decides the correction for a smoothed drift (positive = ahead of the room).
 * Returns { action: 'none'|'restore'|'soft'|'hard', rate? }.
 *
 *  |drift| < 0.15 s          -> none (restore rate 1 if a soft correction was running)
 *  0.15 <= |drift| < 0.5 s   -> soft: 1.05x when behind, 0.95x when ahead, until |drift| < 0.1
 *  |drift| >= 0.5 s          -> hard seek to the expected position (see DRIFT_HARD for why 0.5)
 * Without fine-grained rates, soft correction is impossible (1.05 rounds to 1, and 1.25 would
 * be clearly audible), so we tolerate drift up to 0.4 s (still under the 500 ms target) and
 * hard seek above that.
 */
export function decideCorrection({ drift, currentRate = 1, fineRates = true, inCooldown = false }) {
  const abs = Math.abs(drift);
  const softActive = currentRate !== 1;

  if (abs >= SYNC.DRIFT_HARD || (!fineRates && abs >= SYNC.DRIFT_HARD_NO_FINE_RATES)) {
    return inCooldown ? { action: 'none', reason: 'cooldown' } : { action: 'hard' };
  }
  if (softActive && abs < SYNC.DRIFT_RESTORE) return { action: 'restore', rate: 1 };
  if (abs < SYNC.DRIFT_OK) return softActive ? { action: 'none', reason: 'converging' } : { action: 'none' };
  if (!fineRates) return softActive ? { action: 'restore', rate: 1 } : { action: 'none', reason: 'tolerated' };
  const rate = drift < 0 ? 1 + SYNC.SOFT_RATE_DELTA : 1 - SYNC.SOFT_RATE_DELTA;
  return { action: 'soft', rate };
}
