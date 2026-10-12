/**
 * Process-wide clock state. clientNow() is a monotonic wall clock
 * (performance.timeOrigin + performance.now()) used for every timing measurement, so the
 * offset is computed and applied against the same clock. serverNow() is the estimated
 * server time.
 */
export const clockState = { offset: 0, rtt: null, medianRtt: null, lastSync: null, synced: false };

export const clientNow = () => performance.timeOrigin + performance.now();
export const serverNow = () => clientNow() + clockState.offset;
