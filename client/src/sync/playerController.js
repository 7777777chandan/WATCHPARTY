import { SYNC } from './syncConfig.js';
import { expectedPosition } from './expected.js';
import { clientNow, serverNow } from '../utils/clock.js';

// YT.PlayerState values (copied so this module has no dependency on the global YT object).
export const YTS = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

const playingLike = (ys) => ys === YTS.PLAYING || ys === YTS.BUFFERING;

/**
 * Bridges a YouTube player and the server-authoritative playback state.
 *
 * ECHO LOOP PREVENTION. Applying a remote state makes the iframe fire onStateChange, and
 * that must never be sent back to the server as if the user did it. Three mechanisms:
 *
 *  1. Compare to the authoritative state. A PLAYING event is only reported when the room is
 *     paused, and a PAUSED event only when the room is playing. Whatever we do to match the
 *     room can never look like a user action, regardless of event timing.
 *  2. Command attribution. Every play/pause/seek/load we issue is timestamped by kind
 *     (`this.cmd.play`, `this.cmd.pause`). A PLAYING/BUFFERING event within CMD_WINDOW_MS of
 *     a play-type command we issued is ours, and so is a PAUSED event after a pause-type one.
 *     This covers stale events that arrive after the room state changed again (e.g. two fast
 *     remote updates), while a user click right after a remote update is still recognised,
 *     because we never issued the command that would explain it.
 *     Seeks are attributed by destination: each programmatic seek records its target.
 *  3. Reconcile. Whenever an event is attributed to us, or a remote state is applied, we
 *     re-check the player against the latest room state shortly afterwards and fix any
 *     mismatch (bounded to RECONCILE_MAX passes). So no tab can silently stay diverged.
 *
 * Local "intent" covers the gap between emitting an action and receiving the server echo,
 * so YouTube's BUFFERING -> PLAYING sequence after one click isn't reported twice.
 */
export class PlayerController {
  constructor({ emitAction, onAutoplayBlocked, onEnded, onBlockedAction, log } = {}) {
    this.emitAction = emitAction || (() => {});
    this.onAutoplayBlocked = onAutoplayBlocked || (() => {});
    this.onEnded = onEnded || (() => {});
    this.onBlockedAction = onBlockedAction || (() => {});
    this.log = log || (() => {});

    this.player = null;
    this.serverState = null;
    this.lastSeq = -1;
    this.currentVideoId = null;
    this.canControl = true;

    this.cmd = { play: -Infinity, pause: -Infinity };
    this.programmatic = null; // { target, at, until } of our last seek
    this.lastSeekOrPlayAt = 0; // drift correction waits a moment after these
    this.intent = null; // { playing, until } between emitting and receiving the echo
    this.lastPoll = null;
    this.reconcileCount = 0;
    this.timers = {};
    this.autoplayBlocked = false;
    this.listeners = new Set();
  }

  // ---- lifecycle -------------------------------------------------------------------

  attach(player) {
    this.player = player;
    this.currentVideoId = null;
    this.lastPoll = null;
    this.timers.poll = setInterval(() => this.checkSeek(), SYNC.POLL_MS);
    if (this.serverState) this.sync('attach');
    this.notify();
  }

  detach() {
    for (const [key, t] of Object.entries(this.timers)) {
      if (key === 'poll') clearInterval(t);
      else clearTimeout(t);
    }
    this.timers = {};
    this.player = null;
    this.currentVideoId = null;
  }

  get ready() {
    return Boolean(this.player);
  }

  /** UI subscription (autoplay overlay etc.). */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  setCanControl(value) {
    this.canControl = value;
  }

  // ---- reading the player -----------------------------------------------------------

  safe(fn, fallback) {
    try {
      return this.player ? fn(this.player) : fallback;
    } catch {
      return fallback;
    }
  }

  currentTime() {
    return this.safe((p) => p.getCurrentTime(), 0) || 0;
  }

  playerState() {
    return this.safe((p) => p.getPlayerState(), YTS.UNSTARTED);
  }

  duration() {
    return this.safe((p) => p.getDuration(), 0) || 0;
  }

  rate() {
    return this.safe((p) => p.getPlaybackRate(), 1) || 1;
  }

  availableRates() {
    return this.safe((p) => p.getAvailablePlaybackRates(), [1]) || [1];
  }

  /** Expected position right now, clamped to the video length when known. */
  expected() {
    const pos = expectedPosition(this.serverState, serverNow());
    const d = this.duration();
    return d > 0 ? Math.min(pos, d) : pos;
  }

  effectivePlaying(now = clientNow()) {
    if (this.intent && now < this.intent.until) return this.intent.playing;
    return Boolean(this.serverState?.playing);
  }

  // ---- programmatic commands (all attributed) ----------------------------------------

  command(kind) {
    this.cmd[kind] = clientNow();
  }

  /** Records a seek we are about to make so the seek detector doesn't report it. */
  markProgrammaticSeek(target, ms = 1500) {
    const now = clientNow();
    this.programmatic = { target, at: now, until: now + ms };
    this.lastSeekOrPlayAt = now;
    this.lastPoll = null;
  }

  doSeek(target) {
    this.markProgrammaticSeek(target);
    // Attribute exactly the events this seek can cause. While playing: BUFFERING -> PLAYING
    // (and possibly a PAUSED blip). While paused: it stays paused. From cued/unstarted/ended:
    // seekTo() starts playback.
    const ys = this.playerState();
    if (ys === YTS.PAUSED) this.command('pause');
    else {
      this.command('play');
      if (playingLike(ys)) this.command('pause');
    }
    this.safe((pl) => pl.seekTo(target, true));
  }

  doPlay() {
    this.command('play');
    this.cmd.pause = -Infinity; // a newer play supersedes any pending pause attribution
    this.lastSeekOrPlayAt = clientNow();
    this.safe((pl) => pl.playVideo());
  }

  doPause() {
    this.command('pause');
    this.cmd.play = -Infinity; // the BUFFERING/PLAYING of an earlier command will not complete
    this.safe((pl) => pl.pauseVideo());
  }

  // ---- applying remote state --------------------------------------------------------

  /**
   * Apply a "playback:state" from the server. States with seq <= the last applied one are
   * ignored (out of order or duplicate), unless `force` (a fresh snapshot after a rejoin).
   */
  applyState(state, { force = false } = {}) {
    if (!state) return false;
    if (!force && typeof state.seq === 'number' && state.seq <= this.lastSeq) {
      this.log({ kind: 'ignored-stale', seq: state.seq, lastSeq: this.lastSeq });
      return false;
    }
    this.serverState = state;
    this.lastSeq = state.seq;
    this.intent = null;
    this.reconcileCount = 0;
    if (this.player) this.sync('remote');
    this.notify();
    return true;
  }

  /** Brings the player in line with serverState. Everything it does is attributed to us. */
  sync(reason) {
    const st = this.serverState;
    const p = this.player;
    if (!st || !p) return;
    clearTimeout(this.timers.pendingPause);

    if (!st.videoId) {
      if (this.currentVideoId) this.safe((pl) => pl.stopVideo());
      this.currentVideoId = null;
      return;
    }

    const expected = this.expected();
    if (st.videoId !== this.currentVideoId) {
      this.currentVideoId = st.videoId;
      this.markProgrammaticSeek(expected);
      const args = { videoId: st.videoId, startSeconds: expected };
      if (st.playing) {
        this.command('play');
        this.safe((pl) => pl.loadVideoById(args));
      } else {
        this.command('pause');
        this.safe((pl) => pl.cueVideoById(args));
      }
      this.log({ kind: 'load', reason, videoId: st.videoId, expected, playing: st.playing });
    } else {
      const ys = this.playerState();
      const cur = this.currentTime();
      // Paused: be exact (seeking a paused video is invisible). Playing: small offsets are left
      // to the drift loop, which can fix them smoothly instead of with a visible jump.
      const threshold = st.playing ? SYNC.APPLY_SEEK_THRESHOLD : SYNC.PAUSED_SEEK_THRESHOLD;
      const atEnd = ys === YTS.ENDED && expected >= this.duration() - 1;
      const needSeek = Math.abs(cur - expected) > threshold && !atEnd;
      if (!st.playing && (ys === YTS.CUED || ys === YTS.UNSTARTED)) {
        // seekTo() on a cued video starts playback, so re-cue at the right spot instead.
        if (needSeek) {
          this.markProgrammaticSeek(expected);
          this.command('pause');
          this.safe((pl) => pl.cueVideoById({ videoId: st.videoId, startSeconds: expected }));
        }
      } else if (needSeek) {
        this.doSeek(expected);
      }
      const ysNow = this.playerState();
      if (st.playing && !playingLike(ysNow) && ys !== YTS.ENDED) this.doPlay();
      else if (!st.playing && playingLike(ysNow)) this.doPause();
      this.log({ kind: 'apply', reason, seq: st.seq, expected, cur, seeked: needSeek, playing: st.playing });
    }
    this.scheduleAutoplayCheck();
    this.scheduleReconcile();
  }

  scheduleReconcile(delay = SYNC.CMD_WINDOW_MS + 50) {
    clearTimeout(this.timers.reconcile);
    this.timers.reconcile = setTimeout(() => {
      const st = this.serverState;
      if (!st?.videoId || !this.player) return;
      const ys = this.playerState();
      const now = clientNow();
      if (this.intent && now < this.intent.until) return; // our own action is in flight
      const playMismatch = ys !== YTS.ENDED && st.playing !== playingLike(ys);
      const posMismatch = !st.playing && Math.abs(this.currentTime() - this.expected()) > SYNC.PAUSED_SEEK_THRESHOLD;
      if ((playMismatch || posMismatch) && this.reconcileCount < SYNC.RECONCILE_MAX) {
        this.reconcileCount += 1;
        this.log({ kind: 'reconcile', playMismatch, posMismatch, n: this.reconcileCount });
        this.sync('reconcile');
      } else if (!playMismatch && !posMismatch) {
        this.reconcileCount = 0;
      }
    }, delay);
  }

  scheduleAutoplayCheck() {
    clearTimeout(this.timers.autoplay);
    if (!this.serverState?.playing) {
      this.setAutoplayBlocked(false);
      return;
    }
    this.timers.autoplay = setTimeout(() => {
      const ys = this.playerState();
      const stuck = this.serverState?.playing && !playingLike(ys) && ys !== YTS.ENDED;
      this.setAutoplayBlocked(Boolean(stuck));
    }, SYNC.AUTOPLAY_CHECK_MS);
  }

  setAutoplayBlocked(value) {
    if (this.autoplayBlocked === value) return;
    this.autoplayBlocked = value;
    this.onAutoplayBlocked(value);
    this.notify();
  }

  /** Called from the "Click to join playback" button: a user gesture, so play is allowed. */
  joinPlaybackFromGesture() {
    if (!this.player) return;
    this.doSeek(this.expected());
    this.doPlay();
    setTimeout(() => this.sync('gesture'), 300);
  }

  // ---- local user actions -----------------------------------------------------------

  onStateChange(ys) {
    if (ys === YTS.PLAYING) this.setAutoplayBlocked(false);
    if (ys === YTS.ENDED) this.onEnded(this.serverState);
    if (!this.serverState?.videoId) return;
    const now = clientNow();
    const roomPlaying = this.effectivePlaying(now);

    if (playingLike(ys)) {
      if (roomPlaying) return; // matches the room: nothing to report
      if (now - this.cmd.play < SYNC.CMD_WINDOW_MS) {
        this.log({ kind: 'ours', ys });
        if (ys === YTS.PLAYING) this.cmd.play = -Infinity; // consumed: our command completed
        this.scheduleReconcile();
        return;
      }
      if (ys === YTS.PLAYING) this.localAction('play');
    } else if (ys === YTS.PAUSED) {
      if (!roomPlaying) return;
      if (now - this.cmd.pause < SYNC.CMD_WINDOW_MS) {
        this.log({ kind: 'ours', ys });
        this.cmd.pause = -Infinity; // consumed
        this.scheduleReconcile();
        return;
      }
      // A PAUSED blip can be the start of a scrub: check for a jump first, then defer.
      if (this.checkSeek()) return;
      clearTimeout(this.timers.pendingPause);
      this.timers.pendingPause = setTimeout(() => {
        if (this.playerState() !== YTS.PAUSED) return;
        if (clientNow() - this.cmd.pause < SYNC.CMD_WINDOW_MS) return;
        if (this.effectivePlaying()) this.localAction('pause');
      }, SYNC.PAUSE_DEFER_MS);
    }
  }

  /** Space bar. */
  togglePlay() {
    if (!this.serverState?.videoId) return;
    if (!this.canControl) return this.onBlockedAction();
    const playing = this.effectivePlaying();
    // Mark the command as ours so the resulting state event isn't reported a second time.
    if (playing) this.doPause();
    else this.doPlay();
    this.localAction(playing ? 'pause' : 'play');
  }

  seekLocal(position) {
    if (!this.canControl) return this.onBlockedAction();
    this.doSeek(position);
    this.localAction('seek', position);
  }

  localAction(type, position = this.currentTime()) {
    if (!this.canControl) {
      // Host-only mode: undo whatever the user did in the iframe and tell them why.
      this.onBlockedAction();
      setTimeout(() => this.sync('revert'), 50);
      return;
    }
    const now = clientNow();
    if (type === 'play' || type === 'pause') {
      this.intent = { playing: type === 'play', until: now + 1500 };
    }
    this.lastSeekOrPlayAt = now;
    const payload = { type, position: Math.max(0, Math.round(position * 1000) / 1000), clientSeq: this.lastSeq };
    this.log({ kind: 'local', ...payload });
    this.emitAction(payload);
  }

  // ---- seek detection ---------------------------------------------------------------

  /**
   * The YouTube API has no "seeked" event. Every POLL_MS we predict where the video should be
   * (advancing only if it was and still is PLAYING) and treat a jump > SEEK_DETECT_THRESHOLD as
   * a user seek. Jumps we caused ourselves are recognised by their destination: a jump that
   * lands near the target of our last programmatic seek (within its window) is ours; a jump
   * landing anywhere else is the user's.
   */
  checkSeek() {
    if (!this.player || !this.serverState?.videoId) return false;
    const now = clientNow();
    const t = this.currentTime();
    const ys = this.playerState();
    const rate = this.rate();
    const last = this.lastPoll;
    this.lastPoll = { t, at: now, ys, rate };
    if (!last) return false;
    if (ys === YTS.UNSTARTED || ys === YTS.CUED || ys === YTS.ENDED) return false;
    const advancing = last.ys === YTS.PLAYING && ys === YTS.PLAYING;
    const predicted = advancing ? last.t + ((now - last.at) / 1000) * last.rate : last.t;
    if (Math.abs(t - predicted) <= SYNC.SEEK_DETECT_THRESHOLD) return false;
    const ours = this.programmatic;
    if (ours && now < ours.until) {
      const slack = SYNC.SEEK_DETECT_THRESHOLD + (now - ours.at) / 1000;
      if (Math.abs(t - ours.target) <= slack) return false;
    }
    clearTimeout(this.timers.pendingPause);
    this.log({ kind: 'seek-detected', from: predicted, to: t });
    this.localAction('seek', t);
    return true;
  }

  // ---- used by drift correction / debug tools ---------------------------------------

  /**
   * Hard sync. `lead` (seconds) compensates for the time the player needs to resume after a
   * seek (buffering), which the drift loop learns from the residual after each hard seek.
   */
  hardSeekToExpected(lead = 0) {
    const pos = this.expected() + (this.serverState?.playing ? lead : 0);
    this.doSeek(pos);
    return pos;
  }

  setRate(rate) {
    this.safe((pl) => pl.setPlaybackRate(rate));
  }

  /** Debug: push the local player off by `seconds` WITHOUT telling the server. */
  injectDrift(seconds) {
    const target = Math.max(0, this.currentTime() + seconds);
    this.doSeek(target);
    return target;
  }
}
