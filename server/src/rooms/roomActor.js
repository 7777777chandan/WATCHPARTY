/**
 * Explicit "one room, one event at a time" boundary.
 *
 * Node runs handlers on a single thread, so a synchronous mutation can never interleave
 * with another. Every state-changing handler still goes through runInRoom() to make that
 * contract visible: the mutation is synchronous (no await inside), it bumps `seq` when it
 * changes playback, and it broadcasts the result before the next event is processed.
 * Async work (oEmbed, TMDB) happens *before* calling runInRoom, never inside it, so slow I/O
 * can't block or reorder other actions in the room.
 */
export function runInRoom(room, mutate) {
  if (room.deleted) return { ok: false, error: 'Room no longer exists' };
  const result = mutate(room);
  if (result && typeof result.then === 'function') {
    throw new Error('runInRoom mutations must be synchronous');
  }
  return result;
}
