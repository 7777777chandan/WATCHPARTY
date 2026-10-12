/** Small Map-based TTL cache with a size cap (oldest entries evicted first). */
export function createTtlCache({ ttlMs, maxEntries = 500 }) {
  const map = new Map();
  return {
    get(key, now = Date.now()) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expires <= now) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, now = Date.now()) {
      map.delete(key);
      map.set(key, { value, expires: now + ttlMs });
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}
