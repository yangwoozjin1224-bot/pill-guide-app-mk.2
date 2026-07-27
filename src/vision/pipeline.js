/**
 * Legacy pipeline façade → Vision Search Engine.
 */
export {
  runVisionSearch,
  runVisionSearch as recognizePillsPipeline,
  getVisionSearchConfig,
  getVisionSearchConfig as getPipelineConfig,
  setExternalDetector,
  setEmbeddingProvider,
} from "./search/engine.js";

export { recognizeMedicineBag as recognizeDocumentPipeline, setSessionBagContext, getSessionBagHints } from "./search/bag.js";
export { terminateOcrWorker, getOcrWorker } from "./ocr.js";
export { preprocessForDetection } from "./preprocess.js";
