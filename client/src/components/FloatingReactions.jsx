import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { reactionBus } from './reactionBus.js';

const MAX_FLOATING = 40;
const LIFETIME_MS = 2500;

/** Emojis floating up over the player. Each node is removed after its animation ends. */
export default function FloatingReactions() {
  const { socket } = useSocket();
  const [items, setItems] = useState([]);
  const timers = useRef(new Set());

  useEffect(() => {
    const add = (r, faint = false) => {
      const id = `${r.id || Math.random()}-${faint ? 'f' : 'l'}-${Math.random().toString(36).slice(2, 6)}`;
      const item = { id, emoji: r.emoji, name: faint ? null : r.name, left: 8 + Math.random() * 80, faint };
      setItems((list) => [...list, item].slice(-MAX_FLOATING));
      const t = setTimeout(() => {
        timers.current.delete(t);
        setItems((list) => list.filter((x) => x.id !== id));
      }, LIFETIME_MS);
      timers.current.add(t);
    };
    const onLive = (r) => add(r);
    socket.on('reaction:show', onLive);
    const offBus = reactionBus.on((r) => add(r, true));
    const pending = timers.current;
    return () => {
      socket.off('reaction:show', onLive);
      offBus();
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, [socket]);

  return (
    <div className="floating-layer" aria-hidden="true">
      {items.map((r) => (
        <span key={r.id} className={`floating ${r.faint ? 'faint' : ''}`} style={{ left: `${r.left}%` }}>
          {r.emoji}
          {r.name && <small>{r.name}</small>}
        </span>
      ))}
    </div>
  );
}
