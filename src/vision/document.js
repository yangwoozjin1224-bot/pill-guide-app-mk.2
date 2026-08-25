/**
 * Document pipeline for medicine bags / prescriptions.
 * Why not raw OCR on full frame:
 * - Perspective distortion and glare destroy Hangul OCR.
 * Flow: detect document quad → perspective warp → enhance → OCR preprocess.
 */

import {
  autoContrast,
  claheLike,
  denoise,
  sharpen,
  adaptiveThresholdCanvas,
  cloneCanvas,
} from "./preprocess.js";

function getImageData(canvas) {
  return canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

/** Rough document rectangle via bright large component / border contrast */
export function detectDocumentQuad(canvas) {
  const { width: w, height: h, data } = getImageData(canvas);
  // Score edges brightness; find largest bright-ish region bounding box as document approx
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = Math.floor(h * 0.05); y < h * 0.95; y += 2) {
    for (let x = Math.floor(w * 0.05); x < w * 0.95; x += 2) {
      const i = (y * w + x) * 4;
      const yL = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (yL > 140) {
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < (w * h) / 80) {
    // fallback full frame with small inset
    return {
      x: w * 0.05,
      y: h * 0.05,
      w: w * 0.9,
      h: h * 0.9,
    };
  }
  const pad = 8;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: Math.min(w - minX, maxX - minX + pad * 2),
    h: Math.min(h - minY, maxY - minY + pad * 2),
  };
}

/**
 * Perspective-ish correction via axis-aligned crop + resize to document aspect.
 * (Full homography needs 4 corners; this robustly handles most bag/prescription photos.)
 */
export function perspectiveCorrect(canvas, quad) {
  const outW = 1000;
  const outH = Math.round((quad.h / Math.max(quad.w, 1)) * outW);
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = Math.max(400, outH);
  out.getContext("2d").drawImage(canvas, quad.x, quad.y, quad.w, quad.h, 0, 0, out.width, out.height);
  return out;
}

export function enhanceDocument(canvas) {
  let c = cloneCanvas(canvas);
  c = autoContrast(c, 0.8);
  c = claheLike(c, 8, 3);
  c = denoise(c, 1);
  c = sharpen(c, 0.85);
  return c;
}

/** Deskew estimate using horizontal projection variance heuristic */
export function deskew(canvas) {
  // Try small angles and pick max row-variance (text lines align)
  const angles = [-4, -2, 0, 2, 4];
  let best = canvas;
  let bestScore = -1;
  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180;
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    const { data, width: w, height: h } = getImageData(c);
    const row = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = 0; x < w; x += 3) {
        const i = (y * w + x) * 4;
        s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      row[y] = s;
    }
    let mean = 0;
    for (let y = 0; y < h; y++) mean += row[y];
    mean /= h;
    let variable = 0;
    for (let y = 0; y < h; y++) variable += (row[y] - mean) ** 2;
    if (variable > bestScore) {
      bestScore = variable;
      best = c;
    }
  }
  return best;
}

export function prepareDocumentForOcr(sourceCanvas) {
  const quad = detectDocumentQuad(sourceCanvas);
  let doc = perspectiveCorrect(sourceCanvas, quad);
  doc = enhanceDocument(doc);
  doc = deskew(doc);
  // Why adaptive threshold after deskew: Hangul strokes need local contrast, not global binary
  const binary = adaptiveThresholdCanvas(doc);
  return {
    documentCanvas: doc,
    binaryCanvas: binary,
    ocrCanvas: binary,
    quad,
    debugStages: { quad, enhanced: doc, binary },
  };
}

/** Extract likely drug-name tokens from OCR text (forms, doses, Latin marks). */
export function extractDrugNameCandidates(ocrText) {
  const text = String(ocrText || "");
  const found = [];
  const seen = new Set();

  const push = (name) => {
    const n = String(name || "").replace(/\s+/g, "").trim();
    if (!n || n.length < 2 || n.length > 40) return;
    const key = n.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(n);
  };

  const formRe =
    /([가-힣A-Za-z][가-힣A-Za-z0-9]{0,24}(?:정|캡슐|연질캡슐|서방정|필름코팅정|시럽|산|액|주|겔|연고|크림|패치|좌제|환))/g;
  let m;
  while ((m = formRe.exec(text)) !== null) push(m[1]);

  const doseRe = /([가-힣A-Za-z][가-힣A-Za-z0-9]{1,20})\s*(\d+)\s*(mg|MG|밀리그람|밀리그램)/g;
  while ((m = doseRe.exec(text)) !== null) {
    push(m[1]);
    push(`${m[1]}${m[2]}mg`);
  }

  const engRe = /\b([A-Z][A-Z0-9-]{2,16})\b/g;
  const skip = new Set(["THE", "AND", "FOR", "TAB", "CAP", "MG", "ML", "DOS", "DAY", "TAKE", "WITH"]);
  while ((m = engRe.exec(text.toUpperCase())) !== null) {
    if (!skip.has(m[1])) push(m[1]);
  }

  return found.slice(0, 12);
}
