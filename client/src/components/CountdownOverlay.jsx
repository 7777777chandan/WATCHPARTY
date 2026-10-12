import { useEffect, useState } from 'react';
import { serverNow } from '../utils/clock.js';

/**
 * Feature F: a countdown everyone sees in lockstep. Each client renders
 * ceil((startAt - serverNow()) / 1000) from the same server timestamp, so the numbers flip at
 * the same instant on every device (to within the clock-sync error), and playback starts at 0.
 */
export default function CountdownOverlay({ countdown, controller, onDone }) {
  const [left, setLeft] = useState(null);

  useEffect(() => {
    if (!countdown) return undefined;
    let raf;
    let fired = false;
    const tick = () => {
      const ms = countdown.startAt - serverNow();
      setLeft(ms);
      if (ms <= 0 && !fired) {
        fired = true;
        // Start immediately on our own clock instead of waiting for the server broadcast.
        const st = controller.serverState;
        if (st) {
          controller.applyState(
            { ...st, playing: true, position: countdown.position, updatedAt: countdown.startAt, seq: controller.lastSeq },
            { force: true },
          );
        }
      }
      if (ms > -900) raf = requestAnimationFrame(tick);
      else onDone?.();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [countdown, controller, onDone]);

  if (!countdown || left === null || left < -900 || left > countdown.seconds * 1000 + 2000) return null;
  const n = Math.ceil(left / 1000);
  return (
    <div className="countdown-overlay" role="timer" aria-live="assertive">
      <span key={n} className="countdown-number">{n > 0 ? n : 'Go!'}</span>
      {n > 0 && <span className="countdown-label">Starting together…</span>}
    </div>
  );
}
