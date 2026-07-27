/**
 * In-memory vector index for pill Vision Search (cosine Top-K).
 * Entries: { id, embedding, item, meta }
 */

import { cosineSimilarity, l2Normalize } from "./embed.js";

export class VectorIndex {
  constructor() {
    this.entries = [];
  }

  clear() {
    this.entries = [];
  }

  size() {
    return this.entries.length;
  }

  upsert(entry) {
    if (!entry?.id || !entry?.embedding) return;
    const emb = l2Normalize(
      entry.embedding instanceof Float32Array
        ? entry.embedding
        : new Float32Array(entry.embedding)
    );
    const idx = this.entries.findIndex((e) => e.id === entry.id);
    const row = { ...entry, embedding: emb };
    if (idx >= 0) this.entries[idx] = row;
    else this.entries.push(row);
  }

  addMany(list) {
    for (const e of list) this.upsert(e);
  }

  /**
   * @returns {Array<{id, item, meta, score, embedding}>}
   */
  search(queryEmbedding, { topK = 10, excludeIds = [] } = {}) {
    if (!queryEmbedding?.length || !this.entries.length) return [];
    const ban = new Set(excludeIds);
    const scored = [];
    for (const e of this.entries) {
      if (ban.has(e.id)) continue;
      const score = cosineSimilarity(queryEmbedding, e.embedding);
      scored.push({
        id: e.id,
        item: e.item,
        meta: e.meta || {},
        embedding: e.embedding,
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

/** Shared session gallery (online index of seen pills + API candidates). */
export const globalPillIndex = new VectorIndex();
