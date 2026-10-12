/**
 * Every tunable in one place. Durations can be overridden by env vars, which makes
 * failure tests (grace periods) fast without changing code.
 */
const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export const config = {
  MAX_USERS_PER_ROOM: 50,
  USER_REMOVAL_GRACE_MS: num('USER_REMOVAL_GRACE_MS', 60_000),
  HOST_GRACE_MS: num('HOST_GRACE_MS', 15_000),
  KICK_BAN_MS: num('KICK_BAN_MS', 10 * 60_000),
  RECOVERY_MAX_DISCONNECT_MS: 2 * 60_000,

  // Playback
  DUPLICATE_ACTION_WINDOW_MS: 150,
  STALE_SEQ_THRESHOLD: 5,
  MAX_POSITION_SEC: 24 * 3600,

  // Abuse protection: per-socket budget across all events
  SOCKET_EVENTS_PER_SEC: num('SOCKET_EVENTS_PER_SEC', 50),
  SOCKET_ABUSE_STRIKES: 3,
  MAX_PAYLOAD_BYTES: 16 * 1024,

  // Chat & reactions
  CHAT_MAX_LEN: 500,
  CHAT_HISTORY: 200,
  CHAT_SNAPSHOT: 50,
  CHAT_RATE: { limit: 5, windowMs: 5000 },
  REACTION_RATE: { limit: 5, windowMs: 1000 },
  REACTIONS_STORED: 500,
  REACTION_EMOJIS: ['😂', '❤️', '😮', '👏', '🔥', '😢', '👍', '🎉'],

  // Drift reporting
  DRIFT_REPORT_RATE: { limit: 3, windowMs: 5000 },
  DRIFT_BROADCAST_MS: 5000,
  DRIFT_REPORT_TTL_MS: 15_000,

  // Playlist
  PLAYLIST_MAX: 50,
  PLAYLIST_RATE: { limit: 10, windowMs: 10_000 },
  OEMBED_TIMEOUT_MS: 3000,

  // Polls
  POLL_RATE: { limit: 10, windowMs: 10_000 },
  POLL_MAX_OPEN_PER_USER: 1,
  POLL_MAX_OPEN_PER_ROOM: 3,
  POLL_KEEP_CLOSED: 5,
  SKIP_POLL_SECONDS: 30,

  // Countdown
  COUNTDOWN_MIN: 3,
  COUNTDOWN_MAX: 10,
  COUNTDOWN_LEAD_MS: 300,

  // TMDB
  TMDB_TIMEOUT_MS: 5000,
  TMDB_CACHE_TTL_MS: 10 * 60_000,
  API_RATE: { limit: 60, windowMs: 60_000 },
};
