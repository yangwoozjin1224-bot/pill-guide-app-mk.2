/**
 * In-memory + localStorage cache for 낱알식별 API responses.
 */

const MEMORY = new Map();
const PREFIX = "pillguide:id:";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24; // 24h

function storageAvailable() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function cacheKey(parts = {}) {
  const mark = String(parts.mark || parts.print_front || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const color = String(parts.color || parts.color_class1 || "").trim();
  const shape = String(parts.shape || parts.drug_shape || "").trim();
  const name = String(parts.itemName || parts.item_name || "").trim();
  return [mark, color, shape, name].join("|");
}

export function getCached(key, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const mem = MEMORY.get(key);
  if (mem && Date.now() - mem.ts < ttlMs) return mem.value;

  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.ts >= ttlMs) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    MEMORY.set(key, parsed);
    return parsed.value;
  } catch {
    return null;
  }
}

export function setCached(key, value) {
  const entry = { ts: Date.now(), value };
  MEMORY.set(key, entry);
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota */
  }
}

export function clearMatchCache() {
  MEMORY.clear();
  if (!storageAvailable()) return;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export { DEFAULT_TTL_MS, MEMORY as _memoryForTests };
