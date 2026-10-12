import { useSyncExternalStore } from 'react';

/** "Click to join playback": shown when the browser blocked autoplay. */
export function AutoplayOverlay({ controller }) {
  const blocked = useSyncExternalStore(
    (fn) => controller.subscribe(fn),
    () => controller.autoplayBlocked,
  );
  if (!blocked) return null;
  return (
    <div className="player-overlay">
      <button type="button" className="btn btn-primary btn-large" onClick={() => controller.joinPlaybackFromGesture()}>
        ▶ Click to join playback
      </button>
      <p className="muted small">Your browser blocked autoplay. One click and you are in sync.</p>
    </div>
  );
}

/** Host-only mode: a transparent shield so guests can't click the iframe controls. */
export function HostOnlyShield({ active }) {
  if (!active) return null;
  return (
    <div className="host-shield" title="Host-only mode: only the host can control playback">
      <span className="host-shield-badge">🔒 Only the host controls playback</span>
    </div>
  );
}

export function NoVideo({ isHost }) {
  return (
    <div className="player-message">
      <span className="big-emoji" aria-hidden="true">🍿</span>
      <strong>No video yet</strong>
      <span className="muted">
        {isHost ? 'Paste a YouTube link below, or add something to the playlist.' : 'Waiting for the host to pick something.'}
      </span>
    </div>
  );
}
