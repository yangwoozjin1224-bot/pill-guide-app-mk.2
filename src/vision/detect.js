/**
 * Pill Detection (instance-aware classical segmentation).
 *
 * Why not end-to-end name classification:
 * - Detection recall must come first; naming belongs in Classification.
 *
 * Why Mask / instance separation over loose boxes:
 * - Pills often touch; boxes merge instances. We build per-pixel masks via
 *   multi-scale foreground extraction + connected components + shape priors,
 *   then derive boxes with margin.
 *
 * Plug-in note:
 * - `detectPills()` is the stable API. Later swap ClassicalSegmentDetector
 *   for YOLO-seg / SAM2 / Mask R-CNN by implementing the same return shape.
 */

import { cloneCanvas, resizeCanvas, preprocessForDetection } from "./preprocess.js";

const SHAPE_LABELS = ["원형", "타원형", "장방형", "캡슐형", "기타"];

function nms(boxes, iouThresh = 0.45) {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const b of sorted) {
    let ok = true;
    for (const k of kept) {
      if (iou(b, k) > iouThresh) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push(b);
  }
  return kept;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

function estimateBg(data, w, h) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const sample = (x, y) => {
    const i = (y * w + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  };
  for (let x = 0; x < w; x += 3) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += 3) {
    sample(0, y);
    sample(w - 1, y);
  }
  return { r: r / n, g: g / n, b: b / n };
}

function buildForegroundMask(canvas, sensitivity = 1.0) {
  // Lower threshold → higher Recall (small pills survive); Classification filters later.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const bg = estimateBg(data, w, h);
  const mask = new Uint8Array(w * h);
  const colorDistThresh = 48 / sensitivity;
  const edgeBoost = 18;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dist = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      const sat = maxc === 0 ? 0 : (maxc - minc) / maxc;
      const yL = 0.299 * r + 0.587 * g + 0.114 * b;

      // Local gradient as edge cue (pill boundary)
      const i2 = ((y + 1) * w + x) * 4;
      const i3 = (y * w + (x + 1)) * 4;
      const gy =
        Math.abs(yL - (0.299 * data[i2] + 0.587 * data[i2 + 1] + 0.114 * data[i2 + 2]));
      const gx =
        Math.abs(yL - (0.299 * data[i3] + 0.587 * data[i3 + 1] + 0.114 * data[i3 + 2]));
      const edge = gx + gy;

      // White pills on white desk: rely more on edges + slight luminance dips
      const whiteOnWhite = dist < 35 && edge > edgeBoost;
      const colorful = sat > 0.12 && dist > colorDistThresh * 0.7;
      const silhouette = dist > colorDistThresh;

      if (silhouette || colorful || whiteOnWhite) mask[y * w + x] = 1;
    }
  }

  // Morphology: close gaps then open speckles — helps touching pills separate less noisily
  return morphCloseOpen(mask, w, h);
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
  // close then open
  return erode(dilate(dilate(erode(mask))));
}

function connectedComponents(mask, w, h) {
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
      const idx = y * w + x;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
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
    return { minX, maxX, minY, maxY, area, cx: sumX / area, cy: sumY / area, pixels };
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

function classifyShape(comp) {
  const bw = comp.maxX - comp.minX + 1;
  const bh = comp.maxY - comp.minY + 1;
  const ratio = bw / Math.max(bh, 1);
  const boxArea = bw * bh;
  const fill = comp.area / Math.max(boxArea, 1);
  const circ = (4 * Math.PI * comp.area) / Math.max(1, (2 * (bw + bh)) ** 2 / 4);

  // Prefer ellipse / circle / capsule / rectangle priors
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

function cropWithMargin(source, box, marginRatio = 0.15) {
  // Why margin: tight boxes clip imprint text / edges → OCR & color fail
  const mx = box.w * marginRatio;
  const my = box.h * marginRatio;
  const x = Math.max(0, Math.floor(box.x - mx));
  const y = Math.max(0, Math.floor(box.y - my));
  const w = Math.min(source.width - x, Math.ceil(box.w + mx * 2));
  const h = Math.min(source.height - y, Math.ceil(box.h + my * 2));
  const side = Math.max(w, h, 96);
  const crop = document.createElement("canvas");
  crop.width = side;
  crop.height = side;
  const ctx = crop.getContext("2d");
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(0, 0, side, side);
  const ox = Math.floor((side - w) / 2);
  const oy = Math.floor((side - h) / 2);
  ctx.drawImage(source, x, y, w, h, ox, oy, w, h);
  return { canvas: crop, cropBox: { x, y, w, h } };
}

function detectAtScale(preprocessed, scaleSide, sensitivity, originW, originH) {
  const scaled = resizeCanvas(preprocessed, scaleSide);
  const sw = scaled.width;
  const sh = scaled.height;
  const mask = buildForegroundMask(scaled, sensitivity);
  const { comps, labels } = connectedComponents(mask, sw, sh);
  const frameArea = sw * sh;
  // Low min area → keep small pills (Recall-first)
  const minArea = frameArea * 0.0018;
  const maxArea = frameArea * 0.42;

  const sx = originW / sw;
  const sy = originH / sh;
  const out = [];

  comps.forEach((comp, idx) => {
    if (comp.area < minArea || comp.area > maxArea) return;
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    const ratio = bw / Math.max(bh, 1);
    if (ratio > 4 || ratio < 0.25) return;
    if (bw < 8 || bh < 8) return;

    const { shape, shapeScore } = classifyShape(comp);
    if (!SHAPE_LABELS.includes(shape)) return;

    // Confidence from fill + shape prior + relative size stability
    const fill = comp.area / Math.max(bw * bh, 1);
    const sizeScore = Math.min(1, comp.area / (frameArea * 0.04));
    const confidence = Math.max(0.15, Math.min(0.98, 0.35 * fill + 0.4 * shapeScore + 0.25 * sizeScore));

    const box = {
      x: comp.minX * sx,
      y: comp.minY * sy,
      w: bw * sx,
      h: bh * sy,
      confidence,
      shape,
      scale: scaleSide,
      maskLabel: idx + 1,
      maskCanvas: maskToOverlay(labels, labels[comp.pixels[0]], sw, sh),
      area: comp.area * sx * sy,
    };
    out.push(box);
  });

  return out;
}

/**
 * Multi-scale detection + NMS + optional two-pass enlarge for low-confidence hits.
 */
export async function detectPills(source, options = {}) {
  const {
    scales = [640, 960, 1280],
    sensitivity = 1.15, // >1 lowers threshold → higher recall
    marginRatio = 0.15,
    twoPass = true,
    minConfidenceKeep = 0.18, // keep weak detections for classification filter
  } = options;

  const pre = preprocessForDetection(source, Math.max(...scales));
  if (!pre) return { detections: [], debug: { preprocessed: null } };

  let candidates = [];
  for (const side of scales) {
    candidates = candidates.concat(
      detectAtScale(pre, side, sensitivity, pre.width, pre.height)
    );
  }

  let merged = nms(candidates, 0.4).filter((d) => d.confidence >= minConfidenceKeep);

  // Two-pass: enlarge low-confidence crops and re-detect locally
  if (twoPass) {
    const weak = merged.filter((d) => d.confidence < 0.45);
    const strong = merged.filter((d) => d.confidence >= 0.45);
    const refined = [...strong];

    for (const wbox of weak) {
      const expand = 0.35;
      const x = Math.max(0, wbox.x - wbox.w * expand);
      const y = Math.max(0, wbox.y - wbox.h * expand);
      const w = Math.min(pre.width - x, wbox.w * (1 + expand * 2));
      const h = Math.min(pre.height - y, wbox.h * (1 + expand * 2));
      const roi = document.createElement("canvas");
      roi.width = Math.max(64, Math.round(w));
      roi.height = Math.max(64, Math.round(h));
      roi.getContext("2d").drawImage(pre, x, y, w, h, 0, 0, roi.width, roi.height);

      const local = detectAtScale(roi, 640, sensitivity * 1.1, roi.width, roi.height).map((d) => ({
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

  // Build crops with margin
  const detections = merged.map((d, i) => {
    const { canvas, cropBox } = cropWithMargin(pre, d, marginRatio);
    return {
      id: `det_${i}`,
      box: { x: d.x, y: d.y, w: d.w, h: d.h },
      cropBox,
      confidence: d.confidence,
      shape: d.shape,
      maskCanvas: d.maskCanvas,
      cropCanvas: canvas,
      scale: d.scale,
      refined: !!d.refined,
      area: d.area,
    };
  });

  return {
    detections,
    debug: {
      preprocessed: pre,
      rawCount: candidates.length,
      afterNms: merged.length,
      scales,
    },
  };
}

export function rotateCanvas(canvas, deg) {
  const rad = (deg * Math.PI) / 180;
  const c = document.createElement("canvas");
  if (deg % 180 === 0) {
    c.width = canvas.width;
    c.height = canvas.height;
  } else {
    c.width = canvas.height;
    c.height = canvas.width;
  }
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}
