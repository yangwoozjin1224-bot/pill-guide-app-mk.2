/**
 * Live capture quality gate — runs before OCR/API.
 */

import {
  computeQualityMetrics,
  getQualityThresholds,
  isQualityGateEnabled,
} from "./metrics.js";
import { messagesForReasons } from "./messages.js";

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ mode?: 'pill'|'document', thresholds?: object }} options
 * @returns {{
 *   ok: boolean,
 *   score: number,
 *   checks: object,
 *   reasons: string[],
 *   messages: string[],
 *   softWarnings: string[],
 *   metrics: object,
 *   skipped?: boolean
 * }}
 */
export function evaluateCaptureQuality(canvas, options = {}) {
  if (!isQualityGateEnabled()) {
    return {
      ok: true,
      score: 1,
      checks: {},
      reasons: [],
      messages: [],
      softWarnings: [],
      metrics: {},
      skipped: true,
    };
  }

  const mode = options.mode || "pill";
  const t = { ...getQualityThresholds(), ...(options.thresholds || {}) };

  // Document mode: slightly looser blur, tighter framing not required the same way
  const blurMin = mode === "document" ? t.blurMin * 0.75 : t.blurMin;
  const framingMin = mode === "document" ? Math.min(0.04, t.framingMin) : t.framingMin;

  const metrics = computeQualityMetrics(canvas, options);
  const reasons = [];
  const soft = [];

  const checks = {
    blur: metrics.blur >= blurMin,
    exposure:
      metrics.mean >= t.brightMin &&
      metrics.mean <= t.brightMax &&
      metrics.darkRatio < 0.55 &&
      metrics.brightRatio < 0.45,
    framing: metrics.framing >= framingMin,
  };

  if (!checks.blur) reasons.push("blur");
  if (metrics.mean < t.brightMin || metrics.darkRatio >= 0.55) reasons.push("dark");
  else if (metrics.mean > t.brightMax || metrics.brightRatio >= 0.45) reasons.push("bright");
  if (!checks.framing) reasons.push("framing");

  if (mode === "pill" && metrics.overlapSuspected && metrics.overlapFill > t.overlapMaxFill) {
    // Soft warning by default — does not block (overlap heuristic is coarse)
    soft.push("overlap");
  }

  // Score 0..1
  const blurScore = Math.min(1, metrics.blur / Math.max(blurMin, 1));
  const expScore =
    metrics.mean < t.brightMin
      ? metrics.mean / Math.max(t.brightMin, 1)
      : metrics.mean > t.brightMax
        ? Math.max(0, 1 - (metrics.mean - t.brightMax) / 40)
        : 1;
  const score = Math.max(0, Math.min(1, 0.4 * blurScore + 0.35 * expScore + 0.25 * metrics.framing));

  const ok = reasons.length === 0;

  return {
    ok,
    score,
    checks,
    reasons,
    messages: messagesForReasons(reasons),
    softWarnings: messagesForReasons(soft),
    metrics,
  };
}

/**
 * Throttle helper for live UI message updates.
 */
export function createMessageThrottle(intervalMs = 400) {
  let last = 0;
  let lastText = "";
  return (text) => {
    const now = Date.now();
    if (text === lastText && now - last < intervalMs) return null;
    if (now - last < intervalMs) return null;
    last = now;
    lastText = text;
    return text;
  };
}
