/**
 * Adaptive performance profile for low / mid / high-end devices.
 * Used by camera, capture, OCR, and document paths.
 */

let cached = null;

function envTierOverride() {
  try {
    const v =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_PERF_TIER;
    if (v === "low" || v === "mid" || v === "high") return v;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Heuristic tier: prefer navigator.deviceMemory / cores / Save-Data.
 * Defaults to "mid" when signals are missing (desktop browsers often omit deviceMemory).
 */
export function detectDeviceTier() {
  const override = envTierOverride();
  if (override) return override;

  try {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (!nav) return "mid";

    const mem = Number(nav.deviceMemory) || 0; // GiB, Chrome/Android
    const cores = Number(nav.hardwareConcurrency) || 4;
    const saveData = Boolean(nav.connection?.saveData);
    const slowNet =
      nav.connection &&
      (nav.connection.effectiveType === "2g" ||
        nav.connection.effectiveType === "slow-2g");

    if (saveData || slowNet) return "low";
    if (mem > 0 && mem <= 2) return "low";
    if (mem > 0 && mem <= 4 && cores <= 4) return "low";
    if (cores <= 2) return "low";
    if (mem >= 8 && cores >= 6) return "high";
    return "mid";
  } catch {
    return "mid";
  }
}

const PROFILES = {
  low: {
    tier: "low",
    cameraWidth: 640,
    cameraHeight: 480,
    captureSize: 480,
    qualityMaxSide: 160,
    tickMs: 280,
    tickRetryMs: 220,
    tickFailMs: 320,
    maxInstances: 2,
    topK: 3,
    docMaxSide: 720,
    docOutWidth: 720,
    deskewLite: true,
    ocrCropMax: 224,
    warmOcrIdle: true,
    includeMasks: false,
  },
  mid: {
    tier: "mid",
    cameraWidth: 960,
    cameraHeight: 540,
    captureSize: 640,
    qualityMaxSide: 240,
    tickMs: 160,
    tickRetryMs: 140,
    tickFailMs: 200,
    maxInstances: 3,
    topK: 5,
    docMaxSide: 960,
    docOutWidth: 900,
    deskewLite: false,
    ocrCropMax: 280,
    warmOcrIdle: true,
    includeMasks: false,
  },
  high: {
    tier: "high",
    cameraWidth: 1280,
    cameraHeight: 720,
    captureSize: 640,
    qualityMaxSide: 320,
    tickMs: 120,
    tickRetryMs: 100,
    tickFailMs: 150,
    maxInstances: 3,
    topK: 5,
    docMaxSide: 1280,
    docOutWidth: 1000,
    deskewLite: false,
    ocrCropMax: 320,
    warmOcrIdle: false,
    includeMasks: true,
  },
};

/** @returns {typeof PROFILES.mid} */
export function getDeviceProfile(forceRefresh = false) {
  if (!forceRefresh && cached) return cached;
  const tier = detectDeviceTier();
  cached = { ...PROFILES[tier] };
  return cached;
}

export function resetDeviceProfileCache() {
  cached = null;
}

/** Camera constraints sized for the device tier. */
export function getCameraVideoConstraints(profile = getDeviceProfile()) {
  return {
    facingMode: { ideal: "environment" },
    width: { ideal: profile.cameraWidth },
    height: { ideal: profile.cameraHeight },
  };
}
