/**
 * YOLO-seg detector stub.
 * Drop `pill_yolo_seg.onnx` (or wire TF.js/ONNX Runtime Web) and implement `inferYoloSeg`.
 *
 * Interface matches Detector: detect(source, options) → { detections, debug, source }
 */

import { DETECTOR_IDS, normalizeDetections } from "./types.js";
import { cropWithMargin } from "./crop.js";

let yoloInferFn = null;

/** Plug a real YOLO-seg inferencer: async (canvas, options) => Array<{x,y,w,h,confidence,mask?}> */
export function setYoloInferencer(fn) {
  yoloInferFn = typeof fn === "function" ? fn : null;
}

export function isYoloReady() {
  return typeof yoloInferFn === "function";
}

export async function detectYoloSeg(source, options = {}) {
  const marginRatio = options.marginRatio ?? 0.18;

  if (!yoloInferFn) {
    return {
      detections: [],
      debug: {
        note: "YOLO-seg not wired. Call setYoloInferencer(fn) or place model + ONNX Runtime.",
      },
      source: DETECTOR_IDS.YOLO,
    };
  }

  const raw = (await yoloInferFn(source, options)) || [];
  const canvas =
    typeof source?.getContext === "function"
      ? source
      : (() => {
          const c = document.createElement("canvas");
          // caller should pass canvas; if image-like, skip
          return source;
        })();

  const detections = normalizeDetections(
    raw.map((d, i) => {
      const box = { x: d.x, y: d.y, w: d.w, h: d.h };
      const { canvas: crop, cropBox } = cropWithMargin(canvas, box, marginRatio);
      return {
        id: `yolo_${i}`,
        box,
        cropBox,
        confidence: d.confidence ?? 0.5,
        shape: d.shape || "기타",
        cropCanvas: crop,
        maskCanvas: d.maskCanvas || null,
        area: box.w * box.h,
      };
    })
  );

  return {
    detections,
    debug: { rawCount: raw.length },
    source: DETECTOR_IDS.YOLO,
  };
}
