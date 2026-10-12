import { SYNC } from './syncConfig.js';
import { decideCorrection, hasFineRates, pickRate, smooth } from './driftAlgo.js';

/**
 * The drift-correction loop, independent of React and of YouTube, so the browser hook and the
 * load-test bots run exactly the same logic. Call tick() every DRIFT_INTERVAL_MS.
 *
 * `player` adapter:
 *   now()                ms, monotonic
 *   active()             a video is loaded and the room is playing
 *   status()             'playing' | 'buffering' | 'other'  (local player state)
 *   lastMoveAt()         ms of the last seek/play (we don't measure while it settles)
 *   currentTime()        seconds
 *   expected()           seconds, where the room is right now
 *   rate() / setRate(r)  playback rate
 *   availableRates()     list of supported rates
 *   hardSeek(lead)       seek to expected() + lead
 *
 *   drift = currentTime - expected   (positive = ahead of the room)
 */
export class DriftCorrector {
  constructor(player) {
    this.player = player;
    this.reset();
    this.corrections = 0;
  }

  reset() {
    this.samples = [];
    this.activeRate = 1;
    this.lastHardAt = -Infinity;
    this.consecutiveFails = 0;
    this.seekLead = 0; // learned seek latency (s): aim ahead so we land on time
    this.measureLead = false;
  }

  restoreRate() {
    if (this.activeRate !== 1) this.player.setRate(1);
    this.activeRate = 1;
  }

  tick() {
    const p = this.player;
    const base = () => ({ corrections: this.corrections, rate: this.activeRate, seekLead: Math.round(this.seekLead * 1000), consecutiveFails: this.consecutiveFails });
    if (!p.active()) {
      this.samples.length = 0;
      this.restoreRate();
      return { ...base(), state: 'paused', action: 'none', drift: 0, raw: null };
    }
    const now = p.now();
    const status = p.status();
    if (status !== 'playing' || now - p.lastMoveAt() < SYNC.DRIFT_GRACE_AFTER_SEEK_MS) {
      // Buffering, blocked, or just seeked: don't fight it.
      return { ...base(), state: status === 'other' ? 'idle' : 'buffering', action: 'skip', drift: null, raw: null };
    }
    // Someone may have picked another speed in the player menu; sync needs our rate.
    if (Math.abs(p.rate() - this.activeRate) > 0.001) p.setRate(this.activeRate);

    const raw = p.currentTime() - p.expected();
    if (this.measureLead) {
      // First clean sample after a hard seek: a negative residual means the seek cost time.
      this.measureLead = false;
      this.seekLead = Math.min(SYNC.SEEK_LEAD_MAX, Math.max(0, this.seekLead - raw * 0.5));
    }
    let drift = smooth(this.samples, raw);
    if (Math.abs(raw) >= SYNC.DRIFT_STEP) {
      // A jump this large (a stall, a missed seek) is a step, not noise: act on it now
      // instead of waiting for the moving average to catch up.
      this.samples.length = 0;
      this.samples.push(raw);
      drift = raw;
    }
    const rates = p.availableRates();
    const fineRates = hasFineRates(rates);
    const inCooldown = now - this.lastHardAt < SYNC.HARD_SEEK_COOLDOWN_MS;
    const decision = decideCorrection({ drift, currentRate: this.activeRate, fineRates, inCooldown });

    let state = Math.abs(drift) < SYNC.DRIFT_OK ? 'synced' : this.activeRate !== 1 ? 'soft' : 'drifting';
    let suggestCatchUp = false;
    if (decision.action === 'soft') {
      const rate = pickRate(decision.rate, rates);
      if (rate !== this.activeRate) {
        p.setRate(rate);
        this.activeRate = rate;
        this.corrections += 1;
      }
      state = 'soft';
    } else if (decision.action === 'restore') {
      this.restoreRate();
      state = 'synced';
    } else if (decision.action === 'hard') {
      this.restoreRate();
      p.hardSeek(this.seekLead);
      this.measureLead = true;
      this.lastHardAt = now;
      this.samples.length = 0;
      this.corrections += 1;
      this.consecutiveFails += 1;
      state = 'hard';
      if (this.consecutiveFails >= SYNC.CATCHUP_SUGGEST_AFTER) {
        suggestCatchUp = true;
        this.consecutiveFails = 0;
      }
    }
    if (Math.abs(drift) < SYNC.DRIFT_OK) this.consecutiveFails = 0;
    return { ...base(), state, action: decision.action, drift, raw, fineRates, suggestCatchUp };
  }
}
