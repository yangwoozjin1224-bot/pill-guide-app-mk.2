/**
 * Evaluation metrics for Vision Search:
 * Detection Accuracy, OCR Accuracy, Retrieval Recall@5/@10, Final Accuracy
 */

import {
  getEvalMetrics,
  formatEvalSummary as formatVisionEval,
  logEvalSample,
  resetEval,
  logRetrievalRun,
} from "./search/evaluate.js";

const empty = () => ({
  detection: { tp: 0, fp: 0, fn: 0, runs: 0 },
  classification: { correct: 0, total: 0 },
  ocr: { correct: 0, total: 0, charsOk: 0, charsTotal: 0 },
  endToEnd: { success: 0, fail: 0 },
  lastRun: null,
});

let store = empty();

export function resetMetrics() {
  store = empty();
  resetEval();
}

export function getMetrics() {
  const d = store.detection;
  const recall = d.tp + d.fn > 0 ? d.tp / (d.tp + d.fn) : null;
  const precision = d.tp + d.fp > 0 ? d.tp / (d.tp + d.fp) : null;
  const cls =
    store.classification.total > 0
      ? store.classification.correct / store.classification.total
      : null;
  const ocrAcc =
    store.ocr.total > 0 ? store.ocr.correct / store.ocr.total : null;
  const e2eTotal = store.endToEnd.success + store.endToEnd.fail;
  const e2eAcc = e2eTotal > 0 ? store.endToEnd.success / e2eTotal : null;
  const vision = getEvalMetrics();
  return {
    detectionRecall: recall,
    detectionPrecision: precision,
    detectionAccuracy: vision.detectionAccuracy,
    classificationAccuracy: cls,
    ocrAccuracy: vision.ocrAccuracy ?? ocrAcc,
    recallAt5: vision.recallAt5,
    recallAt10: vision.recallAt10,
    finalAccuracy: vision.finalAccuracy ?? e2eAcc,
    endToEndAccuracy: e2eAcc,
    raw: { legacy: { ...store }, vision: vision.raw },
  };
}

export function logDetectionRun({ detectedCount, tp, fp, fn } = {}) {
  store.detection.runs += 1;
  if (typeof tp === "number") store.detection.tp += tp;
  if (typeof fp === "number") store.detection.fp += fp;
  if (typeof fn === "number") store.detection.fn += fn;
  store.lastRun = {
    ...(store.lastRun || {}),
    detectedCount,
    at: Date.now(),
  };
}

export function logClassification({ correct }) {
  store.classification.total += 1;
  if (correct) store.classification.correct += 1;
}

export function logOcr({ correct, charsOk = 0, charsTotal = 0 }) {
  store.ocr.total += 1;
  if (correct) store.ocr.correct += 1;
  store.ocr.charsOk += charsOk;
  store.ocr.charsTotal += charsTotal;
}

export function logEndToEnd({ success }) {
  if (success) store.endToEnd.success += 1;
  else store.endToEnd.fail += 1;
}

export function formatMetricsSummary(m = getMetrics()) {
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  return {
    "Detection Accuracy": pct(m.detectionAccuracy),
    "OCR Accuracy": pct(m.ocrAccuracy),
    "Retrieval Recall@5": pct(m.recallAt5),
    "Retrieval Recall@10": pct(m.recallAt10),
    "Final Accuracy": pct(m.finalAccuracy),
    "Last detections": m.raw?.legacy?.lastRun?.detectedCount ?? "—",
  };
}

export { logEvalSample, logRetrievalRun, getEvalMetrics, resetEval, formatVisionEval };
