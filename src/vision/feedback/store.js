/**
 * Recognition feedback store (localStorage).
 *
 * PRIVACY: Never upload original images to a server without explicit user consent.
 * Default stores metadata only; imageDataUrl only when consentImageStore=true (thumbnail).
 */

const STORAGE_KEY = "pillguide:feedback";
const SCHEMA_VERSION = 1;

function envInt(key, fallback) {
  try {
    const v = typeof import.meta !== "undefined" && import.meta.env?.[key];
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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

export function getFeedbackMaxItems() {
  return envInt("VITE_FEEDBACK_MAX_ITEMS", 100);
}

export function isFeedbackImageAllowed() {
  return envBool("VITE_FEEDBACK_ALLOW_IMAGE", true);
}

function storageAvailable() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readAll() {
  if (!storageAvailable()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && e.schemaVersion === SCHEMA_VERSION);
  } catch {
    return [];
  }
}

function writeAll(list) {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota — drop oldest images first then retry */
    try {
      const slim = list.map((e) => ({ ...e, imageDataUrl: null }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

function uid() {
  return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Optionally shrink a canvas/dataUrl to a small JPEG for local review only.
 */
export function makeFeedbackThumbnail(source, { maxSide = 240, quality = 0.6 } = {}) {
  if (!isFeedbackImageAllowed()) return null;
  try {
    let canvas = source;
    if (typeof source === "string" && source.startsWith("data:")) {
      // skip async image decode in sync path — caller should pass canvas
      return source.length < 80_000 ? source : null;
    }
    if (!canvas?.getContext) return null;
    const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const w = Math.max(32, Math.round(canvas.width * scale));
    const h = Math.max(32, Math.round(canvas.height * scale));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").drawImage(canvas, 0, 0, w, h);
    return out.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

/**
 * @param {object} payload
 * @returns {object} stored entry
 */
export function addFeedback(payload = {}) {
  const consent = Boolean(payload.consentImageStore);
  // PRIVACY: without consent, never persist image bytes
  let imageDataUrl = null;
  if (consent && isFeedbackImageAllowed()) {
    imageDataUrl = payload.imageDataUrl || null;
  }

  const entry = {
    id: uid(),
    createdAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
    predicted: {
      name: payload.predicted?.name || "",
      itemSeq: payload.predicted?.itemSeq || "",
      matchSource: payload.predicted?.matchSource || null,
      confidence: Number(payload.predicted?.confidence) || 0,
      mark: payload.predicted?.mark || "",
    },
    correct: {
      name: String(payload.correct?.name || "").trim(),
      itemSeq: payload.correct?.itemSeq || "",
      source: payload.correct?.source || "manual",
    },
    consentImageStore: consent,
    imageDataUrl,
    features: payload.features || {},
    context: payload.context || {},
  };

  if (!entry.correct.name) {
    throw new Error("정답 약 이름이 필요합니다");
  }

  const max = getFeedbackMaxItems();
  const list = [entry, ...readAll()].slice(0, max);
  writeAll(list);
  return entry;
}

export function listFeedback({ limit = 50 } = {}) {
  return readAll().slice(0, limit);
}

export function clearFeedback() {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getFeedbackCount() {
  return readAll().length;
}

export { STORAGE_KEY, SCHEMA_VERSION };
