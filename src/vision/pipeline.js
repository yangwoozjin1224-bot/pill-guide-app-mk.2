/**
 * Pipeline façade → imprint-first DB matching (+ legacy Vision Search).
 */
export {
  runVisionSearch,
  runVisionSearch as recognizePillsPipeline,
  getVisionSearchConfig,
  getVisionSearchConfig as getPipelineConfig,
  setExternalDetector,
  setEmbeddingProvider,
} from "./search/engine.js";

export {
  runImprintPipeline,
  stageSegment,
  stageExtract,
  stageMatch,
  stageFallback,
  getImprintPipelineConfig,
} from "./imprintPipeline.js";

export {
  detectInstances,
  setActiveDetector,
  setCustomDetector,
  setYoloInferencer,
  DETECTOR_IDS,
} from "./detectors/index.js";

export { extractPillFeatures, observePillFeatures, isVisionLlmConfigured } from "./features/index.js";
export { matchFeaturesToDb, scoreCandidateAgainstFeatures, clearMatchCache } from "./match/index.js";

export {
  setPrescriptionContext,
  setPrescriptionFromBagResult,
  getPrescriptionContext,
  getPrescriptionDrugs,
  getPrescriptionDrugNames,
  clearPrescriptionContext,
  hasPrescriptionContext,
  matchAgainstPrescriptionPool,
} from "./prescription/index.js";

export {
  recognizeMedicineBag as recognizeDocumentPipeline,
  setSessionBagContext,
  getSessionBagHints,
  attachPrescriptionBridge,
} from "./search/bag.js";
export { terminateOcrWorker, getOcrWorker } from "./ocr.js";
export { preprocessForDetection } from "./preprocess.js";

import { attachPrescriptionBridge } from "./search/bag.js";
import { setPrescriptionFromBagResult } from "./prescription/index.js";

// Phase 1: bag OCR session → durable PrescriptionContext
attachPrescriptionBridge(setPrescriptionFromBagResult);
