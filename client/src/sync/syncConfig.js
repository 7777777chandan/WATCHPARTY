/** All synchronization thresholds in one place (seconds unless noted). */
export const SYNC = {
  // Applying remote state
  APPLY_SEEK_THRESHOLD: 0.3, // playing: seek when off by more than this when a new state arrives
  PAUSED_SEEK_THRESHOLD: 0.05, // paused: be exact
  CMD_WINDOW_MS: 1000, // a player event this soon after our own command of that kind is ours
  RECONCILE_MAX: 3, // max consecutive reconcile passes after a suppression window
  PAUSE_DEFER_MS: 200, // a PAUSED event waits this long in case it's actually a seek
  AUTOPLAY_CHECK_MS: 1500,

  // Local seek detection (poll)
  POLL_MS: 250,
  SEEK_DETECT_THRESHOLD: 1.0,

  // Drift correction loop
  DRIFT_INTERVAL_MS: 1000,
  DRIFT_SAMPLES: 3, // moving average window
  DRIFT_GRACE_AFTER_SEEK_MS: 1500, // don't measure right after a seek/play (buffering)
  DRIFT_OK: 0.15, // |drift| below this: in sync
  DRIFT_RESTORE: 0.1, // a soft correction ends once |drift| is below this
  DRIFT_HARD: 1.5, // |drift| at or above this: hard seek
  DRIFT_HARD_NO_FINE_RATES: 0.4, // without fine playback rates, hard seek above this
  SOFT_RATE_DELTA: 0.05, // 1.05x when behind, 0.95x when ahead
  HARD_SEEK_COOLDOWN_MS: 3000,
  SEEK_LEAD_MAX: 1, // cap for the learned seek-latency compensation
  DRIFT_LOG_SIZE: 500,
  CATCHUP_SUGGEST_AFTER: 3, // consecutive failed corrections before suggesting "Catch me up"

  // Reporting
  DRIFT_REPORT_MS: 5000,

  // Clock sync
  CLOCK_ROUNDS: 8,
  CLOCK_SPACING_MS: 100,
  CLOCK_RESYNC_MS: 20_000,
  CLOCK_MIN_CHANGE_MS: 20,
};
