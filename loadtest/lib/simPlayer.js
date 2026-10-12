/**
 * Simulated video player for a bot. Its position advances in real time with random jitter
 * (each second it gains or loses 20-80 ms) and occasional stalls (a 500-1500 ms freeze), like a
 * real player hit by decode hiccups and buffering. The bot applies the same drift-correction
 * decisions as the browser client (imported from client/src/sync/driftAlgo.js).
 */
import { performance } from 'node:perf_hooks';

export class SimPlayer {
  constructor({ jitter = true, stalls = true, stallChancePerSec = 0.03, fineRates = false } = {}) {
    this.jitter = jitter;
    this.stalls = stalls;
    this.stallChance = stallChancePerSec;
    this.rates = fineRates ? [0.9, 0.95, 1, 1.05, 1.1, 1.25, 1.5, 2] : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    this.playing = false;
    this.pos = 0;
    this.anchor = performance.now();
    this.rate = 1;
    this.stalledUntil = 0;
    this.stallCount = 0;
    this.lastJitterAt = performance.now();
  }

  now() {
    return performance.now();
  }

  time() {
    if (!this.playing) return this.pos;
    const t = this.now();
    const start = Math.max(this.anchor, this.stalledUntil);
    if (t <= start) return this.pos;
    return this.pos + ((t - start) / 1000) * this.rate;
  }

  freeze() {
    this.pos = this.time();
    this.anchor = this.now();
  }

  isStalled() {
    return this.now() < this.stalledUntil;
  }

  seek(sec) {
    this.pos = Math.max(0, sec);
    this.anchor = this.now();
  }

  play() {
    if (this.playing) return;
    this.freeze();
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.freeze();
    this.playing = false;
  }

  setRate(r) {
    this.freeze();
    this.rate = this.rates.includes(r) ? r : 1;
  }

  /** Called every second: apply jitter and maybe start a stall. */
  perturb() {
    if (!this.playing) return;
    if (this.jitter) {
      const mag = 0.02 + Math.random() * 0.06;
      this.freeze();
      this.pos = Math.max(0, this.pos + (Math.random() < 0.5 ? -mag : mag));
    }
    if (this.stalls && !this.isStalled() && Math.random() < this.stallChance) {
      this.freeze();
      this.stalledUntil = this.now() + 500 + Math.random() * 1000;
      this.stallCount += 1;
    }
  }
}
