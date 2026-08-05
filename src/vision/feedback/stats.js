/**
 * Feedback statistics for developer/admin stub dashboard.
 */

import { listFeedback } from "./store.js";

/**
 * @returns {{
 *   total: number,
 *   topWrongPredictions: Array<{ name: string, count: number }>,
 *   topCorrections: Array<{ name: string, count: number }>,
 *   recent: Array
 * }}
 */
export function getFeedbackStats({ topN = 10, recentN = 5 } = {}) {
  const all = listFeedback({ limit: 500 });
  const wrongMap = new Map();
  const correctMap = new Map();

  for (const e of all) {
    const wrong = e.predicted?.name || "(없음)";
    const right = e.correct?.name || "(없음)";
    wrongMap.set(wrong, (wrongMap.get(wrong) || 0) + 1);
    correctMap.set(right, (correctMap.get(right) || 0) + 1);
  }

  const toTop = (map) =>
    Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);

  return {
    total: all.length,
    topWrongPredictions: toTop(wrongMap),
    topCorrections: toTop(correctMap),
    recent: all.slice(0, recentN).map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      predicted: e.predicted?.name,
      correct: e.correct?.name,
      consentImageStore: e.consentImageStore,
    })),
  };
}
