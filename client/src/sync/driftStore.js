/** Minimal external store so only the panels that show drift re-render every second. */
const listeners = new Set();
let snapshot = { drift: 0, raw: 0, corrections: 0, state: 'idle', lastAction: 'none', rate: 1, fineRates: false, consecutiveFails: 0 };

export const driftStore = {
  get: () => snapshot,
  set(next) {
    snapshot = { ...snapshot, ...next };
    for (const fn of listeners) fn();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
