import { useState } from 'react';
import { parseYouTubeId } from '../utils/youtube.js';

/** Host-only: paste a YouTube URL to play it now, or queue it. */
export default function VideoUrlForm({ onPlay, onQueue }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);

  const submit = async (mode) => {
    const id = parseYouTubeId(url);
    if (!id) {
      setError('That is not a YouTube link (try youtube.com/watch?v=..., youtu.be/... or /embed/...)');
      return;
    }
    setError(null);
    const res = await (mode === 'queue' ? onQueue(id) : onPlay(id));
    if (res?.ok !== false) setUrl('');
  };

  return (
    <form
      className="url-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit('play');
      }}
    >
      <label htmlFor="video-url" className="sr-only">YouTube URL</label>
      <input
        id="video-url"
        className="input"
        placeholder="Paste a YouTube link…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'video-url-error' : undefined}
      />
      <button type="submit" className="btn btn-primary">Play now</button>
      <button type="button" className="btn" onClick={() => submit('queue')}>Queue</button>
      {error && <p id="video-url-error" className="form-error" role="alert">{error}</p>}
    </form>
  );
}
