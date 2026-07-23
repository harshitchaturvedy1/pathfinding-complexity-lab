/**
 * PlaybackController — drives a captured frame list at variable speed
 * using `requestAnimationFrame`.  Designed so that the *recorded*
 * metrics from the benchmarker (nodesExpanded, µs) never re-run —
 * every visible change just reads `frames[stepIdx]`.
 *
 * Two views (e.g. Dijkstra | A*) share a single step counter through
 * a shared `onFrame(stepIdx)` callback.  The engine clamps the shared
 * counter to min(|framesA|, |framesB|) so algorithms with different
 * length still appear synchronized at the end.
 */

const MIN_SPEED = 0.5;       // steps/sec
const MAX_SPEED = 600;       // steps/sec — easily saturates rAF

export class PlaybackController {
  /**
   * @param {{onFrame:(idx:number)=>void, onEnd?:()=>void}} opts
   */
  constructor({ onFrame, onEnd }) {
    this.frames = [];
    this.onFrame = onFrame;
    this.onEnd = onEnd;

    this.stepIdx = 0;
    this.playing = false;
    this.speedStepsPerSec = 30;     // 30 steps/sec feels like a brisk visualizer

    this._lastTs = 0;
    this._acc = 0;
    this._rafId = null;
    this._maxIdx = 0;
  }

  /** Replace the loaded frame list and reset to start. */
  setFrames(frames) {
    this.frames = frames;
    this._maxIdx = Math.max(0, frames.length - 1);
    this.stepIdx = 0;
    this._acc = 0;
    this._emit();
  }

  setSpeed(stepsPerSec) {
    const v = Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(stepsPerSec) || 30));
    this.speedStepsPerSec = v;
  }

  play() {
    if (this.playing) return;
    if (this.frames.length === 0) return;
    if (this.stepIdx >= this._maxIdx) {
      this.stepIdx = 0;
      this._emit();
    }
    this.playing = true;
    this._lastTs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._acc = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  pause() {
    this.playing = false;
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  toggle() { (this.playing ? this.pause() : this.play()); }

  stepForward(steps = 1) {
    this.pause();
    this.stepIdx = Math.min(this._maxIdx, this.stepIdx + steps);
    this._emit();
  }

  stepBack(steps = 1) {
    this.pause();
    this.stepIdx = Math.max(0, this.stepIdx - steps);
    this._emit();
  }

  jumpToStart() {
    this.pause();
    this.stepIdx = 0;
    this._emit();
  }

  jumpToEnd() {
    this.pause();
    this.stepIdx = this._maxIdx;
    this._emit();
  }

  reset() {
    this.pause();
    this.stepIdx = 0;
    this._acc = 0;
    this._emit();
  }

  destroy() {
    this.pause();
    this.frames = [];
    this.onFrame = () => {};
    this.onEnd = () => {};
  }

  /* ---------------- internal ---------------- */

  _emit() {
    if (typeof this.onFrame === 'function') {
      this.onFrame(this.stepIdx);
    }
  }

  _tick = () => {
    if (!this.playing) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = Math.min(1000 / 30, now - this._lastTs); // clamp huge dt (tab unfocus)
    this._lastTs = now;
    this._acc += dt;

    const msPerStep = 1000 / this.speedStepsPerSec;
    let advanced = 0;
    while (this._acc >= msPerStep && this.stepIdx < this._maxIdx) {
      this._acc -= msPerStep;
      this.stepIdx++;
      advanced++;
      // Cap the per-frame burst so a 5-second unfocus doesn't burn ~300 frames in a tick.
      if (advanced > 6) break;
    }

    if (advanced > 0) this._emit();

    if (this.stepIdx >= this._maxIdx) {
      this.pause();
      if (typeof this.onEnd === 'function') this.onEnd();
      return;
    }
    this._rafId = requestAnimationFrame(this._tick);
  };
}

/**
 * Synchronizer — wraps a single PlaybackController and broadcasts steps
 * to a list of named viewers.  Useful for the dual-canvas layout.
 */
export class SynchronizedPlayback {
  /**
   * @param {Record<string, {frames:any[]}>} viewers  e.g. { dijkstra: {...}, astar: {...} }
   */
  constructor(viewers) {
    this.viewers = viewers;
    /** @type {Array<(idx:number, view:string, frame:any)=>void>} */
    this._subscribers = [];

    this.controller = new PlaybackController({
      onFrame: (idx) => this._broadcast(idx),
      onEnd: () => this._broadcastEnd()
    });

    this.setFrames(this._collectFrames());
  }

  _collectFrames() {
    // We use the longest sequence as the bound.  Each viewer reads its
    // own frames[i] clamped to its own length.
    let max = 0;
    for (const k of Object.keys(this.viewers)) {
      max = Math.max(max, (this.viewers[k].frames || []).length);
    }
    this._totalSteps = max;
    return Array.from({ length: max }, (_, i) => i);
  }

  setFrames() {
    const seq = this._collectFrames();
    this.controller.setFrames(seq);
  }

  subscribe(cb) {
    this._subscribers.push(cb);
    return () => {
      const i = this._subscribers.indexOf(cb);
      if (i >= 0) this._subscribers.splice(i, 1);
    };
  }

  setSpeed(s) { this.controller.setSpeed(s); }
  play() { this.controller.play(); }
  pause() { this.controller.pause(); }
  toggle() { this.controller.toggle(); }
  stepForward() { this.controller.stepForward(1); }
  stepBack() { this.controller.stepBack(1); }
  jumpToStart() { this.controller.jumpToStart(); }
  jumpToEnd() { this.controller.jumpToEnd(); }
  reset() { this.controller.reset(); }

  _broadcast(idx) {
    for (const sub of this._subscribers) {
      // Each subscriber decides how to map idx→frame for that view.
      sub(idx);
    }
  }

  _broadcastEnd() {
    // No-op for now (could fire a toast).
  }

  destroy() {
    this.controller.destroy();
    this._subscribers.length = 0;
    this.viewers = null;
  }
}
