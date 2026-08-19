import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectDeviceTier,
  getDeviceProfile,
  resetDeviceProfileCache,
  getCameraVideoConstraints,
} from "../deviceCapability.js";
import { limitOcrCanvas } from "../classify.js";

describe("deviceCapability", () => {
  it("returns a known tier", () => {
    const tier = detectDeviceTier();
    assert.ok(["low", "mid", "high"].includes(tier));
  });

  it("exposes adaptive capture settings", () => {
    resetDeviceProfileCache();
    const p = getDeviceProfile();
    assert.ok(p.captureSize <= 640);
    assert.ok(p.ocrCropMax <= 320);
    assert.ok(p.tickMs >= 100);
    const cam = getCameraVideoConstraints(p);
    assert.equal(cam.facingMode.ideal, "environment");
    assert.ok(cam.width.ideal <= 1280);
  });
});

describe("limitOcrCanvas", () => {
  it("is a no-op when canvas missing", () => {
    assert.equal(limitOcrCanvas(null), null);
  });
});
