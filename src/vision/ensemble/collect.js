/**
 * Collect per-frame votes for ensemble fusion.
 */

import { getEnsembleConfig, detectionToVote } from "./gate.js";

export class EnsembleBuffer {
  constructor(config = getEnsembleConfig()) {
    this.config = config;
    this.frames = []; // Array<Array<vote>> — one snapshot per camera frame
    this.startedAt = 0;
    this.active = false;
  }

  start() {
    this.active = true;
    this.frames = [];
    this.startedAt = Date.now();
  }

  reset() {
    this.active = false;
    this.frames = [];
    this.startedAt = 0;
  }

  /**
   * Push detections from one pipeline run.
   * @param {Array} detections
   */
  addFrame(detections = []) {
    if (!this.active) this.start();
    const votes = (detections || []).map(detectionToVote).filter(Boolean);
    if (!votes.length) return this.status();
    this.frames.push(votes);
    return this.status();
  }

  status() {
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;
    return {
      active: this.active,
      frameCount: this.frames.length,
      need: this.config.frames,
      elapsed,
      timedOut: this.active && elapsed >= this.config.timeoutMs,
      ready: this.active && (this.frames.length >= this.config.frames || elapsed >= this.config.timeoutMs),
    };
  }

  getFrames() {
    return this.frames;
  }
}
