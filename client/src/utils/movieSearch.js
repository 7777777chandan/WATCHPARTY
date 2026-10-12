import Fuse from 'fuse.js';

/** Fuzzy search settings: title matters more than overview; tolerant to typos. */
export const FUSE_OPTIONS = {
  keys: [
    { name: 'title', weight: 0.7 },
    { name: 'overview', weight: 0.3 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function fuzzySearch(pool, query, limit = 40) {
  const fuse = new Fuse(pool, FUSE_OPTIONS);
  return fuse.search(query, { limit }).map((r) => r.item);
}

/** Merge lists, keeping the first occurrence of each movie id. */
export function mergeById(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}
