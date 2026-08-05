/**
 * OCR worker pool — separate workers per language set so
 * pill imprint (eng whitelist) does not poison document Hangul OCR.
 */
import Tesseract from "tesseract.js";

const workers = new Map();
const busy = new Map();

export async function getOcrWorker(langs = "eng+kor") {
  const key = String(langs || "eng+kor");
  if (!workers.has(key)) {
    const worker = await Tesseract.createWorker(key, 1, {
      logger: () => {},
    });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
      });
    } catch {
      /* ignore */
    }
    workers.set(key, worker);
    busy.set(key, false);
  }
  return workers.get(key);
}

export async function recognizeCanvas(canvas, { langs, psm, whitelist } = {}) {
  const key = String(langs || "eng+kor");
  if (busy.get(key)) return { text: "", confidence: 0 };
  busy.set(key, true);
  try {
    const worker = await getOcrWorker(key);
    const params = {};
    if (psm != null) params.tessedit_pageseg_mode = String(psm);
    if (whitelist) params.tessedit_char_whitelist = whitelist;
    else if (key.startsWith("eng") && !key.includes("kor")) {
      params.tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    }
    if (Object.keys(params).length) {
      try {
        await worker.setParameters(params);
      } catch {
        /* ignore */
      }
    }
    const {
      data: { text, confidence },
    } = await worker.recognize(canvas);
    return { text: text || "", confidence: confidence || 0 };
  } catch {
    return { text: "", confidence: 0 };
  } finally {
    busy.set(key, false);
  }
}

export async function terminateOcrWorker() {
  for (const [, worker] of workers) {
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
  }
  workers.clear();
  busy.clear();
}
