/**
 * Detector registry — swap OpenCV classical ↔ YOLO-seg behind one API.
 */

import { DETECTOR_IDS } from "./types.js";
import { detectOpenCvClassical } from "./classicalOpenCv.js";
import { detectYoloSeg, isYoloReady, setYoloInferencer } from "./yoloStub.js";

let activeId = DETECTOR_IDS.OPENCV;
let customDetector = null;

export function setActiveDetector(id) {
  if (id === DETECTOR_IDS.YOLO || id === "yolo") activeId = DETECTOR_IDS.YOLO;
  else if (id === DETECTOR_IDS.OPENCV || id === "opencv") activeId = DETECTOR_IDS.OPENCV;
  else activeId = id;
}

export function getActiveDetectorId() {
  return customDetector ? "custom" : activeId;
}

/** Override with any async (source, options) => DetectionResult */
export function setCustomDetector(fn) {
  customDetector = typeof fn === "function" ? fn : null;
}

/**
 * Unified entry used by the imprint pipeline.
 * Prefer YOLO when ready + selected; else OpenCV classical.
 */
export async function detectInstances(source, options = {}) {
  if (customDetector) {
    try {
      const ext = await customDetector(source, options);
      if (ext?.detections?.length) return { ...ext, source: ext.source || "custom" };
    } catch (e) {
      console.warn("[detectors] custom detector failed, falling back", e);
    }
  }

  const preferYolo = options.preferYolo || activeId === DETECTOR_IDS.YOLO;
  if (preferYolo && isYoloReady()) {
    const yolo = await detectYoloSeg(source, options);
    if (yolo.detections?.length) return yolo;
  }

  return detectOpenCvClassical(source, options);
}

export {
  DETECTOR_IDS,
  detectOpenCvClassical,
  detectYoloSeg,
  setYoloInferencer,
  isYoloReady,
};
export { adaptiveThresholdMask, findContours, distanceTransform, watershedSplit } from "./classicalOpenCv.js";
export { cropWithMargin, nms, iou } from "./crop.js";
