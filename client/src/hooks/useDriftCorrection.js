import { useEffect, useRef, useSyncExternalStore } from 'react';
import { SYNC } from '../sync/syncConfig.js';
import { DriftCorrector } from '../sync/driftCorrector.js';
import { driftLog } from '../sync/driftLog.js';
import { driftStore } from '../sync/driftStore.js';
import { YTS } from '../sync/playerController.js';
import { clientNow, clockState } from '../utils/clock.js';

/** Adapts the YouTube PlayerController to the DriftCorrector interface. */
function youtubeAdapter(controller) {
  return {
    now: clientNow,
    active: () => controller.ready && Boolean(controller.serverState?.videoId) && controller.serverState.playing,
    status: () => {
      const ys = controller.playerState();
      return ys === YTS.PLAYING ? 'playing' : ys === YTS.BUFFERING ? 'buffering' : 'other';
    },
    lastMoveAt: () => controller.lastSeekOrPlayAt,
    currentTime: () => controller.currentTime(),
    expected: () => controller.expected(),
    rate: () => controller.rate(),
    setRate: (r) => controller.setRate(r),
    availableRates: () => controller.availableRates(),
    hardSeek: (lead) => controller.hardSeekToExpected(lead),
  };
}

/**
 * Automatic drift detection and correction, every DRIFT_INTERVAL_MS while playing
 * (algorithm in sync/driftCorrector.js). Every check is logged to a 500-entry ring buffer
 * (downloadable as JSON) and the smoothed drift is reported to the server every 5 s.
 */
export function useDriftCorrection({ controller, socket, enabled, onSuggestCatchUp }) {
  const suggestRef = useRef(onSuggestCatchUp);
  useEffect(() => {
    suggestRef.current = onSuggestCatchUp;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const corrector = new DriftCorrector(youtubeAdapter(controller));

    const tick = () => {
      const entry = corrector.tick();
      driftLog.push({ t: Date.now(), ...entry });
      const prev = driftStore.get();
      driftStore.set({ ...entry, drift: entry.drift ?? (entry.action === 'skip' ? prev.drift : 0) });
      if (entry.suggestCatchUp) suggestRef.current?.();
    };

    const report = () => {
      if (!socket.connected) return;
      const s = driftStore.get();
      socket.emit('drift:report', {
        drift: Math.round((s.drift || 0) * 1000),
        corrections: corrector.corrections,
        rtt: clockState.rtt === null ? undefined : Math.round(clockState.rtt),
        state: s.state,
      });
    };

    const tickTimer = setInterval(tick, SYNC.DRIFT_INTERVAL_MS);
    const reportTimer = setInterval(report, SYNC.DRIFT_REPORT_MS);
    return () => {
      clearInterval(tickTimer);
      clearInterval(reportTimer);
      corrector.restoreRate();
    };
  }, [controller, socket, enabled]);
}

export function useDriftStats() {
  return useSyncExternalStore(driftStore.subscribe, driftStore.get);
}
