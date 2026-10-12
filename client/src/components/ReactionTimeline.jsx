import { useEffect, useMemo, useRef, useState } from 'react';
import { reactionBus } from './reactionBus.js';
import { formatTime } from '../utils/youtube.js';

const BUCKET = 5;

/**
 * Feature A: every reaction is stored with its video time. We cluster them in 5 s buckets and
 * draw markers on a timeline; when playback crosses a bucket, its reactions replay faintly so
 * latecomers (or a rewatch) feel the crowd.
 */
export default function ReactionTimeline({ reactions, playback, controller, canSeek, onSeek }) {
  const [now, setNow] = useState({ t: 0, d: 0 });
  const lastTimeRef = useRef(null);
  const videoId = playback?.videoId;

  const buckets = useMemo(() => {
    const map = new Map();
    for (const r of reactions) {
      if (r.videoId !== videoId) continue;
      const start = Math.floor(r.videoTime / BUCKET) * BUCKET;
      const b = map.get(start) || { start, count: 0, emojis: {} };
      b.count += 1;
      b.emojis[r.emoji] = (b.emojis[r.emoji] || 0) + 1;
      map.set(start, b);
    }
    return [...map.values()].sort((a, b) => a.start - b.start);
  }, [reactions, videoId]);

  const bucketsRef = useRef(buckets);
  useEffect(() => {
    bucketsRef.current = buckets;
  }, [buckets]);

  useEffect(() => {
    lastTimeRef.current = null;
    const timer = setInterval(() => {
      const t = controller.currentTime();
      const d = controller.duration();
      setNow((prev) => (Math.abs(prev.t - t) > 0.2 || prev.d !== d ? { t, d } : prev));
      const last = lastTimeRef.current;
      lastTimeRef.current = t;
      // Replay only when crossing forward during normal playback (not on big seeks).
      if (last === null || t <= last || t - last > 2 || !controller.serverState?.playing) return;
      for (const b of bucketsRef.current) {
        if (b.start > last && b.start <= t) {
          const emojis = Object.entries(b.emojis).flatMap(([e, n]) => Array(Math.min(n, 4)).fill(e));
          emojis.slice(0, 8).forEach((emoji, i) => setTimeout(() => reactionBus.emit({ emoji }), i * 180));
        }
      }
    }, 500);
    return () => clearInterval(timer);
  }, [controller, videoId]);

  if (!videoId) return null;
  const duration = now.d || Math.max(60, ...buckets.map((b) => b.start + BUCKET));
  const pct = (sec) => `${Math.min(100, (sec / duration) * 100)}%`;
  const top = (b) => Object.entries(b.emojis).sort((x, y) => y[1] - x[1])[0][0];

  return (
    <div className="timeline" aria-label="Reaction timeline">
      <div className="timeline-track">
        <div className="timeline-progress" style={{ width: pct(now.t) }} />
        {buckets.map((b) => (
          <button
            key={b.start}
            type="button"
            className="timeline-marker"
            style={{ left: `clamp(12px, ${pct(b.start + BUCKET / 2)}, calc(100% - 12px))` }}
            title={`${formatTime(b.start)}: ${b.count} reaction${b.count > 1 ? 's' : ''}${canSeek ? ' (click to jump)' : ''}`}
            aria-label={`${b.count} reactions at ${formatTime(b.start)}`}
            onClick={() => canSeek && onSeek(b.start)}
            disabled={!canSeek}
          >
            <span>{top(b)}</span>
            {b.count > 1 && <small>{b.count}</small>}
          </button>
        ))}
      </div>
      <div className="timeline-labels muted small">
        <span>{formatTime(now.t)}</span>
        <span>{buckets.length ? `${buckets.reduce((a, b) => a + b.count, 0)} reactions on this video` : 'Reactions will appear on this timeline'}</span>
        <span>{now.d ? formatTime(now.d) : ''}</span>
      </div>
    </div>
  );
}
