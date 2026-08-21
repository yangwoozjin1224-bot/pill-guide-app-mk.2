/**
 * Unit tests for imprint-first matching (pure functions, no DOM).
 * Run: node --test src/vision/__tests__/confidence.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidateAgainstFeatures, rankCandidates } from "../match/confidence.js";
import { cacheKey, getCached, setCached, clearMatchCache, _memoryForTests } from "../match/cache.js";
import { matchFeaturesToDb } from "../match/dbMatch.js";

describe("scoreCandidateAgainstFeatures", () => {
  it("exact imprint beats color-only", () => {
    const item = {
      PRINT_FRONT: "TYLENOL",
      PRINT_BACK: "",
      COLOR_CLASS1: "하양",
      DRUG_SHAPE: "원형",
      ITEM_NAME: "타이레놀",
    };
    const exact = scoreCandidateAgainstFeatures(item, {
      imprintFront: "TYLENOL",
      color: "하양",
      shape: "원형",
    });
    const colorOnly = scoreCandidateAgainstFeatures(item, {
      imprintFront: "",
      color: "하양",
      shape: "원형",
    });
    assert.equal(exact.tier, "exact");
    assert.equal(colorOnly.tier, "color_shape");
    assert.ok(exact.confidence > colorOnly.confidence);
  });

  it("partial imprint scores between exact and color", () => {
    const item = { PRINT_FRONT: "ABCD12", COLOR_CLASS1: "분홍", DRUG_SHAPE: "타원형" };
    const partial = scoreCandidateAgainstFeatures(item, { imprintFront: "ABCD", color: "분홍" });
    assert.equal(partial.tier, "partial");
    assert.ok(partial.confidence >= 0.5);
  });
});

describe("rankCandidates", () => {
  it("orders exact first", () => {
    const items = [
      { PRINT_FRONT: "XX", COLOR_CLASS1: "하양", DRUG_SHAPE: "원형", name: "A" },
      { PRINT_FRONT: "MARK1", COLOR_CLASS1: "하양", DRUG_SHAPE: "원형", name: "B" },
    ];
    const ranked = rankCandidates(items, { imprintFront: "MARK1", color: "하양", shape: "원형" });
    assert.equal(ranked[0].name, "B");
    assert.equal(ranked[0].tier, "exact");
  });
});

describe("cache", () => {
  it("round-trips memory cache", () => {
    clearMatchCache();
    const key = cacheKey({ mark: "ABC", color: "하양" });
    setCached(key, [{ itemSeq: "1", name: "테스트" }]);
    const hit = getCached(key);
    assert.equal(hit[0].name, "테스트");
    assert.ok(_memoryForTests.has(key));
    clearMatchCache();
  });
});

describe("matchFeaturesToDb", () => {
  it("queries imprint first via apiFetch", async () => {
    const calls = [];
    const apiFetch = async (q) => {
      calls.push(q);
      if (q.print_front === "XYZ9") {
        return [
          {
            ITEM_SEQ: "100",
            ITEM_NAME: "테스트정",
            PRINT_FRONT: "XYZ9",
            COLOR_CLASS1: "하양",
            DRUG_SHAPE: "원형",
          },
        ];
      }
      return [];
    };

    const out = await matchFeaturesToDb(
      { imprintFront: "XYZ9", color: "하양", shape: "원형", markCandidates: [] },
      { apiFetch, useCache: false, topK: 5 }
    );

    assert.ok(calls.some((c) => c.print_front === "XYZ9"));
    assert.equal(out.empty, false);
    assert.equal(out.candidates[0].tier, "exact");
    assert.equal(out.candidates[0].name, "테스트정");
  });

  it("returns empty then allows color_shape shortlist", async () => {
    const apiFetch = async (q) => {
      if (q.color_class1 === "분홍" && q.drug_shape === "원형") {
        return [
          {
            ITEM_SEQ: "2",
            ITEM_NAME: "분홍원형약",
            PRINT_FRONT: "OTHER",
            COLOR_CLASS1: "분홍",
            DRUG_SHAPE: "원형",
          },
        ];
      }
      return [];
    };
    const out = await matchFeaturesToDb(
      { imprintFront: "", color: "분홍", shape: "원형", markCandidates: [] },
      { apiFetch, useCache: false, allowColorShapeOnly: true }
    );
    assert.equal(out.imprintUsed, false);
    assert.equal(out.ambiguous, true);
    assert.ok(out.candidates.length >= 1);
    assert.equal(out.candidates[0].tier, "color_shape");
  });
});
