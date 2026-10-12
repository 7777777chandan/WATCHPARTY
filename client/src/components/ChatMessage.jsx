import { useState } from 'react';

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Renders text with clickable links. Only React text nodes and <a> elements, no raw HTML. */
export function Linkified({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      let safe = null;
      try {
        const u = new URL(part);
        if (u.protocol === 'http:' || u.protocol === 'https:') safe = u.href;
      } catch {
        /* not a URL */
      }
      if (safe) {
        return (
          <a key={i} href={safe} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Feature E: a message starting with "||" is a spoiler and stays blurred until clicked. */
function SpoilerText({ text, spoilerSafe }) {
  const [revealed, setRevealed] = useState(false);
  const body = text.replace(/^\|\|\s*/, '').replace(/\s*\|\|$/, '');
  if (!spoilerSafe || revealed) {
    return (
      <span className="spoiler-revealed">
        <span className="spoiler-tag">spoiler</span> <Linkified text={body} />
      </span>
    );
  }
  return (
    <button type="button" className="spoiler" onClick={() => setRevealed(true)} aria-label="Spoiler hidden, click to reveal">
      <span className="spoiler-blur" aria-hidden="true">{body}</span>
      <span className="spoiler-hint">Spoiler: click to reveal</span>
    </button>
  );
}

export default function ChatMessage({ msg, mine, spoilerSafe, onOpenMovie }) {
  if (msg.type === 'system') {
    return (
      <li className="chat-system">
        <span>{msg.text}</span> <time dateTime={new Date(msg.ts).toISOString()}>{time(msg.ts)}</time>
      </li>
    );
  }
  if (msg.type === 'suggestion' && msg.movie) {
    const m = msg.movie;
    return (
      <li className="chat-suggestion">
        <span className="muted small">{msg.name} suggested · {time(msg.ts)}</span>
        <button type="button" className="suggestion-card" onClick={() => onOpenMovie(m)}>
          {m.posterUrl ? <img src={m.posterUrl} alt="" loading="lazy" /> : <span className="poster-fallback">🎬</span>}
          <span>
            <strong>{m.title}</strong>
            <span className="muted small">{[m.year, m.rating ? `★ ${m.rating}` : null].filter(Boolean).join(' · ')}</span>
            <span className="link small">View details</span>
          </span>
        </button>
      </li>
    );
  }
  const isSpoiler = msg.text.startsWith('||');
  return (
    <li className={`chat-msg ${mine ? 'mine' : ''}`}>
      <div className="chat-meta">
        <strong>{mine ? 'You' : msg.name}</strong> <time dateTime={new Date(msg.ts).toISOString()}>{time(msg.ts)}</time>
      </div>
      <div className="chat-bubble">
        {isSpoiler ? <SpoilerText text={msg.text} spoilerSafe={spoilerSafe} /> : <Linkified text={msg.text} />}
      </div>
    </li>
  );
}
