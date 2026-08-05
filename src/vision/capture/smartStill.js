/**
 * Smart still capture: Method B (quality threshold) + Method C (local maximum).
 *
 * Preview stays live; stills are kept only in memory (not shown in UI).
 * Independently testable without full camera stack.
 */

function envNum(key, fallback) {
  try {
    const v = typeof import.meta !== "undefined" && import.meta.env?.[key];
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function envBool(key, fallback = true) {
  try {
    const v = typeof import.meta !== "undefined" && import.meta.env?.[key];
    if (v === "false" || v === "0") return false;
    if (v === "true" || v === "1") return true;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function getSmartStillConfig() {
  return {
    enabled: envBool("VITE_SMART_STILL_ENABLED", true),
    maxStills: Math.max(1, Math.floor(envNum("VITE_SMART_STILL_MAX", 3))),
    /** Method B: minimum quality.score (0..1) to allow a capture */
    minScore: envNum("VITE_SMART_STILL_MIN_SCORE", 0.42),
    /** Min ms between two silent captures */
    minIntervalMs: Math.max(100, Math.floor(envNum("VITE_SMART_STILL_MIN_INTERVAL_MS", 320))),
    /** Give up waiting and use whatever we have */
    timeoutMs: Math.max(1000, Math.floor(envNum("VITE_SMART_STILL_TIMEOUT_MS", 2800))),
    /** Warmup before first capture */
    warmupMs: Math.max(0, Math.floor(envNum("VITE_SMART_STILL_WARMUP_MS", 350))),
  };
}

/**
 * Pure helper: is index `peakIdx` a local maximum in scoreHistory?
 * Method C.
 */
export function isLocalMaxAt(scoreHistory, peakIdx) {
  if (!scoreHistory?.length || peakIdx < 0 || peakIdx >= scoreHistory.length) return false;
  const v = scoreHistory[peakIdx];
  const left = peakIdx > 0 ? scoreHistory[peakIdx - 1] : -Infinity;
  const right = peakIdx < scoreHistory.length - 1 ? scoreHistory[peakIdx + 1] : -Infinity;
  return v >= left && v >= right;
}

/**
 * Method B+C decision (pure):
 * - B: peakScore >= minScore AND qualityOk at peak
 * - C: peak is local max among last 3 samples (when we have 3)
 *
 * Called when we just appended a new score; we evaluate the *previous* sample as potential peak.
 */
export function shouldCaptureAtPrevious(scoreHistory, qualityOkHistory, { minScore = 0.42 } = {}) {
  const n = scoreHistory.length;
  if (n < 2) return false;
  const peakIdx = n - 2; // previous sample
  if (!qualityOkHistory[peakIdx]) return false;
  const peakScore = scoreHistory[peakIdx];
  if (peakScore < minScore) return false; // B
  if (n >= 3) {
    return isLocalMaxAt(scoreHistory, peakIdx); // C with neighbors
  }
  // Only 2 samples: allow if previous >= current (started falling = peak) and B ok
  return peakScore >= scoreHistory[n - 1];
}

function cloneCanvas(source) {
  if (!source?.getContext) return null;
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  c.getContext("2d").drawImage(source, 0, 0);
  return c;
}

/**
 * Silent still buffer driven by live quality scores.
 */
export class SmartStillCapture {
  constructor(config = getSmartStillConfig()) {
    this.config = config;
    this.stills = []; // { canvas, score, metrics, ts, previewCount? }
    this.scoreHistory = [];
    this.okHistory = [];
    this.frameHistory = []; // clone of last few frames for peak capture
    this.startedAt = 0;
    this.lastCaptureAt = 0;
    this.previewCounts = []; // lightweight object-count estimates from preview
  }

  reset() {
    this.stills = [];
    this.scoreHistory = [];
    this.okHistory = [];
    this.frameHistory = [];
    this.startedAt = 0;
    this.lastCaptureAt = 0;
    this.previewCounts = [];
  }

  start() {
    this.reset();
    this.startedAt = Date.now();
  }

  ensureStarted() {
    if (!this.startedAt) this.start();
  }

  /**
   * @param {HTMLCanvasElement} frame
   * @param {{ ok: boolean, score: number, metrics?: object }} quality
   * @param {{ previewObjectCount?: number }} extras
   */
  observe(frame, quality, extras = {}) {
    if (!this.config.enabled) {
      return { captured: false, ready: true, skipped: true, stills: this.stills };
    }
    this.ensureStarted();

    const now = Date.now();
    const elapsed = now - this.startedAt;
    const score = Number(quality?.score) || 0;
    const ok = Boolean(quality?.ok);

    this.scoreHistory.push(score);
    this.okHistory.push(ok);
    if (this.scoreHistory.length > 12) {
      this.scoreHistory.shift();
      this.okHistory.shift();
    }

    // Keep short frame ring for peak capture (previous frame)
    const cloned = cloneCanvas(frame);
    this.frameHistory.push(cloned);
    if (this.frameHistory.length > 3) this.frameHistory.shift();

    if (typeof extras.previewObjectCount === "number") {
      this.previewCounts.push(extras.previewObjectCount);
      if (this.previewCounts.length > 20) this.previewCounts.shift();
    }

    let captured = false;

    if (
      elapsed >= this.config.warmupMs &&
      this.stills.length < this.config.maxStills &&
      now - this.lastCaptureAt >= this.config.minIntervalMs &&
      shouldCaptureAtPrevious(this.scoreHistory, this.okHistory, {
        minScore: this.config.minScore,
      })
    ) {
      // Capture the peak frame (previous), not the current declining one
      const peakFrame = this.frameHistory[this.frameHistory.length - 2] || cloned;
      const peakScore = this.scoreHistory[this.scoreHistory.length - 2] ?? score;
      if (peakFrame) {
        this.stills.push({
          canvas: peakFrame,
          score: peakScore,
          metrics: quality?.metrics || null,
          ts: now,
          method: "B+C",
        });
        this.lastCaptureAt = now;
        captured = true;
      }
    }

    return {
      captured,
      ...this.status(),
    };
  }

  status() {
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;
    const timedOut = elapsed >= this.config.timeoutMs;
    const full = this.stills.length >= this.config.maxStills;
    return {
      stillCount: this.stills.length,
      need: this.config.maxStills,
      elapsed,
      timedOut,
      ready: full || (timedOut && this.stills.length >= 1),
      empty: this.stills.length === 0,
      stills: this.stills,
    };
  }

  /** Highest quality silent still */
  pickBest() {
    if (!this.stills.length) return null;
    return this.stills.slice().sort((a, b) => b.score - a.score)[0];
  }

  /** All stills sorted best-first */
  pickRanked() {
    return this.stills.slice().sort((a, b) => b.score - a.score);
  }

  /**
   * Modal preview object count (for cross-check with final detection count).
   */
  previewObjectCountMode() {
    if (!this.previewCounts.length) return null;
    const freq = new Map();
    for (const n of this.previewCounts) {
      freq.set(n, (freq.get(n) || 0) + 1);
    }
    let best = null;
    let bestC = -1;
    for (const [n, c] of freq) {
      if (c > bestC) {
        best = n;
        bestC = c;
      }
    }
    return best;
  }
}
