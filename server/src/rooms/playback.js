/**
 * Playback state math. `position` is the video time (seconds) that was true at server time
 * `updatedAt`; while playing, the expected position advances in real time from there.
 */
export function getExpectedPosition(playback, now = Date.now()) {
  if (!playback.playing) return playback.position;
  return playback.position + Math.max(0, now - playback.updatedAt) / 1000;
}

/** Keeps the room's total "watch time" statistic in step with playing/paused transitions. */
function trackWatchTime(room, nowPlaying, now) {
  const s = room.stats;
  if (s.playingSince !== null) s.watchMs += now - s.playingSince;
  s.playingSince = nowPlaying ? now : null;
}

export function applyPlaybackAction(room, { type, position }, userId, now = Date.now()) {
  const pb = room.playback;
  if (type === 'play') pb.playing = true;
  else if (type === 'pause') pb.playing = false;
  trackWatchTime(room, pb.playing, now);
  pb.position = position;
  pb.updatedAt = now;
  pb.seq += 1;
  pb.lastActionBy = userId;
  return pb;
}

export function setVideo(room, videoId, userId, now = Date.now(), { autoplay = false } = {}) {
  const pb = room.playback;
  pb.videoId = videoId;
  pb.playing = autoplay;
  trackWatchTime(room, autoplay, now);
  pb.position = 0;
  pb.updatedAt = now;
  pb.seq += 1;
  pb.lastActionBy = userId;
  room.stats.videosPlayed += 1;
  return pb;
}

/** The payload broadcast as "playback:state". */
export function publicPlayback(room, extra = {}) {
  const pb = room.playback;
  return {
    videoId: pb.videoId,
    playing: pb.playing,
    position: pb.position,
    updatedAt: pb.updatedAt,
    seq: pb.seq,
    by: pb.lastActionBy,
    byName: room.users.get(pb.lastActionBy)?.name ?? null,
    serverTime: Date.now(),
    ...extra,
  };
}
