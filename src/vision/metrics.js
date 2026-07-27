/**
 * 단계별 성능 측정 구조
 * Detection Recall / Precision, Classification Accuracy, OCR Accuracy, End-to-End
 * 실제 GT가 없으면 세션 로그로 누적해 디버그/추후 평가에 사용
 */

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
  const e2e = e2eTotal > 0 ? store.endToEnd.success / e2eTotal : null;
  return {
    detectionRecall: recall,
    detectionPrecision: precision,
    classificationAccuracy: cls,
    ocrAccuracy: ocrAcc,
    endToEndAccuracy: e2e,
    raw: { ...store },
  };
}

/** Detection 한 번 실행 기록 (GT 없으면 detectedCount만 로그) */
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
    "Detection Recall": pct(m.detectionRecall),
    "Detection Precision": pct(m.detectionPrecision),
    "Classification Accuracy": pct(m.classificationAccuracy),
    "OCR Accuracy": pct(m.ocrAccuracy),
    "End-to-End Accuracy": pct(m.endToEndAccuracy),
    "Last detections": m.raw.lastRun?.detectedCount ?? "—",
  };
}
