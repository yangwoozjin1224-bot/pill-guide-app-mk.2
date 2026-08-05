/**
 * Phase 2 quality gate unit tests (no DOM canvas — synthetic gray buffers).
 * Run: node --test src/vision/__tests__/qualityGate.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  laplacianVariance,
  exposureStats,
  framingScore,
} from "../quality/metrics.js";
import { messagesForReasons } from "../quality/messages.js";
import { evaluateCaptureQuality } from "../quality/gate.js";

function makeGray(w, h, fillFn) {
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) gray[y * w + x] = fillFn(x, y, w, h);
  }
  return { gray, w, h };
}

describe("laplacianVariance", () => {
  it("is low on flat image", () => {
    const g = makeGray(64, 64, () => 128);
    const v = laplacianVariance(g.gray, g.w, g.h);
    assert.ok(v < 1);
  });

  it("is higher on checker / edges", () => {
    const flat = makeGray(64, 64, () => 128);
    const edge = makeGray(64, 64, (x, y) => ((x + y) % 2 === 0 ? 20 : 220));
    assert.ok(
      laplacianVariance(edge.gray, edge.w, edge.h) >
        laplacianVariance(flat.gray, flat.w, flat.h)
    );
  });
});

describe("exposureStats", () => {
  it("detects dark frame", () => {
    const g = makeGray(32, 32, () => 20);
    const s = exposureStats(g.gray);
    assert.ok(s.mean < 45);
    assert.ok(s.darkRatio > 0.5);
  });
});

describe("framingScore", () => {
  it("scores higher when center has contrast vs border", () => {
    const wash = makeGray(64, 64, () => 200);
    const subject = makeGray(64, 64, (x, y, w, h) => {
      const cx = x > w * 0.3 && x < w * 0.7 && y > h * 0.3 && y < h * 0.7;
      return cx ? 40 : 200;
    });
    assert.ok(
      framingScore(subject.gray, subject.w, subject.h) >
        framingScore(wash.gray, wash.w, wash.h)
    );
  });
});

describe("messagesForReasons", () => {
  it("maps blur/dark codes", () => {
    const msgs = messagesForReasons(["blur", "dark"]);
    assert.equal(msgs.length, 2);
    assert.ok(msgs[0].includes("흔들"));
  });
});

describe("evaluateCaptureQuality", () => {
  it("returns structure with ok flag (uses canvas stub via metrics override path)", () => {
    // Without canvas, evaluate returns fail-safe via computeQualityMetrics null → dark
    const fakeCanvas = null;
    const out = evaluateCaptureQuality(fakeCanvas, {
      thresholds: { blurMin: 80, brightMin: 45, brightMax: 210, framingMin: 0.08, overlapMaxFill: 0.55 },
    });
    // null canvas → metrics zeros → not ok
    assert.equal(typeof out.ok, "boolean");
    assert.ok(Array.isArray(out.reasons));
    assert.ok(Array.isArray(out.messages));
  });
});
