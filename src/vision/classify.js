/**
 * Classification + Re-ranking.
 * Why separated from Detection: Detector maximizes Recall; Classifier decides identity
 * using shape + color + OCR imprint + size, then re-ranks Top-5 API candidates.
 */

import { rotateCanvas } from "./detect.js";
import { preprocessForOcr, adaptiveThresholdCanvas, invertCanvas, cloneCanvas } from "./preprocess.js";

export function estimateColorLabel(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(Math.floor(w * 0.2), Math.floor(h * 0.2), Math.floor(w * 0.6), Math.floor(h * 0.6));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < img.data.length; i += 16) {
    const rr = img.data[i];
    const gg = img.data[i + 1];
    const bb = img.data[i + 2];
    if (rr + gg + bb < 70) continue;
    r += rr;
    g += gg;
    b += bb;
    n += 1;
  }
  if (!n) return { label: "", rgb: [0, 0, 0] };
  r /= n;
  g /= n;
  b /= n;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  let label = "";
  if (sat < 0.16) label = max > 200 ? "하양" : max < 90 ? "검정" : "회색";
  else if (r > 180 && g < 120 && b < 120) label = "빨강";
  else if (r > 180 && g > 100 && b < 100) label = "주황";
  else if (r > 180 && g > 150 && b < 120) label = "노랑";
  else if (r > 170 && g > 100 && b > 130) label = "분홍";
  else if (g > r && g > b) label = g > 150 ? "연두" : "초록";
  else if (b > r && b > g) label = "파랑";
  else if (r > 120 && b > 120 && g < 120) label = "보라";
  else if (r > 120 && g > 80 && b < 80) label = "갈색";
  return { label, rgb: [r, g, b] };
}

/** Compact embedding for same-pill clustering (color + shape + size + OCR hash) */
export function buildEmbedding({ rgb, shape, area, mark }) {
  const shapeMap = { 원형: 0, 타원형: 1, 장방형: 2, 캡슐형: 3, 기타: 4 };
  const markHash = [...String(mark || "")].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 97;
  return [
    (rgb?.[0] || 0) / 255,
    (rgb?.[1] || 0) / 255,
    (rgb?.[2] || 0) / 255,
    (shapeMap[shape] ?? 4) / 4,
    Math.min(1, Math.log10(1 + (area || 1)) / 5),
    markHash / 97,
  ];
}

export function embeddingDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Brightness / contrast / gamma TTA — mirrors training augmentations at inference. */
function applyLightingAug(canvas, { brightness = 0, contrast = 1, gamma = 1 } = {}) {
  const c = cloneCanvas(canvas);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const invGamma = 1 / Math.max(0.05, gamma);
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = d[i + k] / 255;
      v = (v - 0.5) * contrast + 0.5 + brightness;
      v = Math.max(0, Math.min(1, v));
      v = Math.pow(v, invGamma);
      d[i + k] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function scoreImprintVariants(worker, canvases, scoreMap) {
  for (const variant of canvases) {
    try {
      const result = await worker.recognize(variant);
      const words = result?.data?.words || [];
      if (words.length) {
        for (const w of words) {
          const raw = String(w.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (raw.length < 2 || raw.length > 14) continue;
          const conf = Number(w.confidence || 0);
          if (conf < 35) continue;
          scoreMap.set(raw, (scoreMap.get(raw) || 0) + conf + raw.length * 2);
        }
      } else {
        const text = (result?.data?.text || "").toUpperCase();
        for (const raw of text.match(/[A-Z0-9]{2,14}/g) || []) {
          scoreMap.set(raw, (scoreMap.get(raw) || 0) + 30 + raw.length);
        }
      }
    } catch {
      // continue
    }
  }
}

/**
 * OCR imprint with rotation TTA (fast realtime path).
 * thorough=true expands angles/lighting when first pass is weak.
 */
export async function extractImprintOcr(cropCanvas, worker, { thorough = false } = {}) {
  if (!worker || !cropCanvas) return { mark: "", confidence: 0, all: [] };

  const scoreMap = new Map();
  // Realtime: 0° + 180° first (most pills), then 90/270 if needed
  for (const deg of [0, 180]) {
    const rotated = deg === 0 ? cropCanvas : rotateCanvas(cropCanvas, deg);
    const base = preprocessForOcr(rotated);
    await scoreImprintVariants(worker, [base, adaptiveThresholdCanvas(base)], scoreMap);
  }

  let ranked = Array.from(scoreMap.entries()).sort((a, b) => b[1] - a[1]);
  const weak = !ranked.length || ranked[0][1] < 60;

  if (thorough || weak) {
    for (const deg of [90, 270, 15, -15]) {
      const rotated = rotateCanvas(cropCanvas, deg);
      const base = preprocessForOcr(rotated);
      await scoreImprintVariants(worker, [adaptiveThresholdCanvas(base)], scoreMap);
    }
    if (thorough || !ranked.length || ranked[0]?.[1] < 45) {
      const lit = applyLightingAug(cropCanvas, { brightness: 0.08, contrast: 1.15 });
      await scoreImprintVariants(worker, [adaptiveThresholdCanvas(preprocessForOcr(lit))], scoreMap);
    }
    ranked = Array.from(scoreMap.entries()).sort((a, b) => b[1] - a[1]);
  }

  if (!ranked.length) return { mark: "", confidence: 0, all: [] };
  const filtered = ranked.filter(([m]) => isValidImprintMark(m));
  if (!filtered.length) return { mark: "", confidence: 0, all: [] };
  // Soft floor — realtime OCR votes are lower than offline
  if (filtered[0][1] < 28) {
    return { mark: "", confidence: 0, all: filtered.slice(0, 5).map(([mark, score]) => ({ mark, score })) };
  }
  return {
    mark: filtered[0][0],
    confidence: filtered[0][1],
    all: filtered.slice(0, 5).map(([mark, score]) => ({ mark, score })),
  };
}

/** Reject only obvious OCR garbage (keep real short marks like TY, 10). */
export function isValidImprintMark(mark) {
  const m = String(mark || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (m.length < 2 || m.length > 14) return false;
  if (/^(.)\1+$/.test(m)) return false;
  const ban = new Set([
    "II", "III", "OO", "O0", "0O", "THE", "AND", "FOR", "TAB", "CAP", "MG", "ML", "DOS", "DAY",
  ]);
  if (ban.has(m)) return false;
  return true;
}

function normalizeMark(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** How well OCR imprint matches DB PRINT_FRONT/BACK (0..1). */
export function imprintMatchScore(ocrMark, candidate) {
  const mark = normalizeMark(ocrMark);
  if (!mark) return 0;
  const front = normalizeMark(candidate.mark || candidate.PRINT_FRONT || "");
  const back = normalizeMark(candidate.PRINT_BACK || "");
  const sides = [front, back].filter(Boolean);
  if (!sides.length) return 0;

  let best = 0;
  for (const ref of sides) {
    if (ref === mark) best = Math.max(best, 1);
    else if (ref.includes(mark) || mark.includes(ref)) {
      const overlap = Math.min(mark.length, ref.length) / Math.max(mark.length, ref.length);
      best = Math.max(best, mark.length >= 2 ? 0.55 + 0.4 * overlap : 0.2);
    } else {
      const dist = editDistance(mark, ref);
      const maxLen = Math.max(mark.length, ref.length);
      if (maxLen >= 3 && dist <= 1) best = Math.max(best, 0.8);
      else if (maxLen >= 4 && dist <= 2) best = Math.max(best, 0.65);
      else if (mark.length >= 3 && ref.length >= 3) {
        // shared prefix/suffix boost (OCR often clips ends)
        let pref = 0;
        while (pref < mark.length && pref < ref.length && mark[pref] === ref[pref]) pref += 1;
        if (pref >= 2) best = Math.max(best, 0.45 + 0.1 * pref);
      }
    }
  }
  return best;
}

/**
 * Re-rank Top-K. Candidates should already come from print_front queries.
 * Color/shape help break ties; imprint similarity still required to accept.
 */
export function rerankCandidates(candidates, cues) {
  const { color, shape, mark } = cues;
  const validMark = isValidImprintMark(mark) ? normalizeMark(mark) : "";
  const n = Math.max(candidates.length, 1);

  return candidates
    .map((c, idx) => {
      const apiScore = 1 - idx / n;
      const cColor = String(c.color || c.COLOR_CLASS1 || "");
      const cShape = String(c.shape || c.DRUG_SHAPE || "");
      const ocrScore = validMark ? imprintMatchScore(validMark, c) : 0;

      const colorScore = color && cColor.includes(color) ? 1 : color && cColor ? 0.2 : 0.45;
      const shapeScore =
        shape && cShape.includes(String(shape).replace("형", ""))
          ? 1
          : shape && cShape
            ? 0.25
            : 0.45;

      // Queried-by-mark candidates get a small prior so unique API hits can pass
      const queriedPrior = validMark ? 0.2 : 0;
      const score =
        0.2 * apiScore + 0.15 * colorScore + 0.1 * shapeScore + 0.55 * ocrScore + queriedPrior;
      return { ...c, rerankScore: score, colorScore, shapeScore, ocrScore, apiScore };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

/**
 * Accept when imprint is plausible.
 * - Strong OCR match (>=0.55) OR
 * - Soft match (>=0.35) with decent rerank (API already filtered by print_front)
 */
export function pickBestCandidate(ranked, { minOcrScore = 0.35, minRerank = 0.4 } = {}) {
  if (!ranked?.length) return null;
  const best = ranked[0];
  const ocr = best.ocrScore || 0;
  const rr = best.rerankScore || 0;
  if (ocr >= 0.55 && rr >= 0.35) return best;
  if (ocr >= minOcrScore && rr >= minRerank) return best;
  // Single API hit with any imprint overlap — likely correct for that print_front query
  if (ranked.length === 1 && ocr >= 0.25 && rr >= 0.3) return best;
  return null;
}

/**
 * Cluster detections by embedding so identical pills share one classification result.
 */
export function clusterByEmbedding(items, threshold = 0.18) {
  const clusters = [];
  for (const item of items) {
    let matched = null;
    for (const c of clusters) {
      if (embeddingDistance(c.centroid, item.embedding) <= threshold) {
        matched = c;
        break;
      }
    }
    if (!matched) {
      clusters.push({
        id: `cluster_${clusters.length}`,
        members: [item],
        centroid: [...item.embedding],
        representative: item,
      });
    } else {
      matched.members.push(item);
      // update centroid
      const m = matched.members;
      matched.centroid = matched.centroid.map((_, i) => m.reduce((s, it) => s + it.embedding[i], 0) / m.length);
      if (item.detConfidence > matched.representative.detConfidence) matched.representative = item;
    }
  }
  return clusters;
}

export async function classifyDetection(detection, worker) {
  const colorInfo = estimateColorLabel(detection.cropCanvas);
  const ocr = await extractImprintOcr(detection.cropCanvas, worker);
  const embedding = buildEmbedding({
    rgb: colorInfo.rgb,
    shape: detection.shape,
    area: detection.area,
    mark: ocr.mark,
  });

  return {
    ...detection,
    color: colorInfo.label,
    rgb: colorInfo.rgb,
    mark: ocr.mark,
    markConfidence: ocr.confidence,
    markCandidates: ocr.all,
    embedding,
    detConfidence: detection.confidence,
  };
}
