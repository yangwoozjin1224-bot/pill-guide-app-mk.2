/**
 * Pill Detector interface (swap OpenCV classical ↔ YOLO-seg).
 *
 * Implementations must return:
 * {
 *   detections: Array<{
 *     id: string,
 *     box: { x, y, w, h },      // in source/preprocessed coords
 *     cropBox?: { x, y, w, h },
 *     confidence: number,       // 0..1
 *     shape?: string,           // 원형|타원형|장방형|캡슐형|기타
 *     cropCanvas: HTMLCanvasElement,
 *     maskCanvas?: HTMLCanvasElement,
 *     area?: number,
 *     refined?: boolean,
 *   }>,
 *   debug?: object,
 *   source?: string,            // "opencv-classical" | "yolo-seg" | ...
 * }
 */

export const DETECTOR_IDS = {
  OPENCV: "opencv-classical",
  YOLO: "yolo-seg",
  LEGACY: "legacy-mask",
};

export function normalizeDetections(list = [], prefix = "det") {
  return list.map((d, i) => ({
    id: d.id || `${prefix}_${i}`,
    box: d.box || { x: 0, y: 0, w: 0, h: 0 },
    cropBox: d.cropBox || d.box,
    confidence: Number(d.confidence) || 0,
    shape: d.shape || "기타",
    cropCanvas: d.cropCanvas,
    maskCanvas: d.maskCanvas || null,
    area: d.area ?? (d.box ? d.box.w * d.box.h : 0),
    refined: !!d.refined,
  }));
}
