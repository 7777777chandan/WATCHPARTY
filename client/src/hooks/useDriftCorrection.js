import { useEffect, useRef, useSyncExternalStore } from 'react';
import { SYNC } from '../sync/syncConfig.js';
import { decideCorrection, hasFineRates, pickRate, smooth } from '../sync/driftAlgo.js';
import { driftLog } from '../sync/driftLog.js';
import { driftStore } from '../sync/driftStore.js';
import { YTS } from '../sync/playerController.js';
import { clientNow, clockState } from '../utils/clock.js';

/**
 * Automatic drift detection and correction, every DRIFT_INTERVAL_MS while playing:
 *   expected = position + (serverNow - updatedAt) / 1000
 *   drift    = player.getCurrentTime() - expected       (positive = ahead of the room)
 * Smoothed over 3 samples, then decideCorrection() picks none / soft (rate) / hard (seek).
 * Every check is logged to a 500-entry ring buffer (downloadable as JSON evidence).
 */
export function useDriftCorrection({ controller, socket, enabled, onSuggestCatchUp }) {
  const suggestRef = useRef(onSuggestCatchUp);
  useEffect(() => {
    suggestRef.current = onSuggestCatchUp;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const samples = [];
    let activeRate = 1;
    let lastHardAt = -Infinity;
    let corrections = 0;
    let consecutiveFails = 0;
    let seekLead = 0; // learned seek latency (s): where to aim so we land on time
    let measureLead = false;

    const record = (entry) => {
      driftLog.push({ t: Date.now(), ...entry });
      driftStore.set({ ...entry, corrections, consecutiveFails, rate: activeRate });
    };

    const resetRate = () => {
      if (activeRate !== 1) controller.setRate(1);
      activeRate = 1;
    };

    const tick = () => {
      const st = controller.serverState;
      if (!controller.ready || !st?.videoId) return record({ state: 'idle', action: 'none', drift: 0, raw: 0 });
      const ys = controller.playerState();
      if (!st.playing) {
        samples.length = 0;
        resetRate();
        return record({ state: 'paused', action: 'none', drift: 0, raw: 0 });
      }
      const now = clientNow();
      const recentlyMoved = now - controller.lastSeekOrPlayAt < SYNC.DRIFT_GRACE_AFTER_SEEK_MS;
      if (ys !== YTS.PLAYING || recentlyMoved) {
        // Buffering, unstarted, cued, ended, or blocked by autoplay: don't fight it.
        return record({ state: ys === YTS.BUFFERING || recentlyMoved ? 'buffering' : 'idle', action: 'skip', drift: driftStore.get().drift, raw: null });
      }
      // The user may have picked another speed in the YouTube menu; sync needs our rate.
      if (Math.abs(controller.rate() - activeRate) > 0.001) controller.setRate(activeRate);

      const raw = controller.currentTime() - controller.expected();
      if (measureLead) {
        // First clean sample after a hard seek: a negative residual means the seek cost time.
        measureLead = false;
        seekLead = Math.min(SYNC.SEEK_LEAD_MAX, Math.max(0, seekLead - raw * 0.5));
      }
      const drift = smooth(samples, raw);
      const rates = controller.availableRates();
      const fineRates = hasFineRates(rates);
      const inCooldown = now - lastHardAt < SYNC.HARD_SEEK_COOLDOWN_MS;
      const decision = decideCorrection({ drift, currentRate: activeRate, fineRates, inCooldown });

      let state = Math.abs(drift) < SYNC.DRIFT_OK ? 'synced' : activeRate !== 1 ? 'soft' : 'drifting';
      if (decision.action === 'soft') {
        const rate = pickRate(decision.rate, rates);
        if (rate !== activeRate) {
          controller.setRate(rate);
          activeRate = rate;
          corrections += 1;
        }
        state = 'soft';
      } else if (decision.action === 'restore') {
        resetRate();
        state = 'synced';
      } else if (decision.action === 'hard') {
        resetRate();
        controller.hardSeekToExpected(seekLead);
        measureLead = true;
        lastHardAt = now;
        samples.length = 0;
        corrections += 1;
        consecutiveFails += 1;
        state = 'hard';
        if (consecutiveFails >= SYNC.CATCHUP_SUGGEST_AFTER) {
          suggestRef.current?.();
          consecutiveFails = 0;
        }
      }
      if (Math.abs(drift) < SYNC.DRIFT_OK) consecutiveFails = 0;
      record({ state, action: decision.action, drift, raw, fineRates, seekLead: Math.round(seekLead * 1000) });
    };

    const report = () => {
      if (!socket.connected) return;
      const s = driftStore.get();
      socket.emit('drift:report', {
        drift: Math.round((s.drift || 0) * 1000),
        corrections,
        rtt: clockState.rtt === null ? undefined : Math.round(clockState.rtt),
        state: s.state,
      });
    };

    const tickTimer = setInterval(tick, SYNC.DRIFT_INTERVAL_MS);
    const reportTimer = setInterval(report, SYNC.DRIFT_REPORT_MS);
    return () => {
      clearInterval(tickTimer);
      clearInterval(reportTimer);
      resetRate();
    };
  }, [controller, socket, enabled]);
}

export function useDriftStats() {
  return useSyncExternalStore(driftStore.subscribe, driftStore.get);
}
