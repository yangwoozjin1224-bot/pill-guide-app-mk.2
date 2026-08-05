/**
 * Phase 5 ensemble unit tests
 * Run: node --test src/vision/__tests__/ensemble.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldRequestEnsemble,
  detectionToVote,
  EnsembleBuffer,
  fuseEnsembleVotes,
  buildEnsemblePipelineResult,
} from "../ensemble/index.js";

describe("shouldRequestEnsemble", () => {
  const cfg = { enabled: true, minConf: 0.55, frames: 3, timeoutMs: 8000 };

  it("skips high-confidence exact", () => {
    assert.equal(
      shouldRequestEnsemble(
        { best: { name: "A" }, fusedConfidence: 0.9, matchTier: "exact" },
        cfg
      ),
      false
    );
  });

  it("requests for low confidence", () => {
    assert.equal(
      shouldRequestEnsemble(
        { best: { name: "A" }, fusedConfidence: 0.4, matchTier: "partial" },
        cfg
      ),
      true
    );
  });

  it("requests for color_shape / prior", () => {
    assert.equal(
      shouldRequestEnsemble(
        { best: { name: "A" }, fusedConfidence: 0.7, matchTier: "color_shape" },
        cfg
      ),
      true
    );
  });

  it("disabled config never requests", () => {
    assert.equal(
      shouldRequestEnsemble(
        { best: { name: "A" }, fusedConfidence: 0.1, matchTier: "weak" },
        { ...cfg, enabled: false }
      ),
      false
    );
  });
});

describe("fuseEnsembleVotes", () => {
  it("picks majority name", () => {
    const fused = fuseEnsembleVotes([
      [{ name: "타이레놀", itemSeq: "1", confidence: 0.5 }],
      [{ name: "타이레놀", itemSeq: "1", confidence: 0.55 }],
      [{ name: "아스피린", itemSeq: "2", confidence: 0.8 }],
    ]);
    assert.equal(fused.method, "majority");
    assert.equal(fused.picks[0].itemSeq, "1");
    assert.equal(fused.frameCount, 3);
  });

  it("falls back to max_conf when all unique", () => {
    const fused = fuseEnsembleVotes([
      [{ name: "A", itemSeq: "1", confidence: 0.4 }],
      [{ name: "B", itemSeq: "2", confidence: 0.7 }],
      [{ name: "C", itemSeq: "3", confidence: 0.5 }],
    ]);
    assert.equal(fused.method, "max_conf");
    assert.equal(fused.picks[0].itemSeq, "2");
  });
});

describe("EnsembleBuffer", () => {
  it("becomes ready after N frames", () => {
    const buf = new EnsembleBuffer({ enabled: true, minConf: 0.55, frames: 2, timeoutMs: 8000 });
    const det = {
      best: { name: "A", itemSeq: "1", fusedScore: 0.4 },
      fusedConfidence: 0.4,
      matchTier: "partial",
      mark: "AA",
    };
    buf.addFrame([det]);
    const st = buf.addFrame([det]);
    assert.equal(st.ready, true);
    assert.ok(st.frameCount >= 2);
    assert.ok(detectionToVote(det).itemSeq === "1");
  });
});

describe("buildEnsemblePipelineResult", () => {
  it("attaches ensemble meta", () => {
    const last = {
      results: [
        {
          best: { name: "A", itemSeq: "1" },
          fusedConfidence: 0.4,
          box: { x: 0, y: 0, w: 10, h: 10 },
        },
      ],
    };
    const fused = fuseEnsembleVotes([
      [detectionToVote(last.results[0])],
      [detectionToVote({ ...last.results[0], fusedConfidence: 0.5 })],
    ]);
    const out = buildEnsemblePipelineResult(last, fused);
    assert.equal(out.ensemble.used, true);
    assert.ok(out.results[0].ensemble.used);
  });
});
