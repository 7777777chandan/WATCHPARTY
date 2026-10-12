import { config } from '../config.js';
import { createRateLimiter } from './rateLimiter.js';

/** Shared per-user rate limiters for each feature. */
export const limiters = {
  chat: createRateLimiter(config.CHAT_RATE),
  reaction: createRateLimiter(config.REACTION_RATE),
  drift: createRateLimiter(config.DRIFT_REPORT_RATE),
  playlist: createRateLimiter(config.PLAYLIST_RATE),
  poll: createRateLimiter(config.POLL_RATE),
};

export function pruneLimiters() {
  for (const l of Object.values(limiters)) l.prune();
}

export const rateLimited = (what) => ({ ok: false, error: `Slow down: ${what}`, code: 'RATE_LIMITED' });
