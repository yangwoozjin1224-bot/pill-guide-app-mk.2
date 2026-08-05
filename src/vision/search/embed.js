/**
 * Pill-specialized Vision Embedding.
 *
 * Interface mirrors CLIP/ViT retrieval:
 *   embed(canvas) → L2-normalized Float32Array
 *
 * Default provider: dense handcrafted multi-cue vector (color hist, edges,
 * shape, OCR n-grams, size) — works offline in-browser without multi‑MB weights.
 *
 * Swap in CLIP/ViT later via setEmbeddingProvider(async (canvas) => Float32Array).
 */

import { estimateColorLabel } from "../classify.js";

const DIM = 128;
let customProvider = null;

export function getEmbeddingDim() {
  return DIM;
}

/** @param {(canvas: HTMLCanvasElement) => Promise<Float32Array>|Float32Array} fn */
export function setEmbeddingProvider(fn) {
  customProvider = typeof fn === "function" ? fn : null;
}

export function l2Normalize(vec) {
  const out = vec instanceof Float32Array ? vec : new Float32Array(vec);
  let s = 0;
  for (let i = 0; i < out.length; i++) s += out[i] * out[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both L2-normalized
}

function hashProj(str, dim, offset = 0) {
  const v = new Float32Array(dim);
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const i1 = (code * 17 + i * 31 + offset) % dim;
    const i2 = (code * 13 + i * 7 + offset * 3) % dim;
    v[i1] += 1;
    v[i2] -= 0.5;
  }
  return v;
}

/** Visual embedding from crop canvas (+ optional imprint text). */
export function embedCropCanvas(canvas, { imprint = "", shape = "", area = 0 } = {}) {
  const vec = new Float32Array(DIM);
  if (!canvas) return l2Normalize(vec);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // --- Color histogram (HSV-ish bins) → dims 0..47 ---
  const hist = new Float32Array(48);
  let edgeSum = 0;
  let edgeN = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 4;
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      let hue = 0;
      if (max !== min) {
        if (max === r) hue = ((g - b) / (max - min)) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        hue /= 6;
        if (hue < 0) hue += 1;
      }
      const hi = Math.min(11, Math.floor(hue * 12));
      const si = Math.min(1, Math.floor(sat * 2));
      const vi = Math.min(1, Math.floor(max * 2));
      hist[hi * 4 + si * 2 + vi] += 1;

      // simple gradient energy
      const i2 = ((y + 1) * w + x) * 4;
      const y0 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const y1 = 0.299 * d[i2] + 0.587 * d[i2 + 1] + 0.114 * d[i2 + 2];
      edgeSum += Math.abs(y0 - y1);
      edgeN += 1;
    }
  }
  let hsum = 0;
  for (let i = 0; i < 48; i++) hsum += hist[i];
  for (let i = 0; i < 48; i++) vec[i] = hsum ? hist[i] / hsum : 0;

  // --- Edge / texture stats → 48..63 ---
  vec[48] = edgeN ? Math.min(1, edgeSum / (edgeN * 40)) : 0;
  vec[49] = Math.min(1, w / 512);
  vec[50] = Math.min(1, h / 512);
  const ar = w / Math.max(h, 1);
  vec[51] = Math.min(1, ar / 3);
  vec[52] = Math.min(1, Math.max(0, 2 - ar) / 2);
  vec[53] = Math.min(1, Math.log10(1 + (area || w * h)) / 6);

  const color = estimateColorLabel(canvas);
  const colorMap = {
    하양: 0, 회색: 1, 검정: 2, 빨강: 3, 주황: 4, 노랑: 5,
    분홍: 6, 연두: 7, 초록: 8, 파랑: 9, 보라: 10, 갈색: 11,
  };
  if (color.label && colorMap[color.label] != null) vec[54 + (colorMap[color.label] % 10)] = 1;

  // --- Shape one-hot-ish → 64..71 ---
  const shapeMap = { 원형: 0, 타원형: 1, 장방형: 2, 캡슐형: 3, 기타: 4 };
  const si = shapeMap[shape] ?? 4;
  vec[64 + si] = 1;

  // --- OCR / imprint projected bags → 72..127 ---
  const imprintNorm = String(imprint || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (imprintNorm) {
    const proj = hashProj(imprintNorm, 56, 3);
    for (let i = 0; i < 56; i++) vec[72 + i] = proj[i];
    // char bigrams
    for (let i = 0; i < imprintNorm.length - 1; i++) {
      const bg = imprintNorm.slice(i, i + 2);
      const idx = 72 + ((bg.charCodeAt(0) * 31 + bg.charCodeAt(1)) % 56);
      vec[idx] += 0.35;
    }
  }

  return l2Normalize(vec);
}

/**
 * Catalog-side embedding from structured pill metadata (+ optional image canvas).
 * Aligned to the same vector space as crop embeddings for cosine search.
 */
export function embedCatalogItem(item, imageCanvas = null) {
  if (imageCanvas) {
    return embedCropCanvas(imageCanvas, {
      imprint: item.PRINT_FRONT || item.mark || item.print || "",
      shape: item.DRUG_SHAPE || item.shape || "",
      area: 0,
    });
  }
  // Metadata-only proxy embedding (no image available / CORS)
  const fake = document.createElement("canvas");
  fake.width = 64;
  fake.height = 64;
  const ctx = fake.getContext("2d");
  const color = String(item.COLOR_CLASS1 || item.color || "");
  const fill =
    color.includes("하양") ? "#f2f2f2" :
    color.includes("빨강") ? "#e55" :
    color.includes("파랑") ? "#58f" :
    color.includes("노랑") ? "#ee5" :
    color.includes("초록") || color.includes("연두") ? "#5c5" :
    color.includes("분홍") ? "#f9a" :
    color.includes("주황") ? "#f80" :
    color.includes("보라") ? "#a5f" :
    color.includes("갈색") ? "#a75" :
    color.includes("검정") ? "#222" :
    "#ddd";
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 64, 64);
  const shape = item.DRUG_SHAPE || item.shape || "원형";
  ctx.fillStyle = "#888";
  if (shape.includes("캡슐") || shape.includes("장방")) {
    ctx.beginPath();
    ctx.ellipse(32, 32, 26, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  return embedCropCanvas(fake, {
    imprint: item.PRINT_FRONT || item.mark || "",
    shape: shape.includes("캡슐") ? "캡슐형" : shape.includes("장방") ? "장방형" : shape.includes("타원") ? "타원형" : "원형",
  });
}

export async function embed(canvas, meta = {}) {
  if (customProvider) {
    try {
      const v = await customProvider(canvas, meta);
      if (v && v.length) return l2Normalize(v instanceof Float32Array ? v : new Float32Array(v));
    } catch (e) {
      console.warn("[embed] custom provider failed, fallback handcrafted", e);
    }
  }
  return embedCropCanvas(canvas, meta);
}

export { DIM as EMBEDDING_DIM };
