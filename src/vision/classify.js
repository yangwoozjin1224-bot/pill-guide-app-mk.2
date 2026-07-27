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
 * OCR imprint with rotation + photometric TTA.
 * Fast pass: 0/90/180/270. Weak results expand to ±15/±30 and lighting augs.
 * (Client has no training loop — inference TTA stands in for rotation/brightness aug.)
 */
export async function extractImprintOcr(cropCanvas, worker, { thorough = false } = {}) {
  if (!worker || !cropCanvas) return { mark: "", confidence: 0, all: [] };

  const scoreMap = new Map();
  for (const deg of [0, 90, 180, 270]) {
    const rotated = deg === 0 ? cropCanvas : rotateCanvas(cropCanvas, deg);
    const base = preprocessForOcr(rotated);
    await scoreImprintVariants(worker, [base, adaptiveThresholdCanvas(base)], scoreMap);
  }

  let ranked = Array.from(scoreMap.entries()).sort((a, b) => b[1] - a[1]);
  const weak = !ranked.length || ranked[0][1] < 80;

  if (thorough || weak) {
    for (const deg of [15, -15, 30, -30]) {
      const rotated = rotateCanvas(cropCanvas, deg);
      const base = preprocessForOcr(rotated);
      await scoreImprintVariants(
        worker,
        [base, invertCanvas(adaptiveThresholdCanvas(base))],
        scoreMap
      );
    }
    for (const light of [
      { brightness: 0.1, contrast: 1.2 },
      { brightness: -0.1, contrast: 1.15, gamma: 1.2 },
    ]) {
      const lit = applyLightingAug(cropCanvas, light);
      const base = preprocessForOcr(lit);
      await scoreImprintVariants(worker, [adaptiveThresholdCanvas(base)], scoreMap);
    }
    ranked = Array.from(scoreMap.entries()).sort((a, b) => b[1] - a[1]);
  }

  if (!ranked.length) return { mark: "", confidence: 0, all: [] };
  return {
    mark: ranked[0][0],
    confidence: ranked[0][1],
    all: ranked.slice(0, 5).map(([mark, score]) => ({ mark, score })),
  };
}

/**
 * Re-rank Top-K API candidates with visual cues.
 * final = 0.45*apiRank + 0.2*color + 0.15*shape + 0.2*ocr
 */
export function rerankCandidates(candidates, cues) {
  const { color, shape, mark } = cues;
  const n = Math.max(candidates.length, 1);

  return candidates
    .map((c, idx) => {
      const apiScore = 1 - idx / n;
      const cColor = String(c.color || c.COLOR_CLASS1 || "");
      const cShape = String(c.shape || c.DRUG_SHAPE || "");
      const cMark = String(c.mark || c.PRINT_FRONT || c.PRINT_BACK || "").toUpperCase();

      const colorScore = color && cColor.includes(color) ? 1 : color && cColor ? 0.2 : 0.5;
      const shapeScore = shape && cShape.includes(shape.replace("형", "")) ? 1 : shape && cShape ? 0.25 : 0.5;
      let ocrScore = 0.4;
      if (mark && cMark) {
        if (cMark === mark) ocrScore = 1;
        else if (cMark.includes(mark) || mark.includes(cMark)) ocrScore = 0.75;
        else ocrScore = 0.1;
      }

      const score = 0.45 * apiScore + 0.2 * colorScore + 0.15 * shapeScore + 0.2 * ocrScore;
      return { ...c, rerankScore: score, colorScore, shapeScore, ocrScore, apiScore };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
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
