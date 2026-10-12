/**
 * Sliding-window rate limiter keyed by an arbitrary string (usually userId or socket id).
 * check(key) returns true when the call is allowed and records it.
 */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    check(key, now = Date.now()) {
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
    reset(key) {
      hits.delete(key);
    },
    get size() {
      return hits.size;
    },
    // Drop keys whose windows have fully expired (called periodically to avoid leaks).
    prune(now = Date.now()) {
      for (const [key, list] of hits) {
        if (!list.length || now - list[list.length - 1] >= windowMs) hits.delete(key);
      }
    },
  };
}
