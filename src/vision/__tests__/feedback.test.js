/**
 * Phase 4 feedback store tests
 * Run: node --test src/vision/__tests__/feedback.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addFeedback,
  listFeedback,
  clearFeedback,
  getFeedbackCount,
  getFeedbackStats,
} from "../feedback/index.js";

// Minimal localStorage polyfill for Node
if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
}

describe("feedback store", () => {
  beforeEach(() => clearFeedback());

  it("adds correction without image by default", () => {
    const e = addFeedback({
      predicted: { name: "잘못된약", itemSeq: "1", confidence: 0.6 },
      correct: { name: "타이레놀정", itemSeq: "2", source: "search" },
      consentImageStore: false,
      imageDataUrl: "data:image/jpeg;base64,xxx",
    });
    assert.equal(e.correct.name, "타이레놀정");
    assert.equal(e.imageDataUrl, null);
    assert.equal(getFeedbackCount(), 1);
  });

  it("stores thumbnail only when consent true", () => {
    const e = addFeedback({
      predicted: { name: "A" },
      correct: { name: "B", source: "manual" },
      consentImageStore: true,
      imageDataUrl: "data:image/jpeg;base64,abc",
    });
    assert.equal(e.consentImageStore, true);
    assert.ok(e.imageDataUrl);
  });

  it("rejects empty correct name", () => {
    assert.throws(() =>
      addFeedback({ predicted: { name: "A" }, correct: { name: "  " } })
    );
  });
});

describe("feedback stats", () => {
  beforeEach(() => clearFeedback());

  it("ranks top wrong predictions", () => {
    addFeedback({ predicted: { name: "X" }, correct: { name: "A" } });
    addFeedback({ predicted: { name: "X" }, correct: { name: "B" } });
    addFeedback({ predicted: { name: "Y" }, correct: { name: "A" } });
    const s = getFeedbackStats({ topN: 5 });
    assert.equal(s.total, 3);
    assert.equal(s.topWrongPredictions[0].name, "X");
    assert.equal(s.topWrongPredictions[0].count, 2);
    assert.equal(s.topCorrections[0].name, "A");
  });
});
