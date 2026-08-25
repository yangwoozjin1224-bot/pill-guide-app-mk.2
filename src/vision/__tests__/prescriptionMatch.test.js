/**
 * Phase 1: prescription pool matching tests
 * Run: node --test src/vision/__tests__/prescriptionMatch.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  setPrescriptionContext,
  clearPrescriptionContext,
  getPrescriptionDrugs,
  getPrescriptionDrugNames,
  matchAgainstPrescriptionPool,
} from "../prescription/index.js";

describe("PrescriptionContext", () => {
  beforeEach(() => {
    clearPrescriptionContext();
  });

  it("stores and returns drugs", () => {
    setPrescriptionContext({
      drugs: [
        { name: "타이레놀정", itemSeq: "1", PRINT_FRONT: "TYLENOL", color: "하양", shape: "원형" },
        { name: "게보린정", itemSeq: "2", PRINT_FRONT: "GEVORIN" },
      ],
    });
    assert.equal(getPrescriptionDrugs().length, 2);
    assert.deepEqual(getPrescriptionDrugNames().sort(), ["게보린정", "타이레놀정"].sort());
  });
});

describe("matchAgainstPrescriptionPool", () => {
  const pool = [
    {
      name: "타이레놀정500밀리그램",
      itemSeq: "100",
      PRINT_FRONT: "TYLENOL",
      COLOR_CLASS1: "하양",
      DRUG_SHAPE: "원형",
    },
    {
      name: "아스피린장용정",
      itemSeq: "200",
      PRINT_FRONT: "ASPIRIN",
      COLOR_CLASS1: "하양",
      DRUG_SHAPE: "원형",
    },
  ];

  it("matches imprint inside pool with matchSource prescription", () => {
    const out = matchAgainstPrescriptionPool(
      { imprintFront: "TYLENOL", color: "하양", shape: "원형", markCandidates: [] },
      pool,
      { minConf: 0.4 }
    );
    assert.equal(out.empty, false);
    assert.equal(out.matchSource, "prescription");
    assert.equal(out.candidates[0].name.includes("타이레놀"), true);
    assert.ok(out.candidates[0].reasons.includes("prescription_pool"));
  });

  it("falls below threshold for wrong imprint → empty (caller should full_db)", () => {
    const out = matchAgainstPrescriptionPool(
      { imprintFront: "ZZZZ99", color: "하양", shape: "원형", markCandidates: [] },
      pool,
      { minConf: 0.55 }
    );
    // Wrong imprint should not accept as prescription hit
    assert.equal(out.matchSource, null);
    assert.equal(out.empty, true);
  });

  it("uses prescription prior when imprint missing and pool small", () => {
    const out = matchAgainstPrescriptionPool(
      { imprintFront: "", color: "하양", shape: "원형", markCandidates: [] },
      pool,
      { minConf: 0.45 }
    );
    assert.equal(out.empty, false);
    assert.equal(out.matchSource, "prescription");
    assert.ok(out.bestConfidence >= 0.45);
  });

  it("empty pool → empty", () => {
    const out = matchAgainstPrescriptionPool({ imprintFront: "A" }, [], { minConf: 0.4 });
    assert.equal(out.empty, true);
    assert.equal(out.matchSource, null);
  });
});
