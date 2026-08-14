/**
 * On-device capture quality metrics (no network).
 * Pure functions — independently testable.
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

export function getQualityThresholds() {
  return {
    blurMin: envNum("VITE_QUALITY_BLUR_MIN", 80),
    brightMin: envNum("VITE_QUALITY_BRIGHT_MIN", 45),
    brightMax: envNum("VITE_QUALITY_BRIGHT_MAX", 210),
    framingMin: envNum("VITE_QUALITY_FRAMING_MIN", 0.08),
    overlapMaxFill: envNum("VITE_QUALITY_OVERLAP_MAX_FILL", 0.55),
  };
}

export function isQualityGateEnabled() {
  try {
    const v = typeof import.meta !== "undefined" && import.meta.env?.VITE_QUALITY_GATE_ENABLED;
    if (v === "false" || v === "0") return false;
  } catch {
    /* ignore */
  }
  return true;
}

/** Downscale for speed; returns { gray: Float32Array|Uint8Array, w, h, rgba optional } */
export function canvasToGray(canvas, maxSide = 320) {
  if (!canvas?.getContext) return null;
  const sw = canvas.width;
  const sh = canvas.height;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(16, Math.round(sw * scale));
  const h = Math.max(16, Math.round(sh * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, w, h, rgba: data };
}

/** Laplacian variance — higher = sharper */
export function laplacianVariance(gray, w, h) {
  if (!gray || w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        -4 * gray[i] +
        gray[i - 1] +
        gray[i + 1] +
        gray[i - w] +
        gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean brightness + under/over exposure ratios (0..1) */
export function exposureStats(gray) {
  if (!gray?.length) return { mean: 0, darkRatio: 1, brightRatio: 0 };
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    sum += v;
    if (v < 40) dark += 1;
    if (v > 240) bright += 1;
  }
  const n = gray.length;
  return {
    mean: sum / n,
    darkRatio: dark / n,
    brightRatio: bright / n,
  };
}

/**
 * Framing: contrast between center ROI and border.
 * Low center activity vs bright/dark wash → poor framing.
 */
export function framingScore(gray, w, h) {
  if (!gray || w < 8 || h < 8) return 0;
  const x0 = Math.floor(w * 0.2);
  const x1 = Math.floor(w * 0.8);
  const y0 = Math.floor(h * 0.2);
  const y1 = Math.floor(h * 0.8);

  let cSum = 0;
  let cN = 0;
  let cVar = 0;
  const cVals = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const v = gray[y * w + x];
      cSum += v;
      cVals.push(v);
      cN += 1;
    }
  }
  const cMean = cSum / Math.max(1, cN);
  for (const v of cVals) cVar += (v - cMean) ** 2;
  cVar = cVar / Math.max(1, cN);

  // Foreground-ish: pixels far from border mean
  let bSum = 0;
  let bN = 0;
  for (let x = 0; x < w; x += 3) {
    bSum += gray[x] + gray[(h - 1) * w + x];
    bN += 2;
  }
  for (let y = 0; y < h; y += 3) {
    bSum += gray[y * w] + gray[y * w + (w - 1)];
    bN += 2;
  }
  const bMean = bSum / Math.max(1, bN);

  let fg = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      if (Math.abs(gray[y * w + x] - bMean) > 28) fg += 1;
    }
  }
  const fgRatio = fg / Math.max(1, cN);
  // Combine variance (texture) + fg ratio
  const texture = Math.min(1, cVar / 800);
  return Math.min(1, 0.45 * texture + 0.55 * fgRatio);
}

/**
 * Rough overlap hint: single huge dark/contrasting blob fill of center.
 * Returns { suspected: boolean, fill: number }
 */
export function overlapHint(gray, w, h) {
  if (!gray || w < 8 || h < 8) return { suspected: false, fill: 0 };
  let bSum = 0;
  let bN = 0;
  for (let x = 0; x < w; x += 4) {
    bSum += gray[x] + gray[(h - 1) * w + x];
    bN += 2;
  }
  const bMean = bSum / Math.max(1, bN);
  let fg = 0;
  let total = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      total += 1;
      if (Math.abs(gray[y * w + x] - bMean) > 32) fg += 1;
    }
  }
  const fill = fg / Math.max(1, total);
  return { suspected: fill > 0.55, fill };
}

/**
 * Compute all metrics from a canvas (or precomputed gray).
 */
export function computeQualityMetrics(canvas, options = {}) {
  const g = options.grayPack || canvasToGray(canvas, options.maxSide || 320);
  if (!g) {
    return { blur: 0, mean: 0, darkRatio: 1, brightRatio: 0, framing: 0, overlapFill: 0 };
  }
  const blur = laplacianVariance(g.gray, g.w, g.h);
  const exp = exposureStats(g.gray);
  const framing = framingScore(g.gray, g.w, g.h);
  const ov = overlapHint(g.gray, g.w, g.h);
  return {
    blur,
    mean: exp.mean,
    darkRatio: exp.darkRatio,
    brightRatio: exp.brightRatio,
    framing,
    overlapFill: ov.fill,
    overlapSuspected: ov.suspected,
  };
}
