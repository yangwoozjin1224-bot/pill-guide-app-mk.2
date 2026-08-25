/**
 * PrescriptionContext — session + localStorage store for bag/prescription drug list.
 * Schema version: 1 (see migrations/001_prescription_context.md)
 */

const STORAGE_KEY = "pillguide:prescription";
const SCHEMA_VERSION = 1;

function envMinConf() {
  try {
    const v =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_PRESCRIPTION_MATCH_MIN_CONF;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0.45;
  } catch {
    return 0.45;
  }
}

/** @type {{ id: string, updatedAt: number, schemaVersion: number, drugs: Array, rawStructured?: object } | null} */
let memoryContext = null;

function storageAvailable() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function normalizeDrug(d) {
  if (!d) return null;
  const name = String(d.name || d.itemName || d.ITEM_NAME || "").trim();
  if (!name) return null;
  return {
    name,
    itemSeq: String(d.itemSeq || d.ITEM_SEQ || d.id || "").trim() || undefined,
    entpName: String(d.entpName || d.ENTP_NAME || "").trim() || undefined,
    imageUrl: d.imageUrl || d.ITEM_IMAGE || undefined,
    mark: d.mark || d.PRINT_FRONT || undefined,
    PRINT_FRONT: d.PRINT_FRONT || d.mark || undefined,
    PRINT_BACK: d.PRINT_BACK || undefined,
    color: d.color || d.COLOR_CLASS1 || undefined,
    COLOR_CLASS1: d.COLOR_CLASS1 || d.color || undefined,
    shape: d.shape || d.DRUG_SHAPE || undefined,
    DRUG_SHAPE: d.DRUG_SHAPE || d.shape || undefined,
    source: d.source || "bag_ocr",
  };
}

function persist(ctx) {
  memoryContext = ctx;
  if (!storageAvailable() || !ctx) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    /* quota */
  }
}

function loadFromStorage() {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.drugs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getPrescriptionMatchMinConf() {
  return envMinConf();
}

/**
 * Replace prescription context from bag OCR / manual list.
 */
export function setPrescriptionContext({ drugs = [], rawStructured = null, id } = {}) {
  const normalized = (drugs || []).map(normalizeDrug).filter(Boolean);
  // dedupe by itemSeq or name
  const map = new Map();
  for (const d of normalized) {
    const key = d.itemSeq || d.name;
    if (!map.has(key)) map.set(key, d);
  }
  const ctx = {
    id: id || `rx_${Date.now()}`,
    updatedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
    drugs: Array.from(map.values()),
    rawStructured: rawStructured || null,
  };
  persist(ctx);
  return ctx;
}

/**
 * Build context from recognizeMedicineBag result.
 */
export function setPrescriptionFromBagResult(docResult) {
  const items = docResult?.items || [];
  const names = docResult?.drugNames || [];
  const drugs = [];

  for (const it of items) {
    const d = normalizeDrug({ ...it, source: "bag_ocr" });
    if (d) drugs.push(d);
  }
  for (const name of names) {
    if (!drugs.some((d) => d.name === name)) {
      const d = normalizeDrug({ name, source: "bag_ocr" });
      if (d) drugs.push(d);
    }
  }

  return setPrescriptionContext({
    drugs,
    rawStructured: docResult || null,
  });
}

export function getPrescriptionContext() {
  if (memoryContext) return memoryContext;
  memoryContext = loadFromStorage();
  return memoryContext;
}

export function getPrescriptionDrugs() {
  return [...(getPrescriptionContext()?.drugs || [])];
}

export function getPrescriptionDrugNames() {
  return getPrescriptionDrugs()
    .map((d) => d.name)
    .filter(Boolean);
}

export function clearPrescriptionContext() {
  memoryContext = null;
  if (storageAvailable()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function hasPrescriptionContext() {
  return getPrescriptionDrugs().length > 0;
}

export { STORAGE_KEY, SCHEMA_VERSION, normalizeDrug };
