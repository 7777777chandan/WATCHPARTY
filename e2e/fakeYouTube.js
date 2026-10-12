/*
 * Test double for https://www.youtube.com/iframe_api (served by Playwright route interception).
 * Mimics the parts of the real API the app uses, including its quirks:
 *  - state events are delivered asynchronously (the real player uses postMessage)
 *  - play goes BUFFERING -> PLAYING after a short delay
 *  - seekTo() while CUED starts playback; setPlaybackRate rounds to the available list
 * Test hooks on window.__fakeYT let a test act like a user clicking inside the iframe,
 * stall the player (buffering), or make it run slightly fast/slow (drift).
 */
(function () {
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const cfg = (window.__fakeYTConfig = Object.assign({ rates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], duration: 600, bufferMs: 60, blockAutoplay: false }, window.__fakeYTConfig || {}));
  const now = () => performance.now();
  const players = [];

  class Player {
    constructor(el, opts) {
      const node = typeof el === 'string' ? document.getElementById(el) : el;
      this.el = document.createElement('div');
      this.el.className = 'fake-yt';
      this.el.style.cssText = 'position:absolute;inset:0;background:#123;color:#fff;font:12px monospace;padding:8px';
      node.replaceWith(this.el);
      this.events = opts.events || {};
      this.state = S.UNSTARTED;
      this.videoId = null;
      this.pos = 0;
      this.anchor = now();
      this.rate = 1;
      this.speedBias = 1; // test hook: >1 runs fast, <1 runs slow
      this.stalledUntil = 0;
      this.muted = false;
      this.gesture = false;
      this.log = [];
      players.push(this);
      this.timer = setInterval(() => this.tick(), 50);
      setTimeout(() => this.events.onReady && this.events.onReady({ target: this }), 30);
    }
    emit(state) {
      this.state = state;
      this.log.push({ t: now(), state });
      setTimeout(() => this.events.onStateChange && this.events.onStateChange({ target: this, data: state }), 5);
    }
    live() {
      if (this.state !== S.PLAYING) return this.pos;
      const start = Math.max(this.anchor, this.stalledUntil);
      const t = now();
      if (t <= start) return this.pos;
      return this.pos + ((t - start) / 1000) * this.rate * this.speedBias;
    }
    freeze() {
      this.pos = this.live();
      this.anchor = now();
    }
    tick() {
      if (this.state === S.PLAYING && this.live() >= cfg.duration) {
        this.pos = cfg.duration;
        this.anchor = now();
        this.emit(S.ENDED);
      }
      this.el.textContent = `fake ${this.videoId || '-'} state=${this.state} t=${this.live().toFixed(2)} rate=${this.rate}`;
    }
    startPlaying() {
      if (cfg.blockAutoplay && !this.gesture) {
        this.emit(S.UNSTARTED);
        return;
      }
      this.freeze();
      this.emit(S.BUFFERING);
      clearTimeout(this.bufTimer);
      this.bufTimer = setTimeout(() => {
        this.anchor = now();
        this.emit(S.PLAYING);
      }, cfg.bufferMs);
    }
    // --- API ---
    failIfBlocked(id) {
      // Test hook: ids listed in cfg.errorVideos behave like a non-embeddable video (error 150).
      if ((cfg.errorVideos || []).includes(id)) {
        setTimeout(() => this.events.onError && this.events.onError({ target: this, data: 150 }), 20);
        return true;
      }
      return false;
    }
    loadVideoById(a) {
      const o = typeof a === 'string' ? { videoId: a, startSeconds: arguments[1] || 0 } : a;
      this.videoId = o.videoId;
      if (this.failIfBlocked(o.videoId)) return;
      this.pos = o.startSeconds || 0;
      this.anchor = now();
      this.startPlaying();
    }
    cueVideoById(a) {
      const o = typeof a === 'string' ? { videoId: a, startSeconds: arguments[1] || 0 } : a;
      this.videoId = o.videoId;
      if (this.failIfBlocked(o.videoId)) return;
      this.pos = o.startSeconds || 0;
      this.anchor = now();
      clearTimeout(this.bufTimer);
      this.emit(S.CUED);
    }
    playVideo() {
      if (!this.videoId || this.state === S.PLAYING) return;
      this.startPlaying();
    }
    pauseVideo() {
      if (this.state !== S.PLAYING && this.state !== S.BUFFERING) return;
      this.freeze();
      clearTimeout(this.bufTimer);
      this.emit(S.PAUSED);
    }
    stopVideo() {
      this.freeze();
      this.emit(S.UNSTARTED);
    }
    seekTo(sec) {
      const wasPlaying = this.state === S.PLAYING || this.state === S.BUFFERING;
      this.pos = Math.max(0, Math.min(sec, cfg.duration));
      this.anchor = now();
      if (this.state === S.CUED || this.state === S.UNSTARTED || this.state === S.ENDED) return this.startPlaying();
      if (wasPlaying) this.startPlaying();
    }
    getCurrentTime() { return this.live(); }
    getPlayerState() { return this.state; }
    getDuration() { return this.videoId ? cfg.duration : 0; }
    getPlaybackRate() { return this.rate; }
    getAvailablePlaybackRates() { return cfg.rates.slice(); }
    setPlaybackRate(r) {
      // Real API: unsupported rates round toward 1.
      const ok = cfg.rates.includes(r) ? r : cfg.rates.reduce((b, x) => (Math.abs(x - r) < Math.abs(b - r) ? x : b), 1);
      this.freeze();
      this.rate = ok;
    }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    isMuted() { return this.muted; }
    destroy() { clearInterval(this.timer); this.el.remove(); }
    // --- test hooks (simulate the user clicking inside the iframe) ---
    userPlay() { this.gesture = true; this.startPlaying(); }
    userPause() { this.pauseVideo(); }
    userSeek(sec) { this.seekTo(sec); }
    stall(ms) { this.freeze(); this.stalledUntil = now() + ms; }
  }

  window.YT = { Player, PlayerState: S };
  window.__fakeYT = { players, S, cfg };
  setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
})();
