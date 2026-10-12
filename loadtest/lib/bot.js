/**
 * One simulated participant: a socket.io-client connection, the same clock-sync estimator and
 * the same drift corrector as the browser client (imported from /client), and a SimPlayer.
 */
import { io } from 'socket.io-client';
import { performance } from 'node:perf_hooks';
import { computeSample, selectOffset } from '../../client/src/utils/clockSync.js';
import { DriftCorrector } from '../../client/src/sync/driftCorrector.js';
import { SYNC } from '../../client/src/sync/syncConfig.js';
import { SimPlayer } from './simPlayer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clientNow = () => performance.timeOrigin + performance.now();
let counter = 0;

export class Bot {
  constructor({ url, name, sim = {} }) {
    this.url = url;
    this.name = name;
    this.userId = `bot_${process.pid}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
    this.offset = 0;
    this.rtt = null;
    this.sim = new SimPlayer(sim);
    this.state = null;
    this.lastSeq = -1;
    this.lastMoveAt = 0;
    this.latencies = []; // { ms, by, seq }
    this.serverToClient = [];
    this.drift = []; // { t, drift (ms), action }
    this.seqGaps = 0;
    this.outOfOrder = 0;
    this.duplicates = 0;
    this.chatLatencies = [];
    this.chatReceived = 0;
    this.reactionsReceived = 0;
    this.errors = [];
    this.timers = [];
    this.corrector = new DriftCorrector({
      now: () => performance.now(),
      active: () => Boolean(this.state?.videoId && this.state.playing),
      status: () => (this.sim.isStalled() ? 'buffering' : this.sim.playing ? 'playing' : 'other'),
      lastMoveAt: () => this.lastMoveAt,
      currentTime: () => this.sim.time(),
      expected: () => this.expected(),
      rate: () => this.sim.rate,
      setRate: (r) => this.sim.setRate(r),
      availableRates: () => this.sim.rates,
      hardSeek: (lead) => this.seekSim(this.expected() + lead),
    });
  }

  serverNow() {
    return clientNow() + this.offset;
  }

  expected(now = this.serverNow()) {
    const st = this.state;
    if (!st) return 0;
    return st.playing ? st.position + Math.max(0, now - st.updatedAt) / 1000 : st.position;
  }

  /** A real player needs a moment to resume after a seek: model 40-120 ms of buffering. */
  seekSim(sec) {
    this.sim.seek(sec);
    this.sim.stalledUntil = Math.max(this.sim.stalledUntil, performance.now() + 40 + Math.random() * 80);
    this.lastMoveAt = performance.now();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.url, { transports: ['websocket'], reconnection: false, forceNew: true });
      const fail = (err) => reject(new Error(`${this.name}: ${err.message}`));
      this.socket.once('connect_error', fail);
      this.socket.once('connect', () => {
        this.socket.off('connect_error', fail);
        this.attachListeners();
        resolve();
      });
    });
  }

  emit(event, payload, timeoutMs = 5000) {
    return new Promise((resolve) => {
      this.socket.timeout(timeoutMs).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res));
    });
  }

  /** Same estimator as the browser: 8 pings 100 ms apart, median offset of the best half. */
  async syncClock(rounds = SYNC.CLOCK_ROUNDS) {
    const samples = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = clientNow();
      const res = await this.emit('time:ping', { t0 }, 2000);
      const t1 = clientNow();
      if (res && typeof res.ts === 'number') samples.push(computeSample(t0, t1, res.ts));
      if (i < rounds - 1) await sleep(SYNC.CLOCK_SPACING_MS);
    }
    const best = selectOffset(samples);
    if (best) {
      this.offset = best.offset;
      this.rtt = best.rtt;
    }
    return best;
  }

  attachListeners() {
    const s = this.socket;
    s.on('playback:state', (st) => this.onState(st));
    s.on('chat:message', (m) => {
      if (m.type !== 'user') return;
      this.chatReceived += 1;
      const match = /^lt:(\d+(?:\.\d+)?)/.exec(m.text);
      if (match) this.chatLatencies.push(this.serverNow() - Number(match[1]));
    });
    s.on('reaction:show', () => {
      this.reactionsReceived += 1;
    });
    s.on('action:error', (e) => this.errors.push(e));
  }

  onState(st) {
    const now = this.serverNow();
    if (!st.snapshot) {
      if (st.seq <= this.lastSeq) {
        if (st.seq === this.lastSeq) this.duplicates += 1;
        else this.outOfOrder += 1;
        return;
      }
      if (this.lastSeq >= 0 && st.seq > this.lastSeq + 1) this.seqGaps += st.seq - this.lastSeq - 1;
    }
    if (typeof st.sentAt === 'number') this.latencies.push({ ms: now - st.sentAt, by: st.by, seq: st.seq });
    if (typeof st.serverTime === 'number') this.serverToClient.push(now - st.serverTime);
    this.state = st;
    this.lastSeq = st.seq;
    // Apply exactly like the browser: exact when paused, 0.3 s tolerance when playing.
    const expected = this.expected(now);
    const threshold = st.playing ? SYNC.APPLY_SEEK_THRESHOLD : SYNC.PAUSED_SEEK_THRESHOLD;
    if (Math.abs(this.sim.time() - expected) > threshold) this.seekSim(expected);
    if (st.playing && !this.sim.playing) {
      this.sim.play();
      this.lastMoveAt = performance.now();
    } else if (!st.playing && this.sim.playing) {
      this.sim.pause();
      if (Math.abs(this.sim.time() - expected) > SYNC.PAUSED_SEEK_THRESHOLD) this.seekSim(expected);
    }
  }

  async create() {
    const res = await this.emit('room:create', { name: this.name, userId: this.userId });
    if (!res?.ok) throw new Error(`create failed: ${res?.error}`);
    this.code = res.code;
    this.onState({ ...res.room.playback, snapshot: true });
    return res;
  }

  async join(code) {
    const t0 = performance.now();
    const res = await this.emit('room:join', { code, name: this.name, userId: this.userId });
    const ms = performance.now() - t0;
    if (!res?.ok) throw new Error(`${this.name} join failed: ${res?.error}`);
    this.code = code;
    this.onState({ ...res.room.playback, snapshot: true });
    return { res, ms };
  }

  /** Sends a playback action stamped with sentAt (server clock) for latency measurement. */
  action(type, position = this.sim.time()) {
    return this.emit('playback:action', { type, position: Math.max(0, Math.round(position * 1000) / 1000), clientSeq: this.lastSeq, sentAt: this.serverNow() });
  }

  startLoops({ recordDrift = true } = {}) {
    this.timers.push(
      setInterval(() => {
        this.sim.perturb();
        const entry = this.corrector.tick();
        if (recordDrift && entry.raw !== null && entry.raw !== undefined) {
          // `triggered`: this sample detected a disturbance and caused a hard seek, so it is a
          // measurement from before the correction, not after it.
          this.drift.push({ t: Date.now(), drift: entry.raw * 1000, action: entry.action, triggered: entry.action === 'hard' });
        }
      }, SYNC.DRIFT_INTERVAL_MS),
    );
  }

  stopLoops() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  disconnect() {
    this.stopLoops();
    this.socket?.disconnect();
  }
}
