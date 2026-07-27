/**
 * End-to-end recognition pipeline.
 *
 * Image → Preprocess → Multi-scale Mask Detection → Crop(+margin)
 * → Classification (shape/color/OCR imprint) → API Top-5 → Re-rank
 * → Embedding cluster (same pills share one result)
 *
 * Browser note: default detector is classical instance-mask separation.
 * Plug YOLO-seg / SAM2 / Mask R-CNN via setExternalDetector().
 */
import { detectPills } from "./detect.js";
import {
  classifyDetection,
  clusterByEmbedding,
  rerankCandidates,
  pickBestCandidate,
  isValidImprintMark,
} from "./classify.js";
import { getOcrWorker, recognizeCanvas, terminateOcrWorker } from "./ocr.js";
import { prepareDocumentForOcr, extractDrugNameCandidates } from "./document.js";
import { fuzzyMatchNames, correctDrugNameWithHints } from "./fuzzy.js";
import { logDetectionRun, logEndToEnd, logOcr } from "./metrics.js";

let externalDetector = null;

/** @param {(source, opts) => Promise<{detections}>| {detections}} fn */
export function setExternalDetector(fn) {
  externalDetector = typeof fn === "function" ? fn : null;
}

export function getPipelineConfig() {
  return {
    detectionSeparatedFromClassification: true,
    prefersInstanceSegmentation: true,
    detectionMinConfidence: 0.18,
    cropMarginRatio: 0.15,
    multiScale: [640, 960, 1280],
    twoPassWeak: true,
    topK: 5,
    embeddingCluster: true,
    shapePriors: ["원형", "타원형", "장방형", "캡슐형"],
    note:
      "기본 검출기는 브라우저용 마스크(연결요소) 분리. SAM2/YOLO-seg는 setExternalDetector로 연결.",
  };
}

async function runDetection(source, options = {}) {
  if (externalDetector) {
    try {
      const ext = await externalDetector(source, options);
      if (ext?.detections?.length) return { ...ext, source: "external" };
    } catch (e) {
      console.warn("[pipeline] external detector failed, fallback classical", e);
    }
  }
  const result = await detectPills(source, {
    scales: options.scales || [640, 960, 1280],
    sensitivity: options.sensitivity ?? 1.15,
    marginRatio: options.marginRatio ?? 0.15,
    twoPass: options.twoPass !== false,
    minConfidenceKeep: options.minConfidenceKeep ?? 0.18,
  });
  return { ...result, source: "classical-mask" };
}

/**
 * Detection only (no naming). Classification is a separate stage.
 */
export async function detectPillInstances(source, options = {}) {
  const detected = await runDetection(source, options);
  logDetectionRun({ detectedCount: detected.detections?.length || 0 });
  return detected;
}

/**
 * Full pill pipeline with optional API classifyFn.
 * classifyFn(features) => Promise<Array of Top-5 raw candidates>
 *   each candidate: { itemSeq, name, mark, shape, color, imageUrl, ... }
 */
export async function recognizePillsPipeline(source, options = {}) {
  const {
    classifyFn,
    debug = false,
    maxInstances = 8,
    shareByEmbedding = true,
  } = options;

  const detected = await detectPillInstances(source, options);
  let detections = (detected.detections || []).slice(0, maxInstances);

  if (!detections.length) {
    logEndToEnd({ success: false });
    return {
      detections: [],
      results: [],
      clusters: [],
      detectorSource: detected.source,
      debug: debug ? { boxes: [], crops: [], masks: [] } : null,
    };
  }

  const worker = await getOcrWorker("eng");
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      tessedit_pageseg_mode: "11",
    });
  } catch {
    /* ignore */
  }

  // Classification stage (separated from detection)
  const classified = [];
  for (const det of detections) {
    const cls = await classifyDetection(det, worker);
    classified.push(cls);
  }

  // Same-pill embedding clusters → one API call per cluster
  const clusters = shareByEmbedding
    ? clusterByEmbedding(classified, 0.2)
    : classified.map((item, i) => ({
        id: `cluster_${i}`,
        members: [item],
        centroid: item.embedding,
        representative: item,
      }));

  const clusterPayload = [];
  for (const cluster of clusters) {
    const rep = cluster.representative;
    // No valid imprint → skip API. Color/shape-only returns arbitrary first hits.
    if (!isValidImprintMark(rep.mark)) {
      clusterPayload.push({
        clusterId: cluster.id,
        mark: rep.mark || "",
        color: rep.color,
        shape: rep.shape,
        confidence: rep.confidence,
        top5: [],
        best: null,
        memberIds: cluster.members.map((m) => m.id),
      });
      continue;
    }

    let candidates = [];
    if (typeof classifyFn === "function") {
      try {
        candidates =
          (await classifyFn({
            mark: rep.mark,
            color: rep.color,
            shape: rep.shape,
            markCandidates: rep.markCandidates,
          })) || [];
      } catch (e) {
        console.warn("[pipeline] classifyFn error", e);
      }
    }

    const top5 = rerankCandidates(candidates.slice(0, 8), {
      color: rep.color,
      shape: rep.shape,
      mark: rep.mark,
    }).slice(0, 5);

    const best = pickBestCandidate(top5);
    clusterPayload.push({
      clusterId: cluster.id,
      mark: rep.mark,
      color: rep.color,
      shape: rep.shape,
      confidence: rep.confidence,
      top5,
      best,
      memberIds: cluster.members.map((m) => m.id),
    });
  }

  // Expand shared results back to each instance
  const byId = new Map();
  for (const payload of clusterPayload) {
    for (const id of payload.memberIds) byId.set(id, payload);
  }

  const results = classified.map((c) => {
    const shared = byId.get(c.id);
    return {
      id: c.id,
      box: c.box,
      confidence: c.confidence,
      shape: c.shape,
      color: c.color,
      mark: c.mark,
      markConfidence: c.markConfidence,
      cropCanvas: c.cropCanvas,
      maskCanvas: c.maskCanvas,
      top5: shared?.top5 || [],
      best: shared?.best || null,
      clusterId: shared?.clusterId,
    };
  });

  const anyHit = results.some((r) => r.best);
  logEndToEnd({ success: anyHit });

  return {
    detections: results,
    results,
    clusters: clusterPayload,
    detectorSource: detected.source,
    debug: debug
      ? {
          boxes: results.map((r) => ({
            ...r.box,
            confidence: r.confidence,
            shape: r.shape,
            mark: r.mark,
          })),
          crops: results.map((r) => r.cropCanvas),
          masks: results.map((r) => r.maskCanvas),
          preprocess: detected.debug?.preprocessed || null,
        }
      : null,
  };
}

/**
 * Medicine bag / prescription:
 * document detect → perspective → enhance → deskew/threshold → OCR → fuzzy match
 */
export async function recognizeDocumentPipeline(sourceCanvas, options = {}) {
  const { searchFn, debug = false } = options;
  const prepared = prepareDocumentForOcr(sourceCanvas);
  const ocrCanvas = prepared.binaryCanvas || prepared.documentCanvas;

  const { text, confidence } = await recognizeCanvas(ocrCanvas, {
    langs: "kor+eng",
    psm: 6,
  });
  logOcr({ correct: !!text, charsTotal: text.length, charsOk: text.length });

  const rawCandidates = extractDrugNameCandidates(text);
  const corrected = [];
  for (const c of rawCandidates) {
    const hint = correctDrugNameWithHints(c);
    corrected.push(hint.corrected);
    if (hint.corrected !== c) corrected.push(c);
  }
  const uniqueNames = [...new Set(corrected.map((s) => String(s).trim()).filter(Boolean))];

  const matchedItems = [];
  const seen = new Set();

  if (typeof searchFn === "function") {
    for (const name of uniqueNames.slice(0, 10)) {
      try {
        const list = await searchFn(name);
        if (!Array.isArray(list) || !list.length) continue;

        const fuzzy = fuzzyMatchNames(
          [name],
          list.map((it) => it.ITEM_NAME || it.name || it.itemName || "")
        );

        for (const f of fuzzy) {
          const hit =
            list.find(
              (it) =>
                (it.ITEM_NAME || it.name || it.itemName || "") === f.matched
            ) || list[0];
          const key = hit.ITEM_SEQ || hit.itemSeq || hit.id || f.matched;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          matchedItems.push({
            ...hit,
            _matchScore: f.score,
            _query: name,
            _matchedName: f.matched,
          });
        }

        if (!fuzzy.length) {
          for (const it of list.slice(0, 2)) {
            const key = it.ITEM_SEQ || it.itemSeq || it.id;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            matchedItems.push({ ...it, _matchScore: 0.3, _query: name });
          }
        }
      } catch (e) {
        console.warn("[doc-pipeline] search failed", name, e);
      }
    }
  }

  return {
    text,
    confidence,
    rawCandidates: uniqueNames,
    items: matchedItems,
    debug: debug
      ? {
          quad: prepared.quad,
          documentCanvas: prepared.documentCanvas,
          binaryCanvas: prepared.binaryCanvas,
          ocrText: text,
        }
      : null,
  };
}

export { terminateOcrWorker, getOcrWorker };
