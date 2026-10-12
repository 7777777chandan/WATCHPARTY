import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../utils/api.js';
import { fuzzySearch, mergeById } from '../utils/movieSearch.js';

function MovieCard({ movie, onOpen }) {
  return (
    <button type="button" className="movie-card" onClick={() => onOpen(movie)}>
      {movie.posterUrl ? <img src={movie.posterUrl} alt="" loading="lazy" /> : <span className="poster-fallback">🎬</span>}
      <span className="movie-card-body">
        <strong>{movie.title}</strong>
        <span className="muted small">{[movie.year, movie.rating ? `★ ${movie.rating}` : null].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  );
}

function Skeletons({ n = 6 }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="movie-card skeleton" aria-hidden="true">
      <span className="skeleton-poster" />
      <span className="skeleton-line" />
      <span className="skeleton-line short" />
    </div>
  ));
}

const YEAR_NOW = new Date().getFullYear();

/**
 * Category chips + filters + infinite list from our /api/movies proxy, and instant fuzzy search
 * (Fuse.js) over every movie loaded so far, topped up from /api/movies/search when the local
 * pool has fewer than 3 matches.
 */
export default function MoviesPanel({ onOpen, suggestions, onPollFromSuggestions }) {
  const [meta, setMeta] = useState({ categories: [], genres: [] });
  const [metaError, setMetaError] = useState(null);
  const [filters, setFilters] = useState({ category: 'trending', genre: '', year: '', minRating: 0 });
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [remote, setRemote] = useState([]);
  const [searching, setSearching] = useState(false);
  const pool = useRef(new Map());
  const [poolVersion, setPoolVersion] = useState(0);
  const sentinel = useRef(null);

  const addToPool = useCallback((movies) => {
    let added = false;
    for (const m of movies) {
      if (!pool.current.has(m.id)) {
        pool.current.set(m.id, m);
        added = true;
      }
    }
    if (added) setPoolVersion((v) => v + 1);
  }, []);

  const loadMeta = useCallback(() => {
    setMetaError(null);
    apiGet('/api/movies/categories')
      .then(setMeta)
      .catch((err) => setMetaError(err.message));
  }, []);
  useEffect(loadMeta, [loadMeta]);

  // Listing: reload page 1 whenever a filter changes, append on "load more".
  const load = useCallback(
    async (pageToLoad, signal) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ category: filters.category, page: String(pageToLoad) });
      if (filters.genre) params.set('genre', filters.genre);
      if (filters.year) params.set('year', filters.year);
      if (Number(filters.minRating) > 0) params.set('minRating', String(filters.minRating));
      try {
        const data = await apiGet(`/api/movies?${params}`, { signal });
        setList((prev) => (pageToLoad === 1 ? data.results : mergeById(prev, data.results)));
        setTotalPages(data.totalPages);
        setPage(pageToLoad);
        addToPool(data.results);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filters, addToPool],
  );

  useEffect(() => {
    if (metaError) return undefined;
    const ctrl = new AbortController();
    load(1, ctrl.signal);
    return () => ctrl.abort();
  }, [load, metaError]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || debounced) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && !error && page < totalPages) load(page + 1);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [load, loading, error, page, totalPages, debounced]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const local = useMemo(
    () => (debounced.length >= 2 ? fuzzySearch([...pool.current.values()], debounced) : []),
    // poolVersion invalidates the memo when new movies arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debounced, poolVersion],
  );

  useEffect(() => {
    setRemote([]);
    if (debounced.length < 2 || local.length >= 3) return undefined;
    const ctrl = new AbortController();
    setSearching(true);
    apiGet(`/api/movies/search?q=${encodeURIComponent(debounced)}`, { signal: ctrl.signal })
      .then((data) => {
        setRemote(data.results);
        addToPool(data.results);
      })
      .catch(() => {})
      .finally(() => !ctrl.signal.aborted && setSearching(false));
    return () => ctrl.abort();
    // only re-query when the text changes, not when the pool grows from our own results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const searchResults = useMemo(() => mergeById(local, remote), [local, remote]);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const showing = debounced.length >= 2 ? searchResults : list;

  if (metaError) {
    return (
      <section className="panel" aria-label="Movies">
        <div className="empty error-state" role="alert">
          <span className="big-emoji" aria-hidden="true">🎬</span>
          <p><strong>Movie discovery is unavailable</strong></p>
          <p className="muted small">{metaError}</p>
          <p className="muted small">Everything else in the room keeps working.</p>
          <button type="button" className="btn" onClick={loadMeta}>Retry</button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel movies-panel" aria-label="Movies">
      <label htmlFor="movie-search" className="sr-only">Search movies</label>
      <input
        id="movie-search"
        className="input"
        type="search"
        placeholder="Search movies (typos are fine)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!debounced && (
        <>
          <div className="chips" role="tablist" aria-label="Categories">
            {(meta.categories.length ? meta.categories : [{ id: 'trending', label: 'Trending' }]).map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={filters.category === c.id}
                className={`chip ${filters.category === c.id ? 'active' : ''}`}
                onClick={() => setFilter('category', c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="filters">
            <label>
              Genre
              <select className="input" value={filters.genre} onChange={(e) => setFilter('genre', e.target.value)}>
                <option value="">Any</option>
                {meta.genres.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>
            <label>
              Year
              <input
                className="input input-narrow"
                type="number"
                min="1900"
                max={YEAR_NOW + 2}
                placeholder="Any"
                value={filters.year}
                onChange={(e) => setFilter('year', e.target.value.slice(0, 4))}
              />
            </label>
            <label className="range">
              Min rating: <strong>{Number(filters.minRating) > 0 ? `${filters.minRating}+` : 'any'}</strong>
              <input type="range" min="0" max="9" step="0.5" value={filters.minRating} onChange={(e) => setFilter('minRating', e.target.value)} />
            </label>
          </div>
        </>
      )}
      {suggestions.length >= 2 && (
        <button type="button" className="btn btn-small" onClick={onPollFromSuggestions}>
          🗳️ Vote on the {Math.min(5, suggestions.length)} latest suggestions
        </button>
      )}

      {error && (
        <div className="empty error-state" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-small" onClick={() => load(1)}>Retry</button>
        </div>
      )}
      {debounced && !searching && searchResults.length === 0 && (
        <p className="empty">No movies match “{debounced}”.</p>
      )}
      {!debounced && !loading && !error && list.length === 0 && <p className="empty">No movies match these filters.</p>}

      <div className="movie-grid">
        {showing.map((m) => <MovieCard key={m.id} movie={m} onOpen={onOpen} />)}
        {(loading || searching) && <Skeletons n={debounced ? 3 : 6} />}
      </div>
      {!debounced && page < totalPages && !error && (
        <div ref={sentinel} className="load-more">
          <button type="button" className="btn" disabled={loading} onClick={() => load(page + 1)}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      <p className="muted small attribution">Movie data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </section>
  );
}
