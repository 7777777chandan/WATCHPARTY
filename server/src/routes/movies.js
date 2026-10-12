import { Router } from 'express';
import { config } from '../config.js';
import { createRateLimiter } from '../utils/rateLimiter.js';
import { CATEGORIES, TmdbError, getGenres, getTrailer, listMovies, searchMovies } from '../services/tmdb.js';
import { logger } from '../utils/logger.js';

const intParam = (v, min, max) => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function createMoviesRouter() {
  const router = Router();
  const limiter = createRateLimiter(config.API_RATE);

  router.use((req, res, next) => {
    if (!limiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    next();
  });

  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof TmdbError) return res.status(err.status).json({ error: err.message });
      if (err.status === 400) return res.status(400).json({ error: err.message });
      logger.error('[movies]', err.message);
      res.status(503).json({ error: 'Movie service unavailable' });
    }
  };
  const bad = (message) => Object.assign(new Error(message), { status: 400 });

  router.get(
    '/categories',
    wrap(async () => {
      let genres = [];
      let genreError = null;
      try {
        genres = await getGenres();
      } catch (err) {
        genreError = err.message;
        if (err instanceof TmdbError) throw err;
      }
      return { categories: CATEGORIES.map(({ id, label }) => ({ id, label })), genres, genreError };
    }),
  );

  router.get(
    '/search',
    wrap(async (req) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      if (!q) throw bad('q is required');
      const page = intParam(req.query.page, 1, 500) ?? 1;
      return searchMovies(q, page);
    }),
  );

  router.get(
    '/:id/trailer',
    wrap(async (req) => {
      const id = intParam(req.params.id, 1, 1e9);
      if (!id) throw bad('Invalid movie id');
      return { trailer: await getTrailer(id) };
    }),
  );

  router.get(
    '/',
    wrap(async (req) => {
      const category = typeof req.query.category === 'string' ? req.query.category : 'popular';
      if (!CATEGORIES.some((c) => c.id === category)) throw bad('Unknown category');
      const genre = intParam(req.query.genre, 1, 1e6);
      const year = intParam(req.query.year, 1874, 2100);
      const page = intParam(req.query.page, 1, 500);
      const minRatingRaw = req.query.minRating;
      const minRating = minRatingRaw === undefined || minRatingRaw === '' ? undefined : Number(minRatingRaw);
      if (genre === null || year === null || page === null) throw bad('Invalid filter value');
      if (minRating !== undefined && !(minRating >= 0 && minRating <= 10)) throw bad('minRating must be 0-10');
      return listMovies({ category, genre, year, minRating: minRating || undefined, page: page ?? 1 });
    }),
  );

  return router;
}
