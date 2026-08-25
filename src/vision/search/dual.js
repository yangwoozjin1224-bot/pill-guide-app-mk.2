/**
 * Front + back pill capture fusion.
 * Why: many pills have imprint on one side only; dual-view raises OCR + embedding recall.
 */

import { embedCropCanvas, cosineSimilarity, l2Normalize } from "./embed.js";
import { extractImprintOcr, isValidImprintMark } from "../classify.js";

function mergeImprints(a, b) {
  const marks = [a, b]
    .map((m) => String(m || "").toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter((m) => isValidImprintMark(m));
  if (!marks.length) return "";
  // Prefer longer / higher information mark
  marks.sort((x, y) => y.length - x.length);
  return marks[0];
}

/**
 * Fuse two crops (front/back) into one query representation.
 */
export async function fuseFrontBack(frontCanvas, backCanvas, worker, baseMeta = {}) {
  const frontOcr = frontCanvas
    ? await extractImprintOcr(frontCanvas, worker)
    : { mark: "", confidence: 0, all: [] };
  const backOcr = backCanvas
    ? await extractImprintOcr(backCanvas, worker)
    : { mark: "", confidence: 0, all: [] };

  const imprint = mergeImprints(frontOcr.mark, backOcr.mark);
  const markCandidates = [
    ...(frontOcr.all || []),
    ...(backOcr.all || []),
  ];

  const eFront = frontCanvas
    ? embedCropCanvas(frontCanvas, { imprint: frontOcr.mark, shape: baseMeta.shape, area: baseMeta.area })
    : null;
  const eBack = backCanvas
    ? embedCropCanvas(backCanvas, { imprint: backOcr.mark, shape: baseMeta.shape, area: baseMeta.area })
    : null;

  let embedding;
  if (eFront && eBack) {
    const fused = new Float32Array(eFront.length);
    for (let i = 0; i < fused.length; i++) fused[i] = (eFront[i] + eBack[i]) / 2;
    embedding = l2Normalize(fused);
  } else {
    embedding = eFront || eBack;
  }

  const sideAgreement =
    eFront && eBack ? (cosineSimilarity(eFront, eBack) + 1) / 2 : 1;

  return {
    embedding,
    imprint,
    markCandidates,
    frontOcr,
    backOcr,
    sideAgreement,
    color: baseMeta.color,
    shape: baseMeta.shape,
    area: baseMeta.area,
    aspect: baseMeta.aspect,
  };
}
