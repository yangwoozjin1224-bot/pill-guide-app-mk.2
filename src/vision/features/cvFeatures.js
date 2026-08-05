/**
 * Classical CV feature extraction from a single pill crop.
 * Observation only — no drug name guessing.
 */

const MFDS_COLORS = [
  "하양",
  "노랑",
  "주황",
  "분홍",
  "빨강",
  "갈색",
  "연두",
  "초록",
  "청록",
  "파랑",
  "남색",
  "보라",
  "회색",
  "검정",
  "투명",
];

const MFDS_SHAPES = ["원형", "타원형", "장방형", "삼각형", "사각형", "마름모", "오각형", "육각형", "팔각형", "기타"];

export function estimateColorMfds(canvas) {
  if (!canvas?.getContext) return { label: "", rgb: [0, 0, 0], confidence: 0 };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(Math.floor(w * 0.2), Math.floor(h * 0.2), Math.floor(w * 0.6), Math.floor(h * 0.6));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < img.data.length; i += 16) {
    const rr = img.data[i];
    const gg = img.data[i + 1];
    const bb = img.data[i + 2];
    if (rr + gg + bb < 60) continue;
    r += rr;
    g += gg;
    b += bb;
    n += 1;
  }
  if (!n) return { label: "", rgb: [0, 0, 0], confidence: 0 };
  r /= n;
  g /= n;
  b /= n;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  let label = "";
  if (sat < 0.14) label = max > 205 ? "하양" : max < 85 ? "검정" : "회색";
  else if (r > 175 && g < 115 && b < 115) label = "빨강";
  else if (r > 175 && g > 95 && b < 95) label = "주황";
  else if (r > 175 && g > 145 && b < 115) label = "노랑";
  else if (r > 160 && g > 95 && b > 120) label = "분홍";
  else if (g > r && g > b) label = g > 145 ? "연두" : "초록";
  else if (b > r && b > g && g > r * 0.7) label = "청록";
  else if (b > r && b > g) label = b > 140 ? "파랑" : "남색";
  else if (r > 115 && b > 115 && g < 115) label = "보라";
  else if (r > 110 && g > 70 && b < 75) label = "갈색";
  const known = MFDS_COLORS.includes(label);
  return {
    label: known ? label : label,
    rgb: [r, g, b],
    confidence: known ? 0.75 : label ? 0.45 : 0,
  };
}

/** Score-line / break-line heuristic along major axis. */
export function detectScoreLine(canvas) {
  if (!canvas?.getContext) return { present: false, confidence: 0, orientation: null };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const grayAt = (x, y) => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  const scanAxis = (horizontal) => {
    const len = horizontal ? w : h;
    const cross = horizontal ? h : w;
    const mid0 = Math.floor(cross * 0.35);
    const mid1 = Math.floor(cross * 0.65);
    let bestDip = 0;
    let bestPos = -1;
    for (let t = Math.floor(len * 0.25); t < Math.floor(len * 0.75); t++) {
      let sum = 0;
      let n = 0;
      for (let c = mid0; c < mid1; c += 2) {
        sum += horizontal ? grayAt(t, c) : grayAt(c, t);
        n += 1;
      }
      const avg = sum / Math.max(1, n);
      // Compare to neighbors
      let neigh = 0;
      let nn = 0;
      for (const dt of [-8, -4, 4, 8]) {
        const tt = t + dt;
        if (tt < 0 || tt >= len) continue;
        let s2 = 0;
        let n2 = 0;
        for (let c = mid0; c < mid1; c += 2) {
          s2 += horizontal ? grayAt(tt, c) : grayAt(c, tt);
          n2 += 1;
        }
        neigh += s2 / Math.max(1, n2);
        nn += 1;
      }
      const neighAvg = neigh / Math.max(1, nn);
      const dip = neighAvg - avg;
      if (dip > bestDip) {
        bestDip = dip;
        bestPos = t;
      }
    }
    return { dip: bestDip, pos: bestPos };
  };

  const vert = scanAxis(true); // vertical line → scan x
  const horz = scanAxis(false);
  const useVert = vert.dip >= horz.dip;
  const best = useVert ? vert : horz;
  const present = best.dip > 18;
  return {
    present,
    confidence: present ? Math.min(0.95, best.dip / 40) : Math.min(0.4, best.dip / 30),
    orientation: present ? (useVert ? "vertical" : "horizontal") : null,
  };
}

export function estimateShapeFromBox(box, area) {
  if (!box) return { shape: "기타", confidence: 0 };
  const ratio = box.w / Math.max(box.h, 1);
  const boxArea = box.w * box.h;
  const fill = (area || boxArea) / Math.max(boxArea, 1);
  if (ratio > 1.75 || ratio < 0.57) {
    return { shape: fill > 0.55 ? "캡슐형" : "장방형", confidence: 0.7 };
  }
  if (fill > 0.62 && Math.abs(ratio - 1) < 0.2) return { shape: "원형", confidence: 0.85 };
  if (fill > 0.5) return { shape: "타원형", confidence: 0.75 };
  return { shape: "기타", confidence: 0.35 };
}

export function extractCvFeatures(cropCanvas, { box, area, shapeHint } = {}) {
  const color = estimateColorMfds(cropCanvas);
  const scoreLine = detectScoreLine(cropCanvas);
  const shape =
    shapeHint && MFDS_SHAPES.includes(shapeHint)
      ? { shape: shapeHint, confidence: 0.7 }
      : estimateShapeFromBox(box, area);
  return {
    color: color.label,
    colorRgb: color.rgb,
    colorConfidence: color.confidence,
    shape: shape.shape,
    shapeConfidence: shape.confidence,
    scoreLine: scoreLine.present,
    scoreLineConfidence: scoreLine.confidence,
    scoreLineOrientation: scoreLine.orientation,
    source: "cv",
  };
}

export { MFDS_COLORS, MFDS_SHAPES };
