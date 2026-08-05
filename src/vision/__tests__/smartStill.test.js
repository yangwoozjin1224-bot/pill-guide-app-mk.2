/**
 * Smart still B+C unit tests
 * Run: node --test src/vision/__tests__/smartStill.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLocalMaxAt,
  shouldCaptureAtPrevious,
  getSmartStillConfig,
} from "../capture/smartStill.js";

describe("isLocalMaxAt", () => {
  it("detects middle peak", () => {
    assert.equal(isLocalMaxAt([0.3, 0.8, 0.4], 1), true);
    assert.equal(isLocalMaxAt([0.3, 0.8, 0.4], 0), false);
  });
});

describe("shouldCaptureAtPrevious B+C", () => {
  it("captures on local max above minScore with ok history", () => {
    const scores = [0.3, 0.7, 0.5];
    const oks = [false, true, true];
    assert.equal(shouldCaptureAtPrevious(scores, oks, { minScore: 0.42 }), true);
  });

  it("rejects when peak below minScore (B)", () => {
    const scores = [0.2, 0.3, 0.25];
    const oks = [true, true, true];
    assert.equal(shouldCaptureAtPrevious(scores, oks, { minScore: 0.42 }), false);
  });

  it("rejects when peak quality was not ok", () => {
    const scores = [0.3, 0.9, 0.4];
    const oks = [true, false, true];
    assert.equal(shouldCaptureAtPrevious(scores, oks, { minScore: 0.42 }), false);
  });

  it("rejects when not a local max (C)", () => {
    const scores = [0.4, 0.5, 0.8]; // rising — previous is not peak
    const oks = [true, true, true];
    assert.equal(shouldCaptureAtPrevious(scores, oks, { minScore: 0.42 }), false);
  });
});

describe("getSmartStillConfig", () => {
  it("returns defaults", () => {
    const c = getSmartStillConfig();
    assert.equal(c.maxStills, 3);
    assert.ok(c.minScore > 0);
  });
});
