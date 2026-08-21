/**
 * Enhanced imprint OCR helpers (wraps classify.extractImprintOcr).
 */

import { extractImprintOcr, isValidImprintMark } from "../classify.js";
import { getOcrWorker } from "../ocr.js";

export async function extractImprintFromCrop(cropCanvas, options = {}) {
  const worker = options.worker || (await getOcrWorker(options.lang || "eng"));
  if (!options.worker) {
    try {
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        tessedit_pageseg_mode: "11",
      });
    } catch {
      /* ignore */
    }
  }

  const ocr = await extractImprintOcr(cropCanvas, worker, {
    thorough: options.thorough !== false,
  });

  const mark = isValidImprintMark(ocr.mark) ? ocr.mark : "";
  const all = (ocr.all || [])
    .map((m) => (typeof m === "string" ? m : m.mark))
    .filter((m) => isValidImprintMark(m));

  return {
    imprintFront: mark,
    imprintBack: "",
    markCandidates: [...new Set([mark, ...all].filter(Boolean))],
    confidence: Number(ocr.confidence) || 0,
    source: "ocr",
    raw: ocr,
  };
}

export { isValidImprintMark };
