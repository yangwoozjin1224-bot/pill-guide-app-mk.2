/**
 * OpenCV-style classical pill detector (pure JS, no opencv.js binary).
 *
 * Pipeline:
 *   grayscale → adaptive threshold → morphology → contours (CC)
 *   → distance transform + watershed peaks for overlapping pills
 *   → shape prior → NMS → padded crop
 *
 * Testable entry: `detectOpenCvClassical(source, options)`
 */

import { preprocessForDetection, resizeCanvas, cloneCanvas } from "../preprocess.js";
import { cropWithMargin, nms } from "./crop.js";
import { DETECTOR_IDS, normalizeDetections } from "./types.js";

const SHAPE_LABELS = ["원형", "타원형", "장방형", "캡슐형", "기타"];

function toGray(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, w, h, rgba: data };
}

/** Adaptive threshold → binary foreground mask (1 = pill-ish). */
export function adaptiveThresholdMask(gray, w, h, { win = 15, C = 7, invertBrightBg = true } = {}) {
  const mask = new Uint8Array(w * h);
  // Estimate if background is bright (desk) vs dark
  let borderSum = 0;
  let borderN = 0;
  for (let x = 0; x < w; x += 4) {
    borderSum += gray[x] + gray[(h - 1) * w + x];
    borderN += 2;
  }
  for (let y = 0; y < h; y += 4) {
    borderSum += gray[y * w] + gray[y * w + (w - 1)];
    borderN += 2;
  }
  const borderMean = borderSum / Math.max(1, borderN);
  const brightBg = invertBrightBg && borderMean > 140;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -win; dy <= win; dy += 2) {
        for (let dx = -win; dx <= win; dx += 2) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          sum += gray[yy * w + xx];
          cnt += 1;
        }
      }
      const mean = sum / cnt;
      const v = gray[y * w + x];
      // Pills usually differ from local mean; on bright desk darker blobs, etc.
      const isFg = brightBg ? v < mean - C || Math.abs(v - mean) > C + 10 : v > mean + C;
      mask[y * w + x] = isFg ? 1 : 0;
    }
  }
  return mask;
}

function morphCloseOpen(mask, w, h) {
  const dilate = (src) => {
    const out = new Uint8Array(src.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (src[(y + dy) * w + (x + dx)]) v = 1;
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  const erode = (src) => {
    const out = new Uint8Array(src.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let v = 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!src[(y + dy) * w + (x + dx)]) v = 0;
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return erode(dilate(dilate(erode(mask))));
}

/** Contour-like connected components. */
export function findContours(mask, w, h) {
  const labels = new Int32Array(w * h);
  let label = 0;
  const comps = [];

  const flood = (sx, sy, id) => {
    const stack = [[sx, sy]];
    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    const pixels = [];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const idx = y * w + x;
      if (!mask[idx] || labels[idx]) continue;
      labels[idx] = id;
      area += 1;
      sumX += x;
      sumY += y;
      pixels.push(idx);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return { minX, maxX, minY, maxY, area, cx: sumX / area, cy: sumY / area, pixels, id };
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] && !labels[idx]) {
        label += 1;
        comps.push(flood(x, y, label));
      }
    }
  }
  return { comps, labels };
}

/**
 * Distance transform (chessboard/approx Euclidean) on a component mask.
 * Returns Float32Array same size as full frame, 0 outside component.
 */
export function distanceTransform(comp, w, h) {
  const dist = new Float32Array(w * h);
  const inComp = new Uint8Array(w * h);
  for (const p of comp.pixels) inComp[p] = 1;

  // Two-pass approximate EDT
  const INF = 1e6;
  for (let i = 0; i < dist.length; i++) dist[i] = inComp[i] ? INF : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inComp[i]) {
        dist[i] = 0;
        continue;
      }
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - w] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + 1.414);
      if (x < w - 1 && y > 0) d = Math.min(d, dist[i - w + 1] + 1.414);
      dist[i] = d === INF ? 1 : d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!inComp[i]) continue;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < h - 1) d = Math.min(d, dist[i + w] + 1);
      if (x < w - 1 && y < h - 1) d = Math.min(d, dist[i + w + 1] + 1.414);
      if (x > 0 && y < h - 1) d = Math.min(d, dist[i + w - 1] + 1.414);
      dist[i] = d;
    }
  }
  return { dist, inComp };
}

/** Find local maxima in distance map as watershed seeds. */
export function findDistancePeaks(dist, inComp, w, h, { minDist = 6, minSeparation = 12 } = {}) {
  const peaks = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!inComp[i]) continue;
      const v = dist[i];
      if (v < minDist) continue;
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (dist[(y + dy) * w + (x + dx)] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) peaks.push({ x, y, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const kept = [];
  for (const p of peaks) {
    if (kept.every((k) => (k.x - p.x) ** 2 + (k.y - p.y) ** 2 >= minSeparation ** 2)) {
      kept.push(p);
    }
  }
  return kept;
}

/**
 * Marker-controlled watershed: flood from peaks; returns split components.
 * Only splits when ≥2 strong peaks (overlapping pills).
 */
export function watershedSplit(comp, w, h, options = {}) {
  const { dist, inComp } = distanceTransform(comp, w, h);
  const peaks = findDistancePeaks(dist, inComp, w, h, options);
  if (peaks.length < 2) return [comp];

  // Too-weak secondary peaks → don't split
  if (peaks[1].v < peaks[0].v * 0.45) return [comp];

  const labels = new Int32Array(w * h);
  const queue = [];
  peaks.forEach((p, idx) => {
    const id = idx + 1;
    labels[p.y * w + p.x] = id;
    queue.push([p.x, p.y, id]);
  });

  let qi = 0;
  while (qi < queue.length) {
    const [x, y, id] = queue[qi++];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!inComp[ni] || labels[ni]) continue;
      labels[ni] = id;
      queue.push([nx, ny, id]);
    }
  }

  const groups = new Map();
  for (const p of comp.pixels) {
    const id = labels[p] || 1;
    if (!groups.has(id)) {
      groups.set(id, {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        area: 0,
        sumX: 0,
        sumY: 0,
        pixels: [],
        id,
      });
    }
    const g = groups.get(id);
    const x = p % w;
    const y = (p / w) | 0;
    g.pixels.push(p);
    g.area += 1;
    g.sumX += x;
    g.sumY += y;
    if (x < g.minX) g.minX = x;
    if (x > g.maxX) g.maxX = x;
    if (y < g.minY) g.minY = y;
    if (y > g.maxY) g.maxY = y;
  }

  return Array.from(groups.values())
    .filter((g) => g.area >= Math.max(20, comp.area * 0.12))
    .map((g) => ({
      ...g,
      cx: g.sumX / g.area,
      cy: g.sumY / g.area,
    }));
}

export function classifyShape(comp) {
  const bw = comp.maxX - comp.minX + 1;
  const bh = comp.maxY - comp.minY + 1;
  const ratio = bw / Math.max(bh, 1);
  const boxArea = bw * bh;
  const fill = comp.area / Math.max(boxArea, 1);
  const circ = (4 * Math.PI * comp.area) / Math.max(1, (2 * (bw + bh)) ** 2 / 4);

  if (ratio > 1.7 || ratio < 0.55) {
    if (fill > 0.55) return { shape: "캡슐형", shapeScore: 0.85 };
    return { shape: "장방형", shapeScore: 0.7 };
  }
  if (circ > 0.55 && fill > 0.6) return { shape: "원형", shapeScore: 0.9 };
  if (fill > 0.55) return { shape: "타원형", shapeScore: 0.8 };
  return { shape: "기타", shapeScore: 0.4 };
}

function maskToOverlay(labels, id, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === id) {
      const o = i * 4;
      img.data[o] = 52;
      img.data[o + 1] = 211;
      img.data[o + 2] = 153;
      img.data[o + 3] = 120;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function compsToBoxes(comps, labels, sw, sh, sx, sy, frameArea) {
  const minArea = frameArea * 0.0018;
  const maxArea = frameArea * 0.42;
  const out = [];

  for (const comp of comps) {
    if (comp.area < minArea || comp.area > maxArea) continue;
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    const ratio = bw / Math.max(bh, 1);
    if (ratio > 4 || ratio < 0.25) continue;
    if (bw < 8 || bh < 8) continue;

    const { shape, shapeScore } = classifyShape(comp);
    if (!SHAPE_LABELS.includes(shape)) continue;

    const fill = comp.area / Math.max(bw * bh, 1);
    const sizeScore = Math.min(1, comp.area / (frameArea * 0.04));
    const confidence = Math.max(
      0.15,
      Math.min(0.98, 0.35 * fill + 0.4 * shapeScore + 0.25 * sizeScore)
    );

    out.push({
      x: comp.minX * sx,
      y: comp.minY * sy,
      w: bw * sx,
      h: bh * sy,
      confidence,
      shape,
      area: comp.area * sx * sy,
      maskLabel: comp.id,
      maskCanvas: labels
        ? maskToOverlay(labels, labels[comp.pixels[0]] || comp.id, sw, sh)
        : null,
    });
  }
  return out;
}

/**
 * Run OpenCV-style detection on a preprocessed canvas at one scale.
 * Exported for unit-style testing of mask → contour → watershed.
 */
export function detectAtScaleOpenCv(preprocessed, scaleSide, originW, originH, options = {}) {
  const scaled = resizeCanvas(preprocessed, scaleSide);
  const sw = scaled.width;
  const sh = scaled.height;
  const { gray, w, h } = toGray(scaled);
  let mask = adaptiveThresholdMask(gray, w, h, {
    win: options.win ?? 15,
    C: options.C ?? Math.max(5, 8 / (options.sensitivity || 1)),
  });
  mask = morphCloseOpen(mask, w, h);

  const { comps, labels } = findContours(mask, w, h);
  const frameArea = w * h;

  // Split overlapping blobs via watershed
  let splitComps = [];
  for (const comp of comps) {
    const minArea = frameArea * 0.0018;
    if (comp.area < minArea) continue;
    const parts =
      comp.area > frameArea * 0.02
        ? watershedSplit(comp, w, h, {
            minDist: Math.max(4, Math.sqrt(comp.area) * 0.08),
            minSeparation: Math.max(10, Math.sqrt(comp.area) * 0.2),
          })
        : [comp];
    splitComps = splitComps.concat(parts);
  }

  const sx = originW / sw;
  const sy = originH / sh;
  return compsToBoxes(splitComps, labels, sw, sh, sx, sy, frameArea).map((b) => ({
    ...b,
    scale: scaleSide,
  }));
}

export async function detectOpenCvClassical(source, options = {}) {
  const {
    scales = [640, 960, 1280],
    sensitivity = 1.15,
    marginRatio = 0.18,
    minConfidenceKeep = 0.18,
    twoPass = true,
  } = options;

  const pre = preprocessForDetection(source, Math.max(...scales));
  if (!pre) return { detections: [], debug: { preprocessed: null }, source: DETECTOR_IDS.OPENCV };

  let candidates = [];
  for (const side of scales) {
    candidates = candidates.concat(
      detectAtScaleOpenCv(pre, side, pre.width, pre.height, { sensitivity })
    );
  }

  let merged = nms(candidates, 0.4).filter((d) => d.confidence >= minConfidenceKeep);

  if (twoPass) {
    const weak = merged.filter((d) => d.confidence < 0.45);
    const strong = merged.filter((d) => d.confidence >= 0.45);
    const refined = [...strong];
    for (const wbox of weak) {
      const expand = 0.35;
      const x = Math.max(0, wbox.x - wbox.w * expand);
      const y = Math.max(0, wbox.y - wbox.h * expand);
      const ww = Math.min(pre.width - x, wbox.w * (1 + expand * 2));
      const hh = Math.min(pre.height - y, wbox.h * (1 + expand * 2));
      const roi = document.createElement("canvas");
      roi.width = Math.max(64, Math.round(ww));
      roi.height = Math.max(64, Math.round(hh));
      roi.getContext("2d").drawImage(pre, x, y, ww, hh, 0, 0, roi.width, roi.height);
      const local = detectAtScaleOpenCv(roi, 640, roi.width, roi.height, {
        sensitivity: sensitivity * 1.1,
      }).map((d) => ({
        ...d,
        x: d.x + x,
        y: d.y + y,
        confidence: Math.min(0.95, d.confidence + 0.08),
        refined: true,
      }));
      if (local.length) refined.push(...local);
      else refined.push(wbox);
    }
    merged = nms(refined, 0.4);
  }

  const detections = normalizeDetections(
    merged.map((d, i) => {
      const { canvas, cropBox } = cropWithMargin(pre, d, marginRatio);
      return {
        id: `det_${i}`,
        box: { x: d.x, y: d.y, w: d.w, h: d.h },
        cropBox,
        confidence: d.confidence,
        shape: d.shape,
        maskCanvas: d.maskCanvas,
        cropCanvas: canvas,
        refined: !!d.refined,
        area: d.area,
      };
    })
  );

  return {
    detections,
    debug: {
      preprocessed: pre,
      rawCount: candidates.length,
      afterNms: merged.length,
      scales,
      method: "adaptive-threshold + contour + watershed",
    },
    source: DETECTOR_IDS.OPENCV,
  };
}
