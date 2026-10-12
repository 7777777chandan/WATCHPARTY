/**
 * TMDB client. Runs only on the server so the token never reaches the browser.
 * The token is read per request (so tests can toggle it) and is never logged.
 */
import { config } from '../config.js';
import { createTtlCache } from '../utils/ttlCache.js';

const BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const cache = createTtlCache({ ttlMs: config.TMDB_CACHE_TTL_MS, maxEntries: 500 });

export class TmdbError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const CATEGORIES = [
  { id: 'trending', label: 'Trending', path: '/trending/movie/week' },
  { id: 'popular', label: 'Popular', path: '/movie/popular' },
  { id: 'top_rated', label: 'Top Rated', path: '/movie/top_rated' },
  { id: 'now_playing', label: 'Now Playing', path: '/movie/now_playing' },
  { id: 'upcoming', label: 'Upcoming', path: '/movie/upcoming' },
];

function token() {
  const t = process.env.TMDB_READ_TOKEN;
  return t && t !== 'your_token_here' ? t : null;
}

export function isConfigured() {
  return Boolean(token());
}

/** Fetch with cache, a 5 s timeout and clean errors. */
async function tmdbFetch(path, params = {}) {
  const auth = token();
  if (!auth) throw new TmdbError(503, 'Movie discovery is not configured (TMDB token missing on the server)');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  url.searchParams.set('language', 'en-US');
  const key = url.toString();
  const cached = cache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.TMDB_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(key, {
      headers: { Authorization: `Bearer ${auth}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    throw new TmdbError(503, err.name === 'AbortError' ? 'TMDB timed out' : 'TMDB is unreachable');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new TmdbError(503, 'TMDB rejected the server token');
  if (res.status === 404) throw new TmdbError(404, 'Not found on TMDB');
  if (res.status === 429) throw new TmdbError(503, 'TMDB rate limit reached, try again shortly');
  if (!res.ok) throw new TmdbError(503, `TMDB error (${res.status})`);
  const data = await res.json();
  cache.set(key, data);
  return data;
}

let genreMap = null;
export async function getGenres() {
  const data = await tmdbFetch('/genre/movie/list');
  const genres = (data.genres || []).map((g) => ({ id: g.id, label: g.name }));
  genreMap = new Map(genres.map((g) => [g.id, g.label]));
  return genres;
}

function normalize(m) {
  return {
    id: m.id,
    title: m.title || m.name || 'Untitled',
    overview: m.overview || '',
    posterUrl: m.poster_path ? POSTER_BASE + m.poster_path : null,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) || null : null,
    rating: typeof m.vote_average === 'number' ? Math.round(m.vote_average * 10) / 10 : null,
    genres: (m.genre_ids || m.genres?.map((g) => g.id) || []).map((id) => genreMap?.get(id)).filter(Boolean),
    popularity: m.popularity ?? 0,
  };
}

async function ensureGenres() {
  if (!genreMap) {
    try {
      await getGenres();
    } catch {
      /* genres are cosmetic; listing still works without them */
    }
  }
}

function toPage(data) {
  return {
    page: data.page ?? 1,
    totalPages: Math.min(data.total_pages ?? 1, 500),
    results: (data.results || []).map(normalize),
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

/** Category list endpoints don't support filters, so filtered queries go through /discover. */
export async function listMovies({ category = 'popular', genre, year, minRating, page = 1 }) {
  await ensureGenres();
  const cat = CATEGORIES.find((c) => c.id === category) || CATEGORIES[1];
  const filtered = genre || year || minRating;
  if (!filtered) return toPage(await tmdbFetch(cat.path, { page }));

  const params = { page, with_genres: genre, primary_release_year: year, 'vote_average.gte': minRating, include_adult: false };
  switch (cat.id) {
    case 'top_rated':
      Object.assign(params, { sort_by: 'vote_average.desc', 'vote_count.gte': 300 });
      break;
    case 'upcoming':
      Object.assign(params, { sort_by: 'popularity.desc', 'primary_release_date.gte': today() });
      break;
    case 'now_playing':
      Object.assign(params, { sort_by: 'popularity.desc', 'primary_release_date.gte': daysAgo(45), 'primary_release_date.lte': today() });
      break;
    default:
      Object.assign(params, { sort_by: 'popularity.desc', 'vote_count.gte': minRating ? 50 : undefined });
  }
  return toPage(await tmdbFetch('/discover/movie', params));
}

export async function searchMovies(q, page = 1) {
  await ensureGenres();
  return toPage(await tmdbFetch('/search/movie', { query: q, page, include_adult: false }));
}

/** Best YouTube trailer: official Trailers first, then any Trailer, then Teasers. */
export async function getTrailer(id) {
  const data = await tmdbFetch(`/movie/${id}/videos`);
  const yt = (data.results || []).filter((v) => v.site === 'YouTube' && /^[A-Za-z0-9_-]{11}$/.test(v.key));
  const score = (v) => (v.type === 'Trailer' ? 2 : v.type === 'Teaser' ? 1 : 0) * 10 + (v.official ? 5 : 0);
  const best = yt.filter((v) => v.type === 'Trailer' || v.type === 'Teaser').sort((a, b) => score(b) - score(a))[0];
  return best ? { key: best.key, name: best.name } : null;
}

export function _clearTmdbCache() {
  cache.clear();
  genreMap = null;
}
