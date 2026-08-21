/**
 * Imprint-first MFDS 낱알식별 DB matching with local cache.
 */

import { cacheKey, getCached, setCached } from "./cache.js";
import { rankCandidates, cleanMark } from "./confidence.js";

function expandMarks(features) {
  const raw = [
    features.imprintFront,
    features.imprintBack,
    ...(features.markCandidates || []),
  ]
    .map(cleanMark)
    .filter((m) => m.length >= 2 && m.length <= 14);

  const expanded = [];
  for (const m of raw) {
    expanded.push(m);
    if (m.length >= 4) expanded.push(m.slice(0, 4), m.slice(0, 3));
    if (m.length >= 3) expanded.push(m.slice(0, 3));
  }
  return [...new Set(expanded)].slice(0, 8);
}

/**
 * @param {object} features - extracted pill features
 * @param {object} options
 * @param {Function} options.apiFetch - async (query) => item[]
 *   query uses print_front / color_class1 / drug_shape / item_name
 */
export async function matchFeaturesToDb(features, options = {}) {
  const {
    apiFetch,
    topK = 10,
    allowColorShapeOnly = true,
    useCache = true,
  } = options;

  if (typeof apiFetch !== "function") {
    throw new Error("matchFeaturesToDb requires apiFetch");
  }

  const marks = expandMarks(features || {});
  const color = String(features?.color || "").trim();
  const shape = String(features?.shape || "").trim();
  const map = new Map();

  const ingest = (list) => {
    for (const it of list || []) {
      const id = String(it.itemSeq || it.ITEM_SEQ || it.id || "");
      if (!id || map.has(id)) continue;
      map.set(id, {
        itemSeq: id,
        name: it.name || it.ITEM_NAME || it.itemName || "",
        itemName: it.name || it.ITEM_NAME || it.itemName || "",
        entpName: it.entpName || it.ENTP_NAME || "",
        imageUrl: it.imageUrl || it.ITEM_IMAGE || "",
        tag: it.tag || it.CLASS_NAME || "의약품",
        mark: it.mark || it.PRINT_FRONT || "",
        PRINT_FRONT: it.PRINT_FRONT || it.mark || "",
        PRINT_BACK: it.PRINT_BACK || "",
        shape: it.shape || it.DRUG_SHAPE || "",
        DRUG_SHAPE: it.DRUG_SHAPE || it.shape || "",
        color: it.color || it.COLOR_CLASS1 || "",
        COLOR_CLASS1: it.COLOR_CLASS1 || it.color || "",
      });
    }
  };

  const pullCached = async (query) => {
    const key = cacheKey(query);
    if (useCache) {
      const hit = getCached(key);
      if (hit) {
        ingest(hit);
        return;
      }
    }
    const list = (await apiFetch(query)) || [];
    if (useCache) setCached(key, list);
    ingest(list);
  };

  // 1) Imprint-first
  for (const m of marks) {
    await pullCached({ print_front: m });
    if (color) await pullCached({ print_front: m, color_class1: color });
    if (shape) await pullCached({ print_front: m, drug_shape: shape });
  }

  // 2) Color+shape only when imprint missing/ambiguous and allowed
  if (!marks.length && allowColorShapeOnly && (color || shape)) {
    const q = {};
    if (color) q.color_class1 = color;
    if (shape) q.drug_shape = shape;
    await pullCached(q);
  }

  const items = Array.from(map.values());
  let ranked = rankCandidates(items, features, { minScore: marks.length ? 22 : 18 });

  // If imprint existed but ranking empty, keep raw imprint API hits with weak score
  if (!ranked.length && marks.length && items.length) {
    ranked = rankCandidates(items, { ...features, markCandidates: marks }, { minScore: 10 });
  }

  const ambiguous = !marks.length || ranked.every((r) => r.tier === "color_shape" || r.tier === "weak");

  return {
    candidates: ranked.slice(0, topK),
    candidateCount: ranked.length,
    imprintUsed: marks.length > 0,
    ambiguous: ambiguous && ranked.length > 0,
    empty: ranked.length === 0,
    features,
  };
}
