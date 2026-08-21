/**
 * Match extracted features against a prescription candidate pool (no full DB).
 * Pure / independently testable.
 */

import { rankCandidates } from "../match/confidence.js";
import { similarity } from "../fuzzy.js";
import { getPrescriptionMatchMinConf } from "./context.js";

function toMatchItem(drug) {
  return {
    itemSeq: drug.itemSeq || "",
    name: drug.name || "",
    itemName: drug.name || "",
    entpName: drug.entpName || "",
    imageUrl: drug.imageUrl || "",
    tag: "처방약",
    mark: drug.mark || drug.PRINT_FRONT || "",
    PRINT_FRONT: drug.PRINT_FRONT || drug.mark || "",
    PRINT_BACK: drug.PRINT_BACK || "",
    shape: drug.shape || drug.DRUG_SHAPE || "",
    DRUG_SHAPE: drug.DRUG_SHAPE || drug.shape || "",
    color: drug.color || drug.COLOR_CLASS1 || "",
    COLOR_CLASS1: drug.COLOR_CLASS1 || drug.color || "",
  };
}

/**
 * Score features against prescription pool.
 * If imprint/color/shape weak, also boost by name presence in pool (bag OCR name).
 *
 * @returns {{
 *   candidates: array,
 *   empty: boolean,
 *   matchSource: 'prescription' | null,
 *   bestConfidence: number
 * }}
 */
export function matchAgainstPrescriptionPool(features, candidatePool = [], options = {}) {
  const minConf = options.minConf ?? getPrescriptionMatchMinConf();
  const pool = (candidatePool || []).map(toMatchItem).filter((d) => d.name || d.itemSeq);

  if (!pool.length) {
    return { candidates: [], empty: true, matchSource: null, bestConfidence: 0 };
  }

  let ranked = rankCandidates(pool, features || {}, { minScore: 8 });

  const imprint = String(features?.imprintFront || "").trim();

  // If OCR provided an imprint but nothing in the pool matches it, do NOT
  // accept color/shape-only hits here — fall through to full DB instead.
  if (imprint.length >= 2) {
    const imprintHit = ranked.find(
      (r) => r.tier === "exact" || r.tier === "partial"
    );
    if (!imprintHit) {
      return {
        candidates: ranked.slice(0, options.topK || 10),
        empty: true,
        matchSource: null,
        bestConfidence: ranked[0]?.confidence || 0,
        belowThreshold: true,
        reason: "imprint_not_in_pool",
      };
    }
    ranked = ranked.filter((r) => r.tier === "exact" || r.tier === "partial");
  }

  // Name-prior boost: if imprint weak/missing, keep pool items (small pools).
  if (!ranked.length || (ranked[0]?.confidence || 0) < minConf) {
    if (!imprint && pool.length <= 8) {
      const soft = pool.map((item) => {
        const base = rankCandidates([item], features, { minScore: 0 })[0];
        const prior = pool.length <= 3 ? 0.58 : 0.5;
        const confidence = Math.min(
          0.78,
          Math.max(base?.confidence || 0, prior) + (base?.hasColor ? 0.06 : 0) + (base?.hasShape ? 0.04 : 0)
        );
        return {
          item,
          name: item.name,
          itemSeq: item.itemSeq,
          confidence,
          score: confidence * 100,
          tier: base?.tier && base.tier !== "none" ? base.tier : "prescription_prior",
          reasons: [...(base?.reasons || []), "prescription_pool"],
        };
      });
      soft.sort((a, b) => b.confidence - a.confidence);
      if (!ranked.length) ranked = soft;
      else {
        const byId = new Map(ranked.map((r) => [r.itemSeq || r.name, r]));
        for (const s of soft) {
          const k = s.itemSeq || s.name;
          const prev = byId.get(k);
          if (!prev || s.confidence > prev.confidence) byId.set(k, s);
        }
        ranked = Array.from(byId.values()).sort((a, b) => b.confidence - a.confidence);
      }
    }
  }

  // Extra: if imprint matches nothing but pool name fuzzy-matches OCR garbage — skip
  // Prefer items whose PRINT_FRONT overlaps imprint when available
  const top = ranked[0];
  const bestConfidence = top?.confidence || 0;
  const accepted = bestConfidence >= minConf;

  if (!accepted) {
    return {
      candidates: ranked.slice(0, options.topK || 10),
      empty: true,
      matchSource: null,
      bestConfidence,
      belowThreshold: true,
    };
  }

  return {
    candidates: ranked.slice(0, options.topK || 10).map((c) => ({
      ...c,
      reasons: [...(c.reasons || []), "prescription_pool"],
    })),
    empty: false,
    matchSource: "prescription",
    bestConfidence,
  };
}

/**
 * Filter full-DB ranked list to those in prescription pool (optional soft filter).
 */
export function boostIfInPrescriptionPool(ranked, candidatePool = []) {
  const names = (candidatePool || []).map((d) => String(d.name || "").trim()).filter(Boolean);
  const seqs = new Set(
    (candidatePool || []).map((d) => String(d.itemSeq || "")).filter(Boolean)
  );
  if (!names.length && !seqs.size) return ranked;

  return (ranked || [])
    .map((c) => {
      const name = c.name || c.item?.name || "";
      const seq = String(c.itemSeq || c.item?.itemSeq || "");
      let boost = 0;
      if (seq && seqs.has(seq)) boost = 0.12;
      else {
        for (const n of names) {
          const s = similarity(n, name);
          if (s >= 0.55) boost = Math.max(boost, s * 0.15);
        }
      }
      return {
        ...c,
        confidence: Math.min(0.99, (c.confidence || 0) + boost),
        reasons: boost ? [...(c.reasons || []), "prescription_boost"] : c.reasons,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}
