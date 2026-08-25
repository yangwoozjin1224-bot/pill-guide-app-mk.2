/**
 * Evaluation system for Vision Search.
 * Metrics: Detection Accuracy, OCR Accuracy, Retrieval Recall@5, Recall@10, Final Accuracy
 */

const empty = () => ({
  detection: { correct: 0, total: 0 },
  ocr: { correct: 0, total: 0 },
  retrieval: {
    hitsAt5: 0,
    hitsAt10: 0,
    total: 0,
  },
  final: { correct: 0, total: 0 },
  sessions: [],
});

let store = empty();

export function resetEval() {
  store = empty();
}

export function getEvalStore() {
  return { ...store, retrieval: { ...store.retrieval }, sessions: [...store.sessions] };
}

/**
 * Log one evaluated query when ground-truth itemSeq / name is known.
 * @param {{
 *   gtItemSeq?: string,
 *   gtName?: string,
 *   detected?: boolean,
 *   ocrMark?: string,
 *   gtMark?: string,
 *   retrievedIds?: string[],
 *   finalItemSeq?: string,
 *   finalName?: string,
 * }} sample
 */
export function logEvalSample(sample = {}) {
  const {
    gtItemSeq,
    gtName,
    detected,
    ocrMark,
    gtMark,
    retrievedIds = [],
    finalItemSeq,
    finalName,
  } = sample;

  if (typeof detected === "boolean") {
    store.detection.total += 1;
    if (detected) store.detection.correct += 1;
  }

  if (gtMark != null) {
    store.ocr.total += 1;
    const a = String(ocrMark || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const b = String(gtMark || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (a && b && (a === b || a.includes(b) || b.includes(a))) store.ocr.correct += 1;
  }

  if (gtItemSeq || gtName) {
    store.retrieval.total += 1;
    const ids = retrievedIds.map(String);
    const namesOk = (id, idx) => false;
    const hit = (k) => {
      const top = ids.slice(0, k);
      if (gtItemSeq && top.includes(String(gtItemSeq))) return true;
      return false;
    };
    if (hit(5)) store.retrieval.hitsAt5 += 1;
    if (hit(10)) store.retrieval.hitsAt10 += 1;

    store.final.total += 1;
    const ok =
      (gtItemSeq && String(finalItemSeq) === String(gtItemSeq)) ||
      (gtName &&
        String(finalName || "")
          .replace(/\s/g, "")
          .includes(String(gtName).replace(/\s/g, "")));
    if (ok) store.final.correct += 1;
  }

  store.sessions.push({ ...sample, at: Date.now() });
  if (store.sessions.length > 200) store.sessions.shift();
}

/** Runtime counters without GT (observability). */
export function logRetrievalRun({ topK = 10, resultCount = 0, finalAccepted = false } = {}) {
  store.sessions.push({
    type: "run",
    topK,
    resultCount,
    finalAccepted,
    at: Date.now(),
  });
}

export function getEvalMetrics() {
  const det =
    store.detection.total > 0 ? store.detection.correct / store.detection.total : null;
  const ocr = store.ocr.total > 0 ? store.ocr.correct / store.ocr.total : null;
  const r5 =
    store.retrieval.total > 0 ? store.retrieval.hitsAt5 / store.retrieval.total : null;
  const r10 =
    store.retrieval.total > 0 ? store.retrieval.hitsAt10 / store.retrieval.total : null;
  const fin = store.final.total > 0 ? store.final.correct / store.final.total : null;
  return {
    detectionAccuracy: det,
    ocrAccuracy: ocr,
    recallAt5: r5,
    recallAt10: r10,
    finalAccuracy: fin,
    raw: getEvalStore(),
  };
}

export function formatEvalSummary(m = getEvalMetrics()) {
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  return {
    "Detection Accuracy": pct(m.detectionAccuracy),
    "OCR Accuracy": pct(m.ocrAccuracy),
    "Retrieval Recall@5": pct(m.recallAt5),
    "Retrieval Recall@10": pct(m.recallAt10),
    "Final Accuracy": pct(m.finalAccuracy),
  };
}
