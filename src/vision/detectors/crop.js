/** Shared crop helper — pad so imprint text is not clipped. */

export function cropWithMargin(source, box, marginRatio = 0.15) {
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

export function nms(boxes, iouThresh = 0.45) {
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

export function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
