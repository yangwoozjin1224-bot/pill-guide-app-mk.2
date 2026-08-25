/**
 * Imprint-first MFDS 낱알식별 DB matching with local cache.
 *
 * NOTE: data.go.kr Service03 currently ignores print_front / color / shape
 * filters for many keys (returns the full catalog page). Working filter is
 * primarily item_name / item_seq. So we map OCR imprints → Korean name
 * candidates, query by item_name, then rank by PRINT_FRONT client-side.
 */

import { cacheKey, getCached, setCached } from "./cache.js";
import { rankCandidates, cleanMark, imprintOverlaps, colorMatch, shapeMatch } from "./confidence.js";

/** Common OTC imprint → Korean product name hints for item_name queries */
export const IMPRINT_NAME_HINTS = {
  TYLENOL: ["타이레놀"],
  TYLENOLER: ["타이레놀"],
  TYME: ["우먼스타이레놀", "타이레놀"],
  GEBORIN: ["게보린"],
  GEVORIN: ["게보린"],
  ADVIL: ["애드빌"],
  ZYRTEC: ["지르텍"],
  ASPIRIN: ["아스피린"],
  FESTAL: ["훼스탈"],
  BEAZYME: ["베아제"],
  BEASYME: ["베아제"],
  CLARITIN: ["클라리틴"],
  ALLEGRA: ["알레그라"],
  SMECTA: ["스멕타"],
  TACEN: ["탁센"],
  NAXEN: ["낙센"],
  BRUFEN: ["부루펜"],
  PENZAL: ["펜잘"],
};

export function expandMarks(features) {
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

export function nameHintsForMark(mark) {
  const m = cleanMark(mark);
  if (!m) return [];
  const hints = [];
  if (IMPRINT_NAME_HINTS[m]) hints.push(...IMPRINT_NAME_HINTS[m]);
  // prefix match in dictionary (e.g. TYLEN from TYLENOL)
  for (const [key, names] of Object.entries(IMPRINT_NAME_HINTS)) {
    if (key.startsWith(m) || m.startsWith(key.slice(0, Math.min(4, key.length)))) {
      hints.push(...names);
    }
  }
  return [...new Set(hints)].slice(0, 6);
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
    // Client-side imprint filter: API often ignores print_front and returns
    // an unfiltered page. Prefer rows that actually match the requested mark.
    let filtered = list;
    if (query.print_front && list.length) {
      const want = cleanMark(query.print_front);
      const matched = list.filter((it) => {
        const front = it.PRINT_FRONT || it.mark || "";
        const back = it.PRINT_BACK || "";
        return imprintOverlaps(want, front) || imprintOverlaps(want, back);
      });
      if (matched.length) filtered = matched;
      else filtered = []; // don't ingest unrelated catalog dump
    } else if ((query.color_class1 || query.drug_shape) && !query.item_name && !query.item_seq) {
      // API often ignores color/shape — keep only rows that actually match
      filtered = list.filter((it) => {
        const okColor = !query.color_class1 || colorMatch(query.color_class1, it.COLOR_CLASS1 || it.color);
        const okShape = !query.drug_shape || shapeMatch(query.drug_shape, it.DRUG_SHAPE || it.shape);
        return okColor && okShape;
      });
    }
    if (useCache) setCached(key, filtered);
    ingest(filtered);
  };

  // 1) Imprint-first (print_front + item_name hints)
  for (const m of marks) {
    await pullCached({ print_front: m });
    if (color) await pullCached({ print_front: m, color_class1: color });
    if (shape) await pullCached({ print_front: m, drug_shape: shape });

    // Service03: item_name is the reliable filter — map imprint → Korean names
    for (const name of nameHintsForMark(m)) {
      await pullCached({ item_name: name });
    }
  }

  // 2) Color+shape only when imprint missing — still ambiguous; never sole identity
  if (!marks.length && allowColorShapeOnly && (color || shape)) {
    const q = {};
    if (color) q.color_class1 = color;
    if (shape) q.drug_shape = shape;
    await pullCached(q);
  }

  const items = Array.from(map.values());
  // With an imprint query, drop color/shape-only rows that have no mark overlap
  let pool = items;
  if (marks.length) {
    pool = items.filter((it) => {
      const front = it.PRINT_FRONT || it.mark || "";
      const back = it.PRINT_BACK || "";
      return marks.some((m) => imprintOverlaps(m, front) || imprintOverlaps(m, back));
    });
  }

  let ranked = rankCandidates(pool, features, { minScore: marks.length ? 28 : 40 });

  // If imprint existed but ranking empty, keep imprint-overlapping API hits only
  if (!ranked.length && marks.length && pool.length) {
    ranked = rankCandidates(pool, { ...features, markCandidates: marks }, { minScore: 22 });
  }

  // Never promote blank-imprint drugs (e.g. 졸뎀속붕정) via color alone when we had OCR marks
  if (marks.length) {
    ranked = ranked.filter((r) => r.tier === "exact" || r.tier === "partial");
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
