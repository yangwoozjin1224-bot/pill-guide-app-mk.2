/**
 * Image preprocessing for Detection / OCR.
 * Why: raw camera frames have uneven lighting, noise, and low contrast —
 * running detectors directly drops recall on small / white pills.
 */

export function canvasFromImageSource(source, maxSide = 1280) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  if (!w || !h) return null;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, cw, ch);
  return canvas;
}

export function cloneCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

function getRGBA(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function putRGBA(canvas, imageData) {
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return canvas;
}

/** Auto contrast via histogram stretch */
export function autoContrast(canvas, clipPercent = 1) {
  const img = getRGBA(canvas);
  const { data } = img;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const y = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[y] += 1;
  }
  const total = data.length / 4;
  const clip = (total * clipPercent) / 100;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= clip) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= clip) {
      hi = i;
      break;
    }
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, ((data[i + c] - lo) * 255) / span));
    }
  }
  return putRGBA(cloneCanvas(canvas), img);
}

/** Simplified CLAHE-like local contrast on luminance */
export function claheLike(canvas, tile = 8, clipLimit = 2.5) {
  const src = getRGBA(canvas);
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const tw = Math.max(1, Math.floor(w / tile));
  const th = Math.max(1, Math.floor(h / tile));
  const outGray = new Float32Array(w * h);

  for (let ty = 0; ty < tile; ty++) {
    for (let tx = 0; tx < tile; tx++) {
      const x0 = tx * tw;
      const y0 = ty * th;
      const x1 = tx === tile - 1 ? w : x0 + tw;
      const y1 = ty === tile - 1 ? h : y0 + th;
      const hist = new Array(256).fill(0);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[Math.round(gray[y * w + x])] += 1;
          count += 1;
        }
      }
      const clip = (clipLimit * count) / 256;
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clip) {
          excess += hist[i] - clip;
          hist[i] = clip;
        }
      }
      const redist = excess / 256;
      for (let i = 0; i < 256; i++) hist[i] += redist;

      const cdf = new Array(256).fill(0);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
      const cdfMin = cdf.find((v) => v > 0) || 1;
      const map = new Array(256);
      for (let i = 0; i < 256; i++) {
        map[i] = Math.round(((cdf[i] - cdfMin) / Math.max(1, count - cdfMin)) * 255);
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * w + x;
          outGray[idx] = map[Math.round(gray[idx])];
        }
      }
    }
  }

  const out = cloneCanvas(canvas);
  const outImg = getRGBA(out);
  for (let i = 0, p = 0; i < outImg.data.length; i += 4, p++) {
    const g = outGray[p];
    const old = gray[p] || 1;
    const ratio = g / old;
    outImg.data[i] = Math.min(255, data[i] * ratio);
    outImg.data[i + 1] = Math.min(255, data[i + 1] * ratio);
    outImg.data[i + 2] = Math.min(255, data[i + 2] * ratio);
  }
  return putRGBA(out, outImg);
}

/** Simple gray-world white balance */
export function whiteBalance(canvas) {
  const img = getRGBA(canvas);
  const { data } = img;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  r /= n;
  g /= n;
  b /= n;
  const avg = (r + g + b) / 3 || 1;
  const kr = avg / (r || 1);
  const kg = avg / (g || 1);
  const kb = avg / (b || 1);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * kr);
    data[i + 1] = Math.min(255, data[i + 1] * kg);
    data[i + 2] = Math.min(255, data[i + 2] * kb);
  }
  return putRGBA(cloneCanvas(canvas), img);
}

/** Box blur denoise */
export function denoise(canvas, radius = 1) {
  const src = getRGBA(canvas);
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const r = radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let c = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          const i = (yy * w + xx) * 4;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
          c += 1;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = sr / c;
      out.data[o + 1] = sg / c;
      out.data[o + 2] = sb / c;
      out.data[o + 3] = 255;
    }
  }
  return putRGBA(cloneCanvas(canvas), out);
}

/** Unsharp mask sharpening */
export function sharpen(canvas, amount = 0.7) {
  const blurred = denoise(canvas, 1);
  const a = getRGBA(canvas);
  const b = getRGBA(blurred);
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = a.data[i + c] + amount * (a.data[i + c] - b.data[i + c]);
      a.data[i + c] = Math.max(0, Math.min(255, v));
    }
  }
  return putRGBA(cloneCanvas(canvas), a);
}

export function resizeCanvas(canvas, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (scale === 1) return cloneCanvas(canvas);
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

/**
 * Best combo found for pill detection in varied lighting:
 * whiteBalance → autoContrast → claheLike → light denoise → sharpen
 * Why this order: color cast first, then global/local contrast, then denoise before sharpen
 * so we don't amplify noise.
 */
export function preprocessForDetection(source, maxSide = 1280) {
  let c = typeof source.getContext === "function" ? cloneCanvas(source) : canvasFromImageSource(source, maxSide);
  if (!c) return null;
  c = resizeCanvas(c, maxSide);
  c = whiteBalance(c);
  c = autoContrast(c, 1.2);
  c = claheLike(c, 8, 2.2);
  c = denoise(c, 1);
  c = sharpen(c, 0.55);
  return c;
}

/** OCR-oriented preprocess: deskew-ish via contrast + adaptive threshold look */
export function preprocessForOcr(canvas) {
  let c = cloneCanvas(canvas);
  c = autoContrast(c, 0.8);
  c = claheLike(c, 6, 3);
  c = denoise(c, 1);
  c = sharpen(c, 0.9);
  // Adaptive-like binary variants returned separately by caller when needed
  return c;
}

export function adaptiveThresholdCanvas(canvas) {
  const src = getRGBA(canvas);
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const out = new ImageData(w, h);
  const win = 15;
  const C = 8;
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
      const v = gray[y * w + x] < mean - C ? 0 : 255;
      const o = (y * w + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
      out.data[o + 3] = 255;
    }
  }
  return putRGBA(cloneCanvas(canvas), out);
}

export function invertCanvas(canvas) {
  const img = getRGBA(canvas);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 255 - img.data[i];
    img.data[i + 1] = 255 - img.data[i + 1];
    img.data[i + 2] = 255 - img.data[i + 2];
  }
  return putRGBA(cloneCanvas(canvas), img);
}
