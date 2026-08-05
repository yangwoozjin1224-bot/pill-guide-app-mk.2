/**
 * Imprint-first multi-pill recognition pipeline.
 *
 * 1) detectInstances (OpenCV classical / YOLO stub)
 * 2) extractPillFeatures per crop (OCR + CV + observation LLM)
 * 3) matchFeaturesToDb (imprint → color/shape, cached)
 * 4) fallbackMultimodalGuess if empty (lowAccuracy)
 *
 * Each stage is independently importable for accuracy measurement.
 */

import { detectInstances, setCustomDetector, getActiveDetectorId } from "./detectors/index.js";
import { extractPillFeatures } from "./features/extract.js";
import { matchFeaturesToDb } from "./match/dbMatch.js";
import { fallbackMultimodalGuess } from "./match/fallbackLlm.js";
import {
  matchAgainstPrescriptionPool,
  boostIfInPrescriptionPool,
  getPrescriptionMatchMinConf,
} from "./prescription/index.js";
import { getOcrWorker } from "./ocr.js";
import { logDetectionRun, logEndToEnd } from "./metrics.js";

export function getImprintPipelineConfig() {
  return {
    stages: ["segment", "extract", "match_prescription_pool", "match_full_db", "fallback"],
    detector: getActiveDetectorId(),
    cropMargin: 0.18,
    confidenceTiers: ["exact", "partial", "color_shape", "weak"],
    prescriptionMinConf: getPrescriptionMatchMinConf(),
  };
}

/**
 * Stage 1 only — for isolated testing.
 */
export async function stageSegment(source, options = {}) {
  return detectInstances(source, {
    marginRatio: options.marginRatio ?? 0.18,
    sensitivity: options.sensitivity ?? 1.15,
    scales: options.scales,
    preferYolo: options.preferYolo,
    ...options,
  });
}

/**
 * Stage 2 only.
 */
export async function stageExtract(cropCanvas, options = {}) {
  return extractPillFeatures(cropCanvas, options);
}

/**
 * Stage 3 only.
 */
export async function stageMatch(features, options = {}) {
  return matchFeaturesToDb(features, options);
}

/**
 * Stage 4 only.
 */
export async function stageFallback(cropCanvas, features, options = {}) {
  return fallbackMultimodalGuess(cropCanvas, features, options);
}

function toLegacyBest(candidate, matchSource) {
  if (!candidate?.item) return null;
  const item = candidate.item;
  return {
    ...item,
    ...candidate,
    itemSeq: item.itemSeq || item.ITEM_SEQ,
    name: item.name || item.ITEM_NAME || item.itemName,
    fusedScore: candidate.confidence,
    ocrScore: candidate.tier === "exact" ? 1 : candidate.tier === "partial" ? 0.7 : 0.3,
    matchTier: candidate.tier,
    matchSource: matchSource || null,
  };
}

/**
 * Full pipeline.
 *
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {object} options
 * @param {Function} options.apiFetch - async (query) => raw API items
 * @param {Function} [options.candidateFetcher] - legacy adapter; wrapped into apiFetch if needed
 * @param {Array} [options.candidatePool] - prescription drugs (Phase 1 priority pool)
 */
export async function runImprintPipeline(sourceCanvas, options = {}) {
  const {
    apiFetch,
    candidateFetcher,
    candidatePool = [],
    maxInstances = 8,
    topK = 10,
    useLlm = true,
    useFallbackLlm = true,
    llmFetcher,
    debug = false,
    bagHints = [],
  } = options;

  const fetchFn =
    apiFetch ||
    (candidateFetcher
      ? async (query) => {
          // Adapt legacy candidateFetcher({ mark, color, shape, itemName })
          return (
            (await candidateFetcher({
              mark: query.print_front || "",
              color: query.color_class1 || "",
              shape: query.drug_shape || "",
              itemName: query.item_name || "",
              markCandidates: query.print_front ? [query.print_front] : [],
            })) || []
          );
        }
      : null);

  if (!fetchFn) {
    throw new Error("runImprintPipeline requires apiFetch or candidateFetcher");
  }

  const pool =
    candidatePool?.length > 0
      ? candidatePool
      : (bagHints || []).map((name) => ({ name, source: "bag_ocr" }));

  const segmented = await stageSegment(sourceCanvas, options);
  const detections = (segmented.detections || []).slice(0, maxInstances);
  logDetectionRun({ detectedCount: detections.length });

  if (!detections.length) {
    logEndToEnd({ success: false });
    return {
      results: [],
      detectorSource: segmented.source,
      config: getImprintPipelineConfig(),
      pipeline: "imprint-db",
      debug: debug ? { segmented } : null,
    };
  }

  const worker = await getOcrWorker("eng");

  const results = [];
  for (let i = 0; i < detections.length; i++) {
    const det = detections[i];
    const features = await stageExtract(det.cropCanvas, {
      box: det.box,
      area: det.area,
      shapeHint: det.shape,
      worker,
      useLlm,
      llmFetcher,
      thoroughOcr: true,
    });

    let matchSource = null;
    let match = { candidates: [], empty: true, ambiguous: false };

    // Phase 1: prescription pool first
    if (pool.length) {
      const poolHit = matchAgainstPrescriptionPool(features, pool, {
        topK,
        minConf: getPrescriptionMatchMinConf(),
      });
      if (!poolHit.empty && poolHit.matchSource === "prescription") {
        match = {
          candidates: poolHit.candidates,
          empty: false,
          ambiguous: poolHit.candidates[0]?.tier === "prescription_prior",
          imprintUsed: Boolean(features.imprintFront),
          features,
        };
        matchSource = "prescription";
      }
    }

    // Fallback: full MFDS DB
    if (match.empty) {
      match = await stageMatch(features, {
        apiFetch: fetchFn,
        topK,
        allowColorShapeOnly: true,
      });
      if (!match.empty) {
        matchSource = "full_db";
        if (pool.length) {
          match = {
            ...match,
            candidates: boostIfInPrescriptionPool(match.candidates, pool),
          };
        }
      }
    }

    // Legacy bag name pull if still empty
    if (match.empty && bagHints?.length) {
      const extra = [];
      for (const name of bagHints.slice(0, 3)) {
        const list = (await fetchFn({ item_name: name })) || [];
        extra.push(...list);
      }
      if (extra.length) {
        match = await stageMatch(features, {
          apiFetch: async () => extra,
          topK,
          useCache: false,
        });
        if (!match.empty) {
          matchSource = "prescription";
          match = { ...match, ambiguous: true };
        }
      }
    }

    let fallback = null;
    let lowAccuracy =
      Boolean(match.ambiguous) ||
      (matchSource === "prescription" && match.candidates[0]?.tier === "prescription_prior");
    if (match.empty && useFallbackLlm) {
      fallback = await stageFallback(det.cropCanvas, features, { fetcher: llmFetcher });
      if (fallback) {
        lowAccuracy = true;
        matchSource = "fallback_llm";
      }
    }

    const candidates = match.candidates || [];
    const top = candidates[0] || null;

    const fallbackCandidates =
      fallback?.guesses?.map((g) => ({
        name: g.name,
        itemSeq: "",
        confidence: g.confidence,
        score: g.confidence * 100,
        tier: "fallback",
        reasons: ["multimodal_fallback"],
        item: { name: g.name, itemName: g.name, ITEM_NAME: g.name },
      })) || [];

    const allCandidates = candidates.length ? candidates : fallbackCandidates;
    const effectiveSource = candidates.length ? matchSource : fallback ? "fallback_llm" : null;

    results.push({
      id: det.id || `det_${i}`,
      box: det.box,
      cropBox: det.cropBox,
      confidence: det.confidence,
      shape: features.shape || det.shape,
      color: features.color,
      mark: features.imprintFront,
      imprintFront: features.imprintFront,
      imprintBack: features.imprintBack,
      markConfidence: features.markConfidence,
      scoreLine: features.scoreLine,
      cropCanvas: det.cropCanvas,
      maskCanvas: det.maskCanvas,
      features,
      candidates: allCandidates.map((c) => ({
        name: c.name,
        itemSeq: c.itemSeq,
        confidence: c.confidence,
        tier: c.tier,
        reasons: c.reasons,
        item: c.item,
        matchSource: effectiveSource,
      })),
      best: toLegacyBest(top, effectiveSource) ||
        (fallbackCandidates[0] ? toLegacyBest(fallbackCandidates[0], "fallback_llm") : null),
      top10: allCandidates.slice(0, 10),
      fusedConfidence: top?.confidence || fallbackCandidates[0]?.confidence || 0,
      matchTier: top?.tier || (fallback ? "fallback" : "none"),
      matchSource: effectiveSource,
      ambiguous: match.ambiguous,
      lowAccuracy,
      warning: lowAccuracy ? fallback?.warning || "정확도가 낮을 수 있습니다" : null,
      fallback,
    });
  }

  const anyHit = results.some((r) => r.best && (r.fusedConfidence || 0) >= 0.3);
  logEndToEnd({ success: anyHit });

  return {
    results,
    detectorSource: segmented.source,
    config: getImprintPipelineConfig(),
    pipeline: "imprint-db",
    bagHints,
    candidatePoolSize: pool.length,
    debug: debug
      ? {
          boxes: results.map((r) => ({
            ...r.box,
            mark: r.mark,
            tier: r.matchTier,
            matchSource: r.matchSource,
            fused: r.fusedConfidence,
          })),
          crops: results.map((r) => r.cropCanvas),
        }
      : null,
  };
}

export { setCustomDetector, detectInstances };
