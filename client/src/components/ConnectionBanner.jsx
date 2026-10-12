import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

/** "Reconnecting…" while the socket is down, "Back online" briefly after it returns. */
export default function ConnectionBanner() {
  const { connected, everConnected } = useSocket();
  const [backOnline, setBackOnline] = useState(false);
  const wasDown = useRef(false);

  useEffect(() => {
    if (!connected && everConnected) wasDown.current = true;
    if (connected && wasDown.current) {
      wasDown.current = false;
      setBackOnline(true);
      const t = setTimeout(() => setBackOnline(false), 2500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [connected, everConnected]);

  if (!everConnected && !connected) {
    return <div className="banner banner-warn" role="status"><span className="spinner" aria-hidden="true" /> Connecting to the server…</div>;
  }
  if (!connected) {
    return <div className="banner banner-warn" role="status"><span className="spinner" aria-hidden="true" /> Reconnecting…</div>;
  }
  if (backOnline) return <div className="banner banner-ok" role="status">✓ Back online</div>;
  return null;
}
