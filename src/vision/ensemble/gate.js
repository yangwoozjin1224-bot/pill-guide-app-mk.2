/**
 * Phase 5: conditional multi-frame ensemble config + trigger.
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

export function getEnsembleConfig() {
  return {
    enabled: envBool("VITE_ENSEMBLE_ENABLED", true),
    minConf: envNum("VITE_ENSEMBLE_MIN_CONF", 0.55),
    frames: Math.max(2, Math.floor(envNum("VITE_ENSEMBLE_FRAMES", 3))),
    timeoutMs: Math.max(2000, Math.floor(envNum("VITE_ENSEMBLE_TIMEOUT_MS", 8000))),
  };
}

/**
 * Return true when we should collect more angles/frames before finalizing.
 * High-confidence exact/partial imprint matches skip ensemble.
 *
 * @param {object} det - single detection result from imprint pipeline
 */
export function shouldRequestEnsemble(det, config = getEnsembleConfig()) {
  if (!config.enabled) return false;
  if (!det?.best) return false;

  const conf = Number(det.fusedConfidence ?? det.best.fusedScore ?? det.best.confidence ?? 0);
  const tier = String(det.matchTier || det.best.matchTier || "");
  const source = String(det.matchSource || det.best.matchSource || "");

  // Strong imprint hits — no extra frames
  if ((tier === "exact" || tier === "partial") && conf >= config.minConf) {
    return false;
  }

  // Always ensemble weak / ambiguous / prior / color-only / llm fallback
  if (
    tier === "color_shape" ||
    tier === "prescription_prior" ||
    tier === "weak" ||
    tier === "fallback" ||
    source === "fallback_llm" ||
    det.ambiguous ||
    det.lowAccuracy
  ) {
    return true;
  }

  return conf < config.minConf;
}

/**
 * Summarize a detection into a vote slot (no canvas — lightweight).
 */
export function detectionToVote(det) {
  if (!det?.best) return null;
  const best = det.best;
  return {
    name: best.name || best.itemName || best.ITEM_NAME || "",
    itemSeq: String(best.itemSeq || best.ITEM_SEQ || ""),
    confidence: Number(det.fusedConfidence ?? best.fusedScore ?? best.confidence ?? 0),
    mark: det.mark || det.imprintFront || best.mark || "",
    tier: det.matchTier || best.matchTier || "",
    matchSource: det.matchSource || best.matchSource || null,
    color: det.color || "",
    shape: det.shape || "",
    ts: Date.now(),
  };
}
