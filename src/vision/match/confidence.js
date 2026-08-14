/**
 * Confidence scoring for DB candidates vs extracted features.
 *
 * Tier order:
 *  1. Exact imprint (front or back)
 *  2. Partial imprint
 *  3. Color + shape only
 */

function cleanMark(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * True imprint overlap — never treat empty DB marks as a match
 * (JS: "GEBORIN".includes("") === true caused 졸뎀속붕정 false positives).
 */
export function imprintOverlaps(queryMark, candidateMark) {
  const q = cleanMark(queryMark);
  const c = cleanMark(candidateMark);
  if (q.length < 2 || c.length < 2) return false;
  if (q === c) return true;
  // Require meaningful substring (min 2 chars already); reject tiny stubs swallowing long marks
  if (c.includes(q) || q.includes(c)) {
    const shorter = Math.min(q.length, c.length);
    const longer = Math.max(q.length, c.length);
    return shorter >= 2 && shorter / longer >= 0.4;
  }
  return false;
}

function colorMatch(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function shapeMatch(a, b) {
  const x = String(a || "").replace(/형$/, "").trim();
  const y = String(b || "").replace(/형$/, "").trim();
  if (!x || !y) return false;
  if (x === y) return true;
  // Avoid "타원".includes("원") false positive
  const aliases = {
    원: ["원", "원형"],
    타원: ["타원", "타원형", "장방"],
    장방: ["장방", "장방형", "타원"],
    삼각: ["삼각", "삼각형"],
    사각: ["사각", "사각형"],
    캡슐: ["캡슐", "캡슐형"],
  };
  for (const group of Object.values(aliases)) {
    const xin = group.some((g) => x === g || x.startsWith(g));
    const yin = group.some((g) => y === g || y.startsWith(g));
    if (xin && yin) return true;
  }
  return false;
}

/**
 * @returns {{ score: number, tier: 'exact'|'partial'|'color_shape'|'weak'|'none', reasons: string[] }}
 */
export function scoreCandidateAgainstFeatures(item, features = {}) {
  const front = cleanMark(item.PRINT_FRONT || item.printFront || item.mark);
  const back = cleanMark(item.PRINT_BACK || item.printBack);
  const queryMarks = [
    features.imprintFront,
    features.imprintBack,
    ...(features.markCandidates || []),
  ]
    .map(cleanMark)
    .filter((m) => m.length >= 2);

  const reasons = [];
  let bestImprint = 0;
  let tier = "none";

  for (const m of queryMarks) {
    if (front === m || back === m) {
      bestImprint = Math.max(bestImprint, 100);
      reasons.push("imprint_exact");
      tier = "exact";
    } else if (imprintOverlaps(m, front) || imprintOverlaps(m, back)) {
      const ref = imprintOverlaps(m, front) ? front || m : back || m;
      const overlap = Math.min(m.length, ref.length) / Math.max(m.length, ref.length, 1);
      const s = Math.round(45 + 40 * overlap);
      if (s > bestImprint) {
        bestImprint = s;
        if (tier !== "exact") {
          tier = "partial";
          reasons.push("imprint_partial");
        }
      }
    } else if (m.length >= 3 && front.length >= 3) {
      let pref = 0;
      while (pref < m.length && pref < front.length && m[pref] === front[pref]) pref += 1;
      if (pref >= 3) {
        const s = 28 + pref * 6;
        if (s > bestImprint) {
          bestImprint = s;
          if (tier === "none" || tier === "color_shape" || tier === "weak") {
            tier = "partial";
            reasons.push("imprint_prefix");
          }
        }
      }
    }
  }

  let score = bestImprint;
  const hasColor = colorMatch(features.color, item.COLOR_CLASS1 || item.color);
  const hasShape = shapeMatch(features.shape, item.DRUG_SHAPE || item.shape);

  if (hasColor) {
    score += bestImprint > 0 ? 12 : 22;
    reasons.push("color");
  }
  if (hasShape) {
    score += bestImprint > 0 ? 8 : 18;
    reasons.push("shape");
  }

  if (bestImprint === 0) {
    if (hasColor && hasShape) {
      tier = "color_shape";
      score = Math.max(score, 40);
    } else if (hasColor || hasShape) {
      tier = "weak";
      score = Math.max(score, 22);
    } else {
      tier = "none";
      score = 0;
    }
  }

  // Map to 0..1 confidence with tier floors/ceilings
  let confidence = 0;
  if (tier === "exact") confidence = Math.min(0.98, 0.82 + (score - 100) * 0.002 + (hasColor ? 0.05 : 0));
  else if (tier === "partial") confidence = Math.min(0.88, 0.55 + score * 0.003);
  else if (tier === "color_shape") confidence = Math.min(0.55, 0.32 + score * 0.004);
  else if (tier === "weak") confidence = Math.min(0.35, 0.18 + score * 0.004);
  else confidence = 0;

  return { score, confidence, tier, reasons: [...new Set(reasons)], hasColor, hasShape };
}

export function rankCandidates(items, features, { minScore = 20 } = {}) {
  return (items || [])
    .map((item) => {
      const scored = scoreCandidateAgainstFeatures(item, features);
      return {
        item,
        name: item.name || item.ITEM_NAME || item.itemName || "",
        itemSeq: item.itemSeq || item.ITEM_SEQ || "",
        confidence: scored.confidence,
        score: scored.score,
        tier: scored.tier,
        reasons: scored.reasons,
      };
    })
    .filter((r) => r.score >= minScore || r.tier === "exact")
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score);
}

export { cleanMark, colorMatch, shapeMatch };
