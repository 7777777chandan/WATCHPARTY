import { useState } from 'react';
import { parseYouTubeId } from '../utils/youtube.js';

export default function PlaylistPanel({ playlist, you, isHost, emit, onPollFromPlaylist }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const { items, currentItemId } = playlist;

  const add = async (e) => {
    e.preventDefault();
    const id = parseYouTubeId(url);
    if (!id) return setError('Paste a YouTube link or an 11-character video id');
    setBusy(true);
    const res = await emit('playlist:add', { url: id }, { quiet: true });
    setBusy(false);
    if (res.ok) {
      setUrl('');
      setError(null);
    } else setError(res.error);
  };

  const drop = (index) => {
    if (dragId && isHost) emit('playlist:reorder', { itemId: dragId, newIndex: index });
    setDragId(null);
    setOverIndex(null);
  };

  return (
    <section className="panel" aria-label="Playlist">
      <form className="inline-form" onSubmit={add}>
        <label htmlFor="pl-url" className="sr-only">Add a YouTube video</label>
        <input id="pl-url" className="input" placeholder="Add a YouTube link…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
      </form>
      {error && <p className="form-error small" role="alert">{error}</p>}

      {isHost && items.length > 0 && (
        <div className="panel-toolbar">
          <button type="button" className="btn btn-small" onClick={() => emit('playlist:next')}>⏭ Play next</button>
          <button type="button" className="btn btn-small" onClick={() => emit('playlist:sortByVotes')}>Sort by votes</button>
          {items.length >= 2 && (
            <button type="button" className="btn btn-small" onClick={onPollFromPlaylist}>Poll: what next?</button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <span className="big-emoji" aria-hidden="true">🎞️</span>
          <p>The queue is empty.</p>
          <p className="muted small">Anyone can add videos. Vote on what to watch next; the host sets the order.</p>
        </div>
      ) : (
        <ol className="playlist">
          {items.map((item, index) => {
            const voted = item.voters.includes(you);
            const canRemove = isHost || item.addedBy === you;
            return (
              <li
                key={item.id}
                className={`playlist-item ${item.id === currentItemId ? 'current' : ''} ${overIndex === index ? 'drag-over' : ''} ${dragId === item.id ? 'dragging' : ''}`}
                draggable={isHost}
                onDragStart={(e) => {
                  setDragId(item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', item.id);
                }}
                onDragOver={(e) => {
                  if (!isHost || !dragId) return;
                  e.preventDefault();
                  setOverIndex(index);
                }}
                onDragLeave={() => setOverIndex((i) => (i === index ? null : i))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(index);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverIndex(null);
                }}
              >
                {isHost && <span className="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>}
                <img className="thumb" src={item.thumbnail} alt="" loading="lazy" />
                <div className="playlist-info">
                  <strong title={item.title}>
                    {item.id === currentItemId && <span className="now-playing">▶ Now playing · </span>}
                    {item.title}
                  </strong>
                  <span className="muted small">added by {item.addedBy === you ? 'you' : item.addedByName}{item.source === 'tmdb' ? ' · 🎬 trailer' : ''}</span>
                </div>
                <div className="playlist-actions">
                  <button
                    type="button"
                    className={`btn btn-small vote ${voted ? 'active' : ''}`}
                    aria-pressed={voted}
                    aria-label={`${voted ? 'Remove vote' : 'Vote'} (${item.votes} votes)`}
                    onClick={() => emit('playlist:vote', { itemId: item.id })}
                  >
                    ▲ {item.votes}
                  </button>
                  {isHost && (
                    <>
                      <button type="button" className="btn btn-small" onClick={() => emit('playlist:playNow', { itemId: item.id })} aria-label={`Play ${item.title} now`}>▶</button>
                      <span className="reorder-keys">
                        <button type="button" className="btn btn-icon" disabled={index === 0} onClick={() => emit('playlist:reorder', { itemId: item.id, newIndex: index - 1 })} aria-label="Move up">↑</button>
                        <button type="button" className="btn btn-icon" disabled={index === items.length - 1} onClick={() => emit('playlist:reorder', { itemId: item.id, newIndex: index + 1 })} aria-label="Move down">↓</button>
                      </span>
                    </>
                  )}
                  {canRemove && (
                    <button type="button" className="btn btn-icon danger" onClick={() => emit('playlist:remove', { itemId: item.id })} aria-label={`Remove ${item.title}`}>✕</button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
