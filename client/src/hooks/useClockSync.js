import { useEffect, useSyncExternalStore } from 'react';
import { computeSample, nextOffset, selectOffset } from '../utils/clockSync.js';
import { clientNow, clockState } from '../utils/clock.js';
import { SYNC } from '../sync/syncConfig.js';

const listeners = new Set();
let snapshot = { ...clockState };
let inFlight = null;

function publish() {
  snapshot = { ...clockState };
  for (const fn of listeners) fn();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pingOnce(socket, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const t0 = clientNow();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.emit('time:ping', { t0 }, (res) => {
      clearTimeout(timer);
      const t1 = clientNow();
      if (!res || typeof res.ts !== 'number') return resolve(null);
      resolve(computeSample(t0, t1, res.ts));
    });
  });
}

/**
 * Runs CLOCK_ROUNDS pings spaced CLOCK_SPACING_MS apart and updates the shared offset.
 * Concurrent callers share the same in-flight run (e.g. the room join waits on it).
 */
export function syncClock(socket) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const samples = [];
    for (let i = 0; i < SYNC.CLOCK_ROUNDS && socket.connected; i++) {
      const s = await pingOnce(socket);
      if (s) samples.push(s);
      if (i < SYNC.CLOCK_ROUNDS - 1) await sleep(SYNC.CLOCK_SPACING_MS);
    }
    const best = selectOffset(samples);
    if (best) {
      clockState.offset = clockState.synced ? nextOffset(clockState.offset, best.offset, SYNC.CLOCK_MIN_CHANGE_MS) : best.offset;
      clockState.rtt = best.rtt;
      clockState.medianRtt = best.medianRtt;
      clockState.lastSync = Date.now();
      clockState.synced = true;
      publish();
    }
    return best;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Keeps the clock synced: on every (re)connect and every CLOCK_RESYNC_MS. */
export function useClockSyncService(socket) {
  useEffect(() => {
    const onConnect = () => syncClock(socket);
    socket.on('connect', onConnect);
    if (socket.connected) syncClock(socket);
    const timer = setInterval(() => socket.connected && syncClock(socket), SYNC.CLOCK_RESYNC_MS);
    return () => {
      socket.off('connect', onConnect);
      clearInterval(timer);
    };
  }, [socket]);
}

/** Read-only view of the current clock estimate (offset, best RTT, last sync) for the UI. */
export function useClockSync() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
