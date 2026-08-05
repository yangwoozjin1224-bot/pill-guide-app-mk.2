/**
 * Per-crop feature extraction: OCR + CV + observation vision LLM.
 * Fuses signals; never invents a drug name.
 */

import { extractCvFeatures } from "./cvFeatures.js";
import { extractImprintFromCrop, isValidImprintMark } from "./ocrImprint.js";
import { observePillFeatures, isVisionLlmConfigured } from "./visionLlm.js";

function preferString(a, b, confA = 0, confB = 0) {
  const sa = String(a || "").trim();
  const sb = String(b || "").trim();
  if (sa && !sb) return sa;
  if (!sa && sb) return sb;
  if (!sa && !sb) return "";
  return confB > confA + 0.15 ? sb : sa;
}

/**
 * @returns {Promise<{
 *   imprintFront: string,
 *   imprintBack: string,
 *   markCandidates: string[],
 *   color: string,
 *   shape: string,
 *   scoreLine: boolean,
 *   sources: object,
 *   raw: { ocr, cv, llm }
 * }>}
 */
export async function extractPillFeatures(cropCanvas, options = {}) {
  const {
    box,
    area,
    shapeHint,
    worker,
    useLlm = true,
    llmFetcher,
    thoroughOcr = true,
  } = options;

  const [ocr, cv, llm] = await Promise.all([
    extractImprintFromCrop(cropCanvas, { worker, thorough: thoroughOcr }),
    Promise.resolve(extractCvFeatures(cropCanvas, { box, area, shapeHint })),
    useLlm && (isVisionLlmConfigured() || llmFetcher)
      ? observePillFeatures(cropCanvas, { fetcher: llmFetcher })
      : Promise.resolve(null),
  ]);

  let imprintFront = ocr.imprintFront || "";
  let imprintBack = "";
  const markCandidates = [...(ocr.markCandidates || [])];

  if (llm) {
    if (isValidImprintMark(llm.imprintFront)) {
      if (!imprintFront) imprintFront = llm.imprintFront;
      else if (llm.imprintFront !== imprintFront) markCandidates.push(llm.imprintFront);
      // Prefer longer overlapping mark
      if (
        llm.imprintFront.length >= imprintFront.length &&
        (llm.imprintFront.includes(imprintFront) || imprintFront.includes(llm.imprintFront.slice(0, 3)))
      ) {
        imprintFront = llm.imprintFront.length > imprintFront.length ? llm.imprintFront : imprintFront;
      }
    }
    if (isValidImprintMark(llm.imprintBack)) imprintBack = llm.imprintBack;
    markCandidates.push(...[llm.imprintFront, llm.imprintBack].filter((m) => isValidImprintMark(m)));
  }

  const color = preferString(cv.color, llm?.color, cv.colorConfidence, llm ? 0.7 : 0);
  const shape = preferString(
    shapeHint || cv.shape,
    llm?.shape,
    cv.shapeConfidence,
    llm ? 0.65 : 0
  );
  const scoreLine =
    cv.scoreLine || Boolean(llm?.scoreLine)
      ? true
      : false;

  return {
    imprintFront: isValidImprintMark(imprintFront) ? imprintFront : "",
    imprintBack: isValidImprintMark(imprintBack) ? imprintBack : "",
    markCandidates: [...new Set(markCandidates.filter((m) => isValidImprintMark(m)))],
    color,
    shape,
    scoreLine,
    markConfidence: ocr.confidence,
    sources: {
      ocr: Boolean(ocr.imprintFront),
      cv: true,
      llm: Boolean(llm),
    },
    raw: { ocr, cv, llm },
  };
}

export { extractCvFeatures, extractImprintFromCrop, observePillFeatures, isVisionLlmConfigured };
