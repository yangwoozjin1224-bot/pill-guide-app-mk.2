/**
 * Adaptive threshold / contour / watershed unit tests (no canvas DOM required for core).
 * Run: node --test src/vision/__tests__/detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adaptiveThresholdMask,
  findContours,
  distanceTransform,
  watershedSplit,
} from "../detectors/classicalOpenCv.js";

function makeBlobGray(w, h, blobs) {
  const gray = new Float32Array(w * h);
  gray.fill(220); // bright background
  for (const b of blobs) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        gray[y * w + x] = b.v ?? 80;
      }
    }
  }
  return gray;
}

describe("adaptiveThresholdMask + findContours", () => {
  it("finds a dark blob on bright bg", () => {
    const w = 64;
    const h = 64;
    const gray = makeBlobGray(w, h, [{ x: 20, y: 20, w: 18, h: 18, v: 60 }]);
    const mask = adaptiveThresholdMask(gray, w, h, { win: 11, C: 5 });
    const { comps } = findContours(mask, w, h);
    assert.ok(comps.length >= 1);
    assert.ok(comps.some((c) => c.area > 50));
  });
});

describe("watershedSplit", () => {
  it("computes distance transform inside a filled component", () => {
    const w = 40;
    const h = 40;
    const pixels = [];
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) pixels.push(y * w + x);
    }
    const comp = {
      pixels,
      area: pixels.length,
      minX: 10,
      maxX: 29,
      minY: 10,
      maxY: 29,
      cx: 19.5,
      cy: 19.5,
      id: 1,
    };
    const { dist } = distanceTransform(comp, w, h);
    assert.ok(dist.some((d) => d > 2));
    const parts = watershedSplit(comp, w, h, { minDist: 3, minSeparation: 8 });
    assert.ok(parts.length >= 1);
  });
});
