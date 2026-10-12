import { SERVER_URL } from '../socket.js';

/** GET a JSON endpoint on our server (never TMDB directly: the token stays server-side). */
export async function apiGet(path, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${SERVER_URL}${path}`, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Cannot reach the server');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchTrailer(movieId) {
  const { trailer } = await apiGet(`/api/movies/${movieId}/trailer`);
  return trailer;
}
