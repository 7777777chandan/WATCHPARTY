import { handle } from './helpers.js';

/** Clock sync: reply immediately with the server time so the client can estimate its offset. */
export function registerTimeHandlers(socket) {
  handle(socket, 'time:ping', (payload) => {
    const t0 = typeof payload.t0 === 'number' && Number.isFinite(payload.t0) ? payload.t0 : null;
    return { t0, ts: Date.now() };
  });
}
