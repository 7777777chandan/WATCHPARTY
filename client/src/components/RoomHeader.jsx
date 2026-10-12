import { useState } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';
import { copyText } from '../utils/clipboard.js';

export default function RoomHeader({ code, online, onLeave, onShortcuts }) {
  const [copied, setCopied] = useState(null);
  const inviteUrl = `${window.location.origin}/room/${code}`;
  const copy = async () => {
    const ok = await copyText(inviteUrl);
    setCopied(ok ? 'Copied!' : 'Copy failed: select the link');
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <header className="room-header">
      <Link to="/" className="brand" onClick={onLeave} aria-label="Watch Party home (leaves the room)">🍿 <span>Watch Party</span></Link>
      <div className="room-code" aria-label={`Room code ${code.split('').join(' ')}`}>
        <span className="muted small">Room</span> <strong>{code}</strong>
      </div>
      <button type="button" className="btn btn-primary btn-small" onClick={copy} aria-live="polite">
        {copied || '🔗 Copy invite link'}
      </button>
      <span className="muted small online-count">{online} watching</span>
      <span className="header-spacer" />
      <button type="button" className="btn btn-icon" onClick={onShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">⌨️</button>
      <ThemeToggle />
      <Link to="/" className="btn btn-small" onClick={onLeave}>Leave</Link>
    </header>
  );
}
