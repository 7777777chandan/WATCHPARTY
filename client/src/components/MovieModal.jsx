import { useState } from 'react';
import Modal from './Modal.jsx';
import { fetchTrailer } from '../utils/api.js';
import { useToast } from '../context/ToastContext.jsx';

export default function MovieModal({ movie, onClose, emit, isHost }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  const withTrailer = async (label, fn) => {
    setBusy(label);
    try {
      const trailer = await fetchTrailer(movie.id);
      if (!trailer) {
        toast.push({ text: `No YouTube trailer found for ${movie.title}`, type: 'error' });
        return;
      }
      await fn(trailer);
    } catch (err) {
      toast.push({ text: err.message, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setBusy('suggest');
    const { id, title, posterUrl, year, rating } = movie;
    const res = await emit('chat:suggest', { movie: { id, title, posterUrl, year, rating } });
    setBusy(null);
    if (res.ok) {
      toast.push({ text: `Suggested ${title} to the room`, type: 'success' });
      onClose();
    }
  };

  const addTrailer = () =>
    withTrailer('add', async (t) => {
      const res = await emit('playlist:add', { url: t.key, title: `${movie.title}: trailer`.slice(0, 120), source: 'tmdb' });
      if (res.ok) toast.push({ text: 'Trailer added to the playlist', type: 'success' });
    });

  const playNow = () =>
    withTrailer('play', async (t) => {
      const res = await emit('video:set', { videoId: t.key });
      if (res.ok) onClose();
    });

  return (
    <Modal title={movie.title} onClose={onClose} wide>
      <div className="movie-detail">
        {movie.posterUrl ? <img src={movie.posterUrl} alt={`${movie.title} poster`} /> : <span className="poster-fallback big">🎬</span>}
        <div>
          <p className="muted">
            {[movie.year, movie.rating ? `★ ${movie.rating}/10` : null, movie.genres?.join(', ')].filter(Boolean).join(' · ')}
          </p>
          <p>{movie.overview || 'No overview available.'}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={suggest} disabled={Boolean(busy)}>
              💬 Suggest to room
            </button>
            <button type="button" className="btn" onClick={addTrailer} disabled={Boolean(busy)}>
              {busy === 'add' ? 'Finding trailer…' : '➕ Add trailer to playlist'}
            </button>
            {isHost && (
              <button type="button" className="btn" onClick={playNow} disabled={Boolean(busy)}>
                {busy === 'play' ? 'Finding trailer…' : '▶ Play trailer now'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
