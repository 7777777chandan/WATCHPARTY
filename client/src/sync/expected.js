/** Where the video should be right now according to the server state. */
export function expectedPosition(state, serverNowMs) {
  if (!state) return 0;
  if (!state.playing) return state.position;
  return state.position + Math.max(0, serverNowMs - state.updatedAt) / 1000;
}
