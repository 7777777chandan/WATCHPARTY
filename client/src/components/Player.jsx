import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi } from '../utils/loadYouTubeApi.js';

const ERROR_TEXT = {
  2: 'This video id is invalid.',
  5: 'This video cannot be played in an HTML5 player.',
  100: 'This video was removed or is private.',
  101: 'The owner does not allow this video to be embedded.',
  150: 'The owner does not allow this video to be embedded.',
};

/**
 * Creates the YouTube IFrame player and hands it to the PlayerController, which does all the
 * syncing. The iframe's own controls stay visible; every action on them goes through the
 * controller's detection + sync path.
 */
export default function Player({ controller, onVideoError }) {
  const hostRef = useRef(null);
  const [loadError, setLoadError] = useState(null);
  const errorRef = useRef(onVideoError);
  useEffect(() => {
    errorRef.current = onVideoError;
  });

  useEffect(() => {
    let cancelled = false;
    let player = null;
    // YT.Player replaces its target element; give it a node React doesn't manage.
    const mount = document.createElement('div');
    hostRef.current.appendChild(mount);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: () => !cancelled && controller.attach(player),
            onStateChange: (e) => controller.onStateChange(e.data),
            onError: (e) => errorRef.current?.(ERROR_TEXT[e.data] || `The video could not be played (error ${e.data}).`),
          },
        });
      })
      .catch((err) => !cancelled && setLoadError(err.message));

    return () => {
      cancelled = true;
      controller.detach();
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
      mount.remove();
    };
  }, [controller]);

  return (
    <div className="player-frame" ref={hostRef}>
      {loadError && (
        <div className="player-message" role="alert">
          <strong>Player unavailable</strong>
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
}
