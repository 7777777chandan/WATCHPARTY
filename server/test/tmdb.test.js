// TMDB failure modes: missing token, unreachable, timeout, and the happy path via a fake TMDB.
process.env.LOG_LEVEL = 'silent';
import http from 'node:http';
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer } = await import('./helpers.js');
const { _clearTmdbCache } = await import('../src/services/tmdb.js');

let srv;
let fake;
let fakeUrl;
let mode = 'ok';
before(async () => {
  srv = await startServer();
  fake = http.createServer((req, res) => {
    if (mode === 'slow') return setTimeout(() => res.end('{}'), 6000);
    if (req.headers.authorization !== 'Bearer good-token') {
      res.writeHead(401);
      return res.end('{}');
    }
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/genre/movie/list')) return res.end(JSON.stringify({ genres: [{ id: 28, name: 'Action' }] }));
    if (req.url.startsWith('/movie/27205/videos')) {
      return res.end(JSON.stringify({ results: [
        { site: 'YouTube', type: 'Teaser', official: true, key: 'AAAAAAAAAAA', name: 'Teaser' },
        { site: 'YouTube', type: 'Trailer', official: false, key: 'BBBBBBBBBBB', name: 'Fan trailer' },
        { site: 'YouTube', type: 'Trailer', official: true, key: 'YoHD9XEInc0', name: 'Official Trailer' },
      ] }));
    }
    return res.end(JSON.stringify({ page: 1, total_pages: 3, results: [{ id: 27205, title: 'Inception', overview: 'Dreams', poster_path: '/p.jpg', release_date: '2010-07-15', vote_average: 8.37, genre_ids: [28] }] }));
  });
  await new Promise((r) => fake.listen(0, r));
  fakeUrl = `http://localhost:${fake.address().port}`;
});
after(async () => {
  await srv.stop();
  fake.closeAllConnections();
  fake.close();
});

const get = (path) => fetch(`${srv.url}${path}`).then(async (r) => ({ status: r.status, body: await r.json() }));

test('missing token -> 503 with a clear error', async () => {
  delete process.env.TMDB_READ_TOKEN;
  _clearTmdbCache();
  const r = await get('/api/movies/categories');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /not configured/);
});

test('rejected token -> 503, token never echoed', async () => {
  process.env.TMDB_READ_TOKEN = 'secret-bad-token';
  process.env.TMDB_BASE_URL = fakeUrl;
  _clearTmdbCache();
  const r = await get('/api/movies?category=popular');
  assert.equal(r.status, 503);
  assert.ok(!JSON.stringify(r.body).includes('secret-bad-token'));
});

test('TMDB unreachable -> 503', async () => {
  process.env.TMDB_READ_TOKEN = 'good-token';
  process.env.TMDB_BASE_URL = 'http://127.0.0.1:9';
  _clearTmdbCache();
  const r = await get('/api/movies/search?q=x');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /unreachable|timed out/);
});

test('TMDB timeout (5 s) -> 503', async () => {
  process.env.TMDB_BASE_URL = fakeUrl;
  mode = 'slow';
  _clearTmdbCache();
  const t0 = Date.now();
  const r = await get('/api/movies/search?q=slow');
  mode = 'ok';
  assert.equal(r.status, 503);
  assert.match(r.body.error, /timed out/);
  assert.ok(Date.now() - t0 < 6000);
});

test('happy path: normalized movies, filters validated, best trailer chosen', async () => {
  process.env.TMDB_BASE_URL = fakeUrl;
  _clearTmdbCache();
  const list = await get('/api/movies?category=top_rated&genre=28&year=2010&minRating=7');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.results[0], {
    id: 27205, title: 'Inception', overview: 'Dreams', posterUrl: 'https://image.tmdb.org/t/p/w342/p.jpg', year: 2010, rating: 8.4, genres: ['Action'], popularity: 0,
  });
  assert.equal((await get('/api/movies?category=nope')).status, 400);
  assert.equal((await get('/api/movies?year=abc')).status, 400);
  assert.equal((await get('/api/movies/search')).status, 400);
  const trailer = await get('/api/movies/27205/trailer');
  assert.equal(trailer.body.trailer.key, 'YoHD9XEInc0');
});
