/**
 * Pill Vision Search public API
 */
export {
  runVisionSearch,
  getVisionSearchConfig,
  setExternalDetector,
  setEmbeddingProvider,
  globalPillIndex,
  VectorIndex,
  embed,
} from "./engine.js";

export { embedCropCanvas, embedCatalogItem, cosineSimilarity, EMBEDDING_DIM } from "./embed.js";
export { rerankVisionCandidates, pickFinalPrediction, RERANK_WEIGHTS } from "./fusion.js";
export {
  recognizeMedicineBag,
  structureBagText,
  crossCheckWithBag,
  setSessionBagContext,
  getSessionBagHints,
  getSessionBagStructured,
} from "./bag.js";
export { fuseFrontBack } from "./dual.js";
export {
  logEvalSample,
  getEvalMetrics,
  formatEvalSummary,
  resetEval,
} from "./evaluate.js";
