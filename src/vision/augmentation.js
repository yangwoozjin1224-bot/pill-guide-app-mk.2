/**
 * Augmentation helpers (training + inference TTA).
 *
 * Why: pills appear at arbitrary angles under varying light/shadow.
 * Client inference uses a subset via classify.extractImprintOcr.
 * When training YOLO-seg / classifier offline, apply the full set below.
 */

import { cloneCanvas } from "./preprocess.js";
import { rotateCanvas } from "./detect.js";

export function augmentBrightness(canvas, delta = 0.1) {
  return photometric(canvas, { brightness: delta });
}

export function augmentContrast(canvas, factor = 1.2) {
  return photometric(canvas, { contrast: factor });
}

export function augmentGamma(canvas, gamma = 1.2) {
  return photometric(canvas, { gamma });
}

export function augmentBlur(canvas, radius = 1) {
  const c = cloneCanvas(canvas);
  const ctx = c.getContext("2d");
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";
  return c;
}

export function augmentNoise(canvas, amount = 12) {
  const c = cloneCanvas(canvas);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function photometric(canvas, { brightness = 0, contrast = 1, gamma = 1 } = {}) {
  const c = cloneCanvas(canvas);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const inv = 1 / Math.max(0.05, gamma);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = img.data[i + k] / 255;
      v = (v - 0.5) * contrast + 0.5 + brightness;
      v = Math.max(0, Math.min(1, v));
      img.data[i + k] = Math.round(Math.pow(v, inv) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Full training-style batch: cardinal + random angles + photometric + blur/noise */
export function buildTrainingAugmentations(canvas, { randomAngles = 4 } = {}) {
  const out = [];
  for (const deg of [0, 90, 180, 270]) {
    out.push({ name: `rot${deg}`, canvas: deg === 0 ? cloneCanvas(canvas) : rotateCanvas(canvas, deg) });
  }
  for (let i = 0; i < randomAngles; i++) {
    const deg = Math.round((Math.random() * 70 - 35) * 10) / 10;
    out.push({ name: `rot${deg}`, canvas: rotateCanvas(canvas, deg) });
  }
  out.push({ name: "bright", canvas: augmentBrightness(canvas, 0.12) });
  out.push({ name: "dark", canvas: augmentBrightness(canvas, -0.12) });
  out.push({ name: "contrast", canvas: augmentContrast(canvas, 1.35) });
  out.push({ name: "gamma", canvas: augmentGamma(canvas, 1.25) });
  out.push({ name: "blur", canvas: augmentBlur(canvas, 1) });
  out.push({ name: "noise", canvas: augmentNoise(canvas, 14) });
  return out;
}
