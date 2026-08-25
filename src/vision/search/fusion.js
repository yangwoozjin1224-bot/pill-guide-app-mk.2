/**
 * Feature fusion + weighted re-ranking for Vision Search.
 *
 * Final score =
 *   0.40 Embedding Similarity
 * + 0.30 OCR Match
 * + 0.15 Shape
 * + 0.10 Color
 * + 0.05 Size
 */

import { imprintMatchScore, isValidImprintMark } from "../classify.js";
import { similarity as nameSimilarity } from "../fuzzy.js";

export const RERANK_WEIGHTS = {
  embedding: 0.4,
  ocr: 0.3,
  shape: 0.15,
  color: 0.1,
  size: 0.05,
};

function normShape(s) {
  return String(s || "").replace(/형/g, "").trim();
}

function sizeScore(queryArea, cand) {
  // Catalog rarely has absolute size; use aspect-ratio proxy when present
  const qAr = cand?.queryAspect || 1;
  const cAr = cand?.aspect || cand?.item?.aspect;
  if (!cAr || !qAr) return 0.5;
  const ratio = Math.min(qAr, cAr) / Math.max(qAr, cAr);
  return Math.max(0, Math.min(1, ratio));
}

export function scoreCandidate(candidate, cues) {
  const {
    imprint = "",
    color = "",
    shape = "",
    area = 0,
    aspect = 1,
    bagHints = [],
  } = cues;

  const item = candidate.item || candidate;
  const embSim = Math.max(0, Math.min(1, (candidate.score + 1) / 2)); // cosine [-1,1] → [0,1]
  // Prefer raw cosine if already 0..1-ish
  const embeddingSim =
    candidate.score >= 0 && candidate.score <= 1
      ? candidate.score
      : embSim;

  const ocr = isValidImprintMark(imprint)
    ? imprintMatchScore(imprint, item)
    : 0;

  const cColor = String(item.COLOR_CLASS1 || item.color || "");
  const colorSim = color
    ? cColor.includes(color)
      ? 1
      : cColor
        ? 0.15
        : 0.4
    : 0.5;

  const cShape = String(item.DRUG_SHAPE || item.shape || "");
  const shapeSim = shape
    ? cShape.includes(normShape(shape))
      ? 1
      : cShape
        ? 0.2
        : 0.4
    : 0.5;

  const sizeSim = sizeScore(area, {
    queryAspect: aspect,
    aspect: item.aspect,
    item,
  });

  // Bag cross-check boost
  let bagBoost = 0;
  const drugName = item.ITEM_NAME || item.name || item.itemName || "";
  for (const hint of bagHints || []) {
    const s = nameSimilarity(hint, drugName);
    if (s >= 0.55) bagBoost = Math.max(bagBoost, s * 0.25);
  }

  const w = RERANK_WEIGHTS;
  const fused =
    w.embedding * embeddingSim +
    w.ocr * ocr +
    w.shape * shapeSim +
    w.color * colorSim +
    w.size * sizeSim +
    bagBoost;

  return {
    ...candidate,
    item,
    embeddingSim,
    ocrScore: ocr,
    shapeScore: shapeSim,
    colorScore: colorSim,
    sizeScore: sizeSim,
    bagBoost,
    fusedScore: Math.min(1, fused),
  };
}

export function rerankVisionCandidates(candidates, cues, { topK = 10 } = {}) {
  return (candidates || [])
    .map((c) => scoreCandidate(c, cues))
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);
}

export function pickFinalPrediction(ranked, { minConfidence = 0.42 } = {}) {
  if (!ranked?.length) return { best: null, confidence: 0, needsRefine: true };
  const best = ranked[0];
  const confidence = best.fusedScore || 0;
  return {
    best,
    confidence,
    needsRefine: confidence < minConfidence,
    top10: ranked.slice(0, 10),
  };
}
