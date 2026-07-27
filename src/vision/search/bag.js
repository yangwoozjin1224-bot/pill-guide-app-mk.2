/**
 * Medicine-bag / prescription structuring + cross-check with pill candidates.
 */

import { prepareDocumentForOcr, extractDrugNameCandidates } from "../document.js";
import { recognizeCanvas } from "../ocr.js";
import { correctDrugNameWithHints, fuzzyMatchNames, similarity } from "../fuzzy.js";
import { logOcr } from "../metrics.js";

const TIME_PATTERNS = [
  { re: /아침|조\s*식|기상/g, label: "아침" },
  { re: /점심|중\s*식|낮/g, label: "점심" },
  { re: /저녁|석\s*식|밤/g, label: "저녁" },
  { re: /취침|자기\s*전|취침\s*전/g, label: "취침전" },
];

/**
 * Parse structured fields from bag/prescription OCR text.
 * @returns {{ drugNames, doses, frequencies, times, rawText, confidence }}
 */
export function structureBagText(ocrText) {
  const text = String(ocrText || "");
  const drugNames = extractDrugNameCandidates(text).map((n) => {
    const c = correctDrugNameWithHints(n);
    return c.corrected;
  });

  const doses = [];
  const doseRe =
    /(\d+(?:\.\d+)?)\s*(mg|MG|g|G|mcg|μg|밀리그람|밀리그램|그램)/g;
  let m;
  while ((m = doseRe.exec(text)) !== null) {
    doses.push({ value: Number(m[1]), unit: m[2].toLowerCase().includes("g") && !m[2].toLowerCase().includes("m") ? "g" : "mg", raw: m[0] });
  }

  const frequencies = [];
  const freqRe =
    /1일\s*(\d+)\s*회|하루\s*(\d+)\s*번|(\d+)\s*회\s*\/\s*일|BID|TID|QD|하루\s*세\s*번|하루\s*두\s*번|하루\s*한\s*번/gi;
  while ((m = freqRe.exec(text)) !== null) {
    const n = m[1] || m[2] || m[3];
    if (n) frequencies.push({ perDay: Number(n), raw: m[0] });
    else if (/BID/i.test(m[0])) frequencies.push({ perDay: 2, raw: m[0] });
    else if (/TID/i.test(m[0])) frequencies.push({ perDay: 3, raw: m[0] });
    else if (/QD/i.test(m[0])) frequencies.push({ perDay: 1, raw: m[0] });
    else if (/세\s*번/.test(m[0])) frequencies.push({ perDay: 3, raw: m[0] });
    else if (/두\s*번/.test(m[0])) frequencies.push({ perDay: 2, raw: m[0] });
    else if (/한\s*번/.test(m[0])) frequencies.push({ perDay: 1, raw: m[0] });
  }

  const times = [];
  for (const { re, label } of TIME_PATTERNS) {
    if (re.test(text)) times.push(label);
    re.lastIndex = 0;
  }

  return {
    drugNames: [...new Set(drugNames)],
    doses,
    frequencies,
    times: [...new Set(times)],
    rawText: text,
  };
}

export async function recognizeMedicineBag(sourceCanvas, { searchFn, debug = false } = {}) {
  const prepared = prepareDocumentForOcr(sourceCanvas);
  const { text, confidence } = await recognizeCanvas(prepared.ocrCanvas || prepared.binaryCanvas, {
    langs: "kor+eng",
    psm: 6,
  });
  logOcr({ correct: !!text, charsTotal: text.length, charsOk: text.length });

  const structured = structureBagText(text);
  const items = [];
  const seen = new Set();

  if (typeof searchFn === "function") {
    for (const name of structured.drugNames.slice(0, 10)) {
      try {
        const list = await searchFn(name);
        if (!Array.isArray(list) || !list.length) continue;
        const fuzzy = fuzzyMatchNames(
          [name],
          list.map((it) => it.ITEM_NAME || it.name || it.itemName || "")
        );
        for (const f of fuzzy) {
          const hit =
            list.find((it) => (it.ITEM_NAME || it.name || it.itemName) === f.matched) ||
            list[0];
          const key = hit.ITEM_SEQ || hit.itemSeq || hit.id || f.matched;
          if (!key || seen.has(String(key))) continue;
          seen.add(String(key));
          items.push({
            ...hit,
            _matchScore: f.score,
            _query: name,
            _matchedName: f.matched,
          });
        }
      } catch (e) {
        console.warn("[bag] search failed", name, e);
      }
    }
  }

  return {
    ...structured,
    confidence,
    items,
    debug: debug ? { prepared, ocrText: text } : null,
  };
}

/**
 * Boost pill Top-K using bag OCR drug-name hints (cross-check).
 */
export function crossCheckWithBag(rankedCandidates, bagStructured) {
  const hints = bagStructured?.drugNames || [];
  if (!hints.length || !rankedCandidates?.length) {
    return rankedCandidates || [];
  }
  return rankedCandidates
    .map((c) => {
      const name = c.item?.ITEM_NAME || c.item?.name || c.item?.itemName || "";
      let boost = 0;
      let matchedHint = null;
      for (const h of hints) {
        const s = similarity(h, name);
        if (s > boost) {
          boost = s;
          matchedHint = h;
        }
      }
      const bagBoost = boost >= 0.45 ? boost * 0.35 : 0;
      return {
        ...c,
        bagCrossScore: boost,
        bagMatchedHint: matchedHint,
        fusedScore: Math.min(1, (c.fusedScore || 0) + bagBoost),
      };
    })
    .sort((a, b) => b.fusedScore - a.fusedScore);
}

/** Session bag hints for pill Vision Search cross-check */
let sessionBagHints = [];
let sessionBagStructured = null;

export function setSessionBagContext(structured) {
  sessionBagStructured = structured || null;
  sessionBagHints = structured?.drugNames || [];
}

export function getSessionBagHints() {
  return [...sessionBagHints];
}

export function getSessionBagStructured() {
  return sessionBagStructured;
}
