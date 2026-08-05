/**
 * Fuzzy matching against drug-name candidates / DB strings.
 * Why: OCR rarely returns perfect Hangul; Levenshtein + normalized forms recover near-misses.
 */

export function normalizeDrugName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}]/g, "")
    .replace(/밀리그람|밀리그램/g, "mg")
    .replace(/서방성필름코팅정|필름코팅정|서방정/g, "정")
    .replace(/연질캡슐/g, "캡슐");
}

export function levenshtein(a, b) {
  const s = normalizeDrugName(a);
  const t = normalizeDrugName(b);
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function similarity(a, b) {
  const na = normalizeDrugName(a);
  const nb = normalizeDrugName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Map noisy OCR tokens to best DB / candidate names.
 */
export function fuzzyMatchNames(ocrNames, dbNames, minScore = 0.55) {
  const results = [];
  for (const raw of ocrNames) {
    let best = null;
    let bestScore = 0;
    for (const db of dbNames) {
      const score = similarity(raw, db);
      if (score > bestScore) {
        bestScore = score;
        best = db;
      }
    }
    if (best && bestScore >= minScore) {
      results.push({ raw, matched: best, score: bestScore });
    } else {
      results.push({ raw, matched: raw, score: bestScore });
    }
  }
  // unique by matched
  const seen = new Set();
  return results.filter((r) => {
    const key = normalizeDrugName(r.matched);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Seed dictionary of common forms to help OCR correction when API list is empty */
export const COMMON_DRUG_HINTS = [
  "타이레놀",
  "타이레놀정",
  "게보린",
  "펜잘",
  "아스피린",
  "부루펜",
  "이소티논",
  "베아제",
  "가스모틴",
  "제일파프",
  "판콜",
  "판피린",
  "콜대원",
  "탁센",
  "낙센",
  "맥시부펜",
  "이가탄",
  "훼스탈",
  "베아론",
  "노스카나",
];

/**
 * Correct a single OCR drug name using hint dictionary (Levenshtein).
 * Why: Hangul OCR often swaps similar glyphs; local dictionary recovers before API.
 */
export function correctDrugNameWithHints(raw, hints = COMMON_DRUG_HINTS, minScore = 0.62) {
  const q = String(raw || "").trim();
  if (!q) return { corrected: q, score: 0, fromHint: false };
  let best = q;
  let bestScore = 0;
  for (const h of hints) {
    const s = similarity(q, h);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  if (bestScore >= minScore && best !== q) {
    return { corrected: best, score: bestScore, fromHint: true };
  }
  return { corrected: q, score: bestScore, fromHint: false };
}

/** Alias used by document pipeline */
export function fuzzyMatchDrugName(query, entries, { threshold = 0.42, limit = 5 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const scored = list
    .map((entry) => {
      const name = typeof entry === "string" ? entry : entry.name || entry.ITEM_NAME || "";
      return { entry: typeof entry === "string" ? { name: entry } : entry, score: similarity(query, name) };
    })
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}
