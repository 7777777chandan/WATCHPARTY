import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ChatMessage from './ChatMessage.jsx';

const MAX = 500;
const SPOILER_KEY = 'wp.spoilerSafe';

function loadSpoilerSafe() {
  try {
    return localStorage.getItem(SPOILER_KEY) !== 'false';
  } catch {
    return true;
  }
}

export default function ChatPanel({ chat, you, emit, chatEnabled, isHost, onOpenMovie }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [stuck, setStuck] = useState(true); // stuck to the bottom = auto-scroll
  const [unseen, setUnseen] = useState(0);
  const [spoilerSafe, setSpoilerSafe] = useState(loadSpoilerSafe);
  const listRef = useRef(null);
  const lastCount = useRef(chat.length);

  const canChat = chatEnabled || isHost;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const added = chat.length - lastCount.current;
    lastCount.current = chat.length;
    if (stuck) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnseen((n) => n + added);
  }, [chat, stuck]);

  useEffect(() => {
    try {
      localStorage.setItem(SPOILER_KEY, String(spoilerSafe));
    } catch {
      /* ignore */
    }
  }, [spoilerSafe]);

  const onScroll = () => {
    const el = listRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStuck(atBottom);
    if (atBottom) setUnseen(0);
  };

  const jumpToBottom = () => {
    const el = listRef.current;
    el.scrollTop = el.scrollHeight;
    setStuck(true);
    setUnseen(0);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await emit('chat:send', { text: body }, { quiet: true });
    setSending(false);
    if (res.ok) {
      setText('');
      setError(null);
      jumpToBottom();
    } else setError(res.error || 'Message not sent');
  };

  return (
    <section className="panel chat-panel" aria-label="Chat">
      <div className="panel-toolbar">
        <label className="toggle small" title='Messages starting with "||" are hidden until clicked'>
          <input type="checkbox" checked={spoilerSafe} onChange={(e) => setSpoilerSafe(e.target.checked)} />
          Spoiler-safe
        </label>
        <span className="muted small">Start a message with || to mark a spoiler</span>
      </div>
      <ul className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {chat.length === 0 && <li className="empty">No messages yet. Say hi 👋</li>}
        {chat.map((m) => (
          <ChatMessage key={m.id} msg={m} mine={m.userId === you} spoilerSafe={spoilerSafe} onOpenMovie={onOpenMovie} />
        ))}
      </ul>
      {unseen > 0 && (
        <button type="button" className="new-messages" onClick={jumpToBottom}>
          ↓ {unseen} new message{unseen > 1 ? 's' : ''}
        </button>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <textarea
          id="chat-input"
          className="input"
          rows={2}
          maxLength={MAX}
          placeholder={canChat ? 'Message (Enter to send, Shift+Enter for a new line)' : 'Chat is disabled by the host'}
          disabled={!canChat}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="chat-form-row">
          <span className={`muted small ${text.length > MAX - 50 ? 'warn' : ''}`} aria-live="off">
            {text.length}/{MAX}
          </span>
          {error && <span className="form-error small" role="alert">{error}</span>}
          <button type="submit" className="btn btn-primary" disabled={!canChat || !text.trim() || sending}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
