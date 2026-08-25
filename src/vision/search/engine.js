/**
 * Pill Vision Search Engine.
 *
 * Default path (imprintPipeline !== false):
 *   segment → extract (OCR+CV+observation LLM) → imprint-first DB match → fallback LLM
 *
 * Legacy path (imprintPipeline: false):
 *   enhance → mask segment → embed → vector + OCR fusion re-rank
 */

import { preprocessForDetection } from "../preprocess.js";
import { detectPills, rotateCanvas } from "../detect.js";
import {
  extractImprintOcr,
  isValidImprintMark,
  estimateColorLabel,
  clusterByEmbedding,
  buildEmbedding,
} from "../classify.js";
import { getOcrWorker } from "../ocr.js";
import { embed, embedCatalogItem, cosineSimilarity, setEmbeddingProvider } from "./embed.js";
import { VectorIndex, globalPillIndex } from "./index.js";
import { rerankVisionCandidates, pickFinalPrediction } from "./fusion.js";
import { crossCheckWithBag } from "./bag.js";
import { fuseFrontBack } from "./dual.js";
import { logRetrievalRun } from "./evaluate.js";
import { logDetectionRun, logEndToEnd } from "../metrics.js";
import { runImprintPipeline, getImprintPipelineConfig } from "../imprintPipeline.js";
import { setCustomDetector } from "../detectors/index.js";
import { getPrescriptionDrugs } from "../prescription/index.js";

let externalDetector = null;

export function setExternalDetector(fn) {
  externalDetector = typeof fn === "function" ? fn : null;
  // Keep detectors registry in sync for imprint pipeline
  setCustomDetector(fn);
}

export function getVisionSearchConfig() {
  return {
    pipeline: getImprintPipelineConfig().stages,
    defaultPath: "imprint-db",
    legacyPath: [
      "enhance",
      "instance-segmentation",
      "crop",
      "vision-embedding",
      "vector-search",
      "ocr",
      "feature-fusion",
      "re-ranking",
      "final-prediction",
    ],
    rerankWeights: { embedding: 0.4, ocr: 0.3, shape: 0.15, color: 0.1, size: 0.05 },
    cropMargin: 0.18,
    retrieveTopK: 10,
    embedding: "handcrafted-dense-128 (CLIP/ViT via setEmbeddingProvider)",
  };
}

async function segment(source, options = {}) {
  if (externalDetector) {
    try {
      const ext = await externalDetector(source, options);
      if (ext?.detections?.length) return { ...ext, source: "external" };
    } catch (e) {
      console.warn("[vision-search] external detector failed", e);
    }
  }
  const enhanced = preprocessForDetection(source, options.maxSide || 1280);
  const result = await detectPills(enhanced || source, {
    scales: options.scales || [640, 960, 1280],
    sensitivity: options.sensitivity ?? 1.15,
    marginRatio: options.marginRatio ?? 0.15,
    twoPass: options.twoPass !== false,
    minConfidenceKeep: options.minConfidenceKeep ?? 0.18,
  });
  return { ...result, source: "classical-mask", enhanced };
}

async function retrieveCandidates(query, { candidateFetcher, index = globalPillIndex, topK = 10 }) {
  const pool = [];
  if (typeof candidateFetcher === "function") {
    try {
      const list =
        (await candidateFetcher({
          mark: query.imprint,
          color: query.color,
          shape: query.shape,
          markCandidates: query.markCandidates,
          itemName: query.itemName,
        })) || [];
      for (const item of list) {
        const id = String(item.itemSeq || item.ITEM_SEQ || item.id || item.name);
        if (!id) continue;
        const embedding = embedCatalogItem(item);
        index.upsert({ id, embedding, item, meta: { source: "api" } });
        pool.push({ id, item, embedding, score: cosineSimilarity(query.embedding, embedding) });
      }
    } catch (e) {
      console.warn("[vision-search] candidateFetcher failed", e);
    }
  }

  const fromIndex = index.search(query.embedding, { topK: topK * 2 });
  const byId = new Map();
  for (const row of [...pool, ...fromIndex]) {
    const prev = byId.get(row.id);
    if (!prev || row.score > prev.score) byId.set(row.id, row);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function refineLowConfidence(cropCanvas, query, ctx) {
  const variants = [];
  for (const s of [1.4, 1.8]) {
    const enlarged = document.createElement("canvas");
    enlarged.width = Math.round(cropCanvas.width * s);
    enlarged.height = Math.round(cropCanvas.height * s);
    enlarged.getContext("2d").drawImage(cropCanvas, 0, 0, enlarged.width, enlarged.height);
    for (const deg of [0, 90, 180, 270, 15, -15]) {
      variants.push(deg === 0 ? enlarged : rotateCanvas(enlarged, deg));
    }
  }

  let best = null;
  for (const v of variants.slice(0, 8)) {
    const ocr = await extractImprintOcr(v, ctx.worker, { thorough: false });
    const emb = await embed(v, {
      imprint: ocr.mark || query.imprint,
      shape: query.shape,
      area: query.area,
    });
    const q = {
      ...query,
      embedding: emb,
      imprint: isValidImprintMark(ocr.mark) ? ocr.mark : query.imprint,
      markCandidates: [...(query.markCandidates || []), ...(ocr.all || [])],
    };
    const retrieved = await retrieveCandidates(q, ctx);
    let ranked = rerankVisionCandidates(retrieved, {
      imprint: q.imprint,
      color: q.color,
      shape: q.shape,
      area: q.area,
      aspect: q.aspect,
      bagHints: ctx.bagHints || [],
    });
    if (ctx.bagHints?.length) ranked = crossCheckWithBag(ranked, { drugNames: ctx.bagHints });
    const pred = pickFinalPrediction(ranked, { minConfidence: 0.4 });
    if (!best || pred.confidence > best.confidence) {
      best = { ...pred, query: q, ranked };
    }
  }
  return best;
}

/**
 * Main entry: Vision Search on a frame/canvas.
 * Defaults to imprint-first DB pipeline; set imprintPipeline:false for legacy fusion path.
 */
export async function runVisionSearch(sourceCanvas, options = {}) {
  const {
    candidateFetcher,
    apiFetch,
    bagHints = [],
    bagStructured = null,
    frontBack = null,
    debug = false,
    maxInstances = 8,
    topK = 10,
    shareByEmbedding = true,
    imprintPipeline = true,
    useLlm,
    useFallbackLlm,
    llmFetcher,
  } = options;

  const hints = bagHints.length ? bagHints : bagStructured?.drugNames || [];

  if (imprintPipeline !== false && !frontBack) {
    const pool =
      options.candidatePool ||
      (typeof getPrescriptionDrugs === "function" ? getPrescriptionDrugs() : []);
    const out = await runImprintPipeline(sourceCanvas, {
      ...options,
      candidateFetcher,
      apiFetch,
      bagHints: hints,
      candidatePool: pool,
      maxInstances,
      topK,
      useLlm,
      useFallbackLlm,
      llmFetcher,
      debug,
    });
    logRetrievalRun({
      topK,
      resultCount: (out.results || []).filter((r) => r.best).length,
      finalAccepted: (out.results || []).some((r) => r.best && (r.fusedConfidence || 0) >= 0.3),
    });
    return out;
  }

  const segmented = await segment(sourceCanvas, options);
  const detections = (segmented.detections || []).slice(0, maxInstances);
  logDetectionRun({ detectedCount: detections.length });

  if (!detections.length) {
    logEndToEnd({ success: false });
    logRetrievalRun({ resultCount: 0, finalAccepted: false });
    return {
      results: [],
      detectorSource: segmented.source,
      config: getVisionSearchConfig(),
      debug: debug ? { enhanced: segmented.enhanced } : null,
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

  const queries = [];
  for (const det of detections) {
    const colorInfo = estimateColorLabel(det.cropCanvas);
    const aspect = det.box.w / Math.max(det.box.h, 1);

    let query;
    if (frontBack?.frontCanvas || frontBack?.backCanvas) {
      query = await fuseFrontBack(
        frontBack.frontCanvas || det.cropCanvas,
        frontBack.backCanvas,
        worker,
        { color: colorInfo.label, shape: det.shape, area: det.area, aspect }
      );
    } else {
      const ocr = await extractImprintOcr(det.cropCanvas, worker, { thorough: false });
      const embedding = await embed(det.cropCanvas, {
        imprint: ocr.mark,
        shape: det.shape,
        area: det.area,
      });
      query = {
        embedding,
        imprint: ocr.mark,
        markCandidates: ocr.all,
        color: colorInfo.label,
        shape: det.shape,
        area: det.area,
        aspect,
        markConfidence: ocr.confidence,
      };
    }

    const clusterEmb = buildEmbedding({
      rgb: colorInfo.rgb,
      shape: det.shape,
      area: det.area,
      mark: query.imprint,
    });

    queries.push({
      det,
      query,
      clusterEmb,
      color: colorInfo.label,
      rgb: colorInfo.rgb,
    });
  }

  const clusterInput = queries.map((q, i) => ({
    ...q.det,
    id: q.det.id || `det_${i}`,
    embedding: q.clusterEmb,
    detConfidence: q.det.confidence,
    _qIndex: i,
  }));
  const clusters = shareByEmbedding
    ? clusterByEmbedding(clusterInput, 0.2)
    : clusterInput.map((item, i) => ({
        id: `c_${i}`,
        members: [item],
        representative: item,
        centroid: item.embedding,
      }));

  const ctx = {
    candidateFetcher,
    index: globalPillIndex,
    topK,
    worker,
    bagHints: hints,
  };

  const clusterPredictions = [];
  for (const cluster of clusters) {
    const repIdx = cluster.representative._qIndex;
    const rep = queries[repIdx];
    let retrieved = await retrieveCandidates(rep.query, ctx);

    if (!retrieved.length && !isValidImprintMark(rep.query.imprint) && !hints.length) {
      clusterPredictions.push({
        clusterId: cluster.id,
        memberIndexes: cluster.members.map((m) => m._qIndex),
        prediction: { best: null, confidence: 0, needsRefine: true, top10: [] },
        ranked: [],
        query: rep.query,
      });
      continue;
    }

    if (!retrieved.length && hints.length && typeof candidateFetcher === "function") {
      for (const name of hints.slice(0, 3)) {
        try {
          const list = await candidateFetcher({
            mark: "",
            itemName: name,
            color: rep.query.color,
          });
          for (const item of list || []) {
            const id = String(item.itemSeq || item.ITEM_SEQ || item.id);
            if (!id) continue;
            const embedding = embedCatalogItem(item);
            retrieved.push({
              id,
              item,
              embedding,
              score: cosineSimilarity(rep.query.embedding, embedding),
            });
          }
        } catch {
          /* ignore */
        }
      }
      retrieved = retrieved.sort((a, b) => b.score - a.score).slice(0, topK);
    }

    let ranked = rerankVisionCandidates(retrieved, {
      imprint: rep.query.imprint,
      color: rep.query.color,
      shape: rep.query.shape,
      area: rep.query.area,
      aspect: rep.query.aspect,
      bagHints: hints,
    });
    if (hints.length) ranked = crossCheckWithBag(ranked, { drugNames: hints });

    let prediction = pickFinalPrediction(ranked, { minConfidence: 0.42 });

    if (prediction.needsRefine && rep.det.cropCanvas) {
      const refined = await refineLowConfidence(rep.det.cropCanvas, rep.query, ctx);
      if (refined && refined.confidence > prediction.confidence) {
        prediction = refined;
        ranked = refined.ranked || ranked;
      }
    }

    if (prediction.best?.item) {
      const item = prediction.best.item;
      const id = String(item.itemSeq || item.ITEM_SEQ || item.id);
      if (id) {
        globalPillIndex.upsert({
          id,
          embedding: rep.query.embedding,
          item,
          meta: { source: "accepted", imprint: rep.query.imprint },
        });
      }
    }

    clusterPredictions.push({
      clusterId: cluster.id,
      memberIndexes: cluster.members.map((m) => m._qIndex),
      prediction,
      ranked,
      query: rep.query,
    });
  }

  const byMember = new Map();
  for (const cp of clusterPredictions) {
    for (const mi of cp.memberIndexes) byMember.set(mi, cp);
  }

  const results = queries.map((q, i) => {
    const cp = byMember.get(i);
    const best = cp?.prediction?.best || null;
    const item = best?.item || null;
    return {
      id: q.det.id || `det_${i}`,
      box: q.det.box,
      confidence: q.det.confidence,
      shape: q.det.shape,
      color: q.color,
      mark: cp?.query?.imprint || q.query.imprint,
      markConfidence: q.query.markConfidence,
      cropCanvas: q.det.cropCanvas,
      maskCanvas: q.det.maskCanvas,
      embedding: q.query.embedding,
      top10: (cp?.ranked || cp?.prediction?.top10 || []).slice(0, 10),
      best: item
        ? {
            ...item,
            ...best,
            itemSeq: item.itemSeq || item.ITEM_SEQ,
            name: item.name || item.ITEM_NAME || item.itemName,
            ocrScore: best.ocrScore,
            fusedScore: best.fusedScore,
            embeddingSim: best.embeddingSim,
          }
        : null,
      fusedConfidence: cp?.prediction?.confidence || 0,
      clusterId: cp?.clusterId,
    };
  });

  const anyHit = results.some((r) => r.best && (r.fusedConfidence || 0) >= 0.35);
  logEndToEnd({ success: anyHit });
  logRetrievalRun({
    topK,
    resultCount: results.filter((r) => r.best).length,
    finalAccepted: anyHit,
  });

  return {
    results,
    clusters: clusterPredictions,
    detectorSource: segmented.source,
    config: getVisionSearchConfig(),
    bagHints: hints,
    debug: debug
      ? {
          enhanced: segmented.enhanced,
          boxes: results.map((r) => ({
            ...r.box,
            mark: r.mark,
            confidence: r.confidence,
            fused: r.fusedConfidence,
          })),
          crops: results.map((r) => r.cropCanvas),
          masks: results.map((r) => r.maskCanvas),
          indexSize: globalPillIndex.size(),
        }
      : null,
  };
}

export { setEmbeddingProvider, globalPillIndex, VectorIndex, embed };
