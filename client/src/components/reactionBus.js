/** Tiny pub/sub so the timeline can replay faint reactions through the floating layer. */
const listeners = new Set();
export const reactionBus = {
  emit(reaction) {
    for (const fn of listeners) fn(reaction);
  },
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
