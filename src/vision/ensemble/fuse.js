/**
 * Fuse multi-frame votes: majority → max confidence.
 */

/**
 * @param {Array<Array<object>>} frames - list of vote arrays per frame
 * @returns {{
 *   picks: Array<object>,  // fused detections (one per “slot” by best global groups)
 *   method: 'majority'|'max_conf',
 *   frameCount: number,
 *   used: true
 * }}
 */
export function fuseEnsembleVotes(frames = []) {
  const flat = [];
  for (const frame of frames) {
    for (const v of frame || []) {
      if (v?.name || v?.itemSeq) flat.push(v);
    }
  }

  if (!flat.length) {
    return { picks: [], method: "max_conf", frameCount: frames.length, used: true };
  }

  // Group by itemSeq if present else normalized name
  const groups = new Map();
  for (const v of flat) {
    const key = v.itemSeq || String(v.name || "").trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }

  const ranked = Array.from(groups.entries()).map(([key, votes]) => {
    const count = votes.length;
    const avgConf = votes.reduce((s, x) => s + (x.confidence || 0), 0) / count;
    const best = votes.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    return { key, count, avgConf, best, votes };
  });

  // Majority: highest count, tie-break by avgConf then best.confidence
  ranked.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.avgConf !== a.avgConf) return b.avgConf - a.avgConf;
    return (b.best.confidence || 0) - (a.best.confidence || 0);
  });

  const topCount = ranked[0].count;
  const majorityCandidates = ranked.filter((r) => r.count === topCount);
  const useMajority = topCount >= 2 || frames.length === 1;

  let method = "majority";
  let chosenList;

  if (useMajority && majorityCandidates.length === 1) {
    chosenList = [majorityCandidates[0]];
    method = "majority";
  } else if (useMajority && majorityCandidates.length > 1) {
    // Tied majority → max conf among ties
    majorityCandidates.sort((a, b) => (b.best.confidence || 0) - (a.best.confidence || 0));
    chosenList = [majorityCandidates[0]];
    method = "max_conf";
  } else {
    // No repeated identity — take global max confidence
    const byConf = ranked.slice().sort((a, b) => (b.best.confidence || 0) - (a.best.confidence || 0));
    chosenList = [byConf[0]];
    method = "max_conf";
  }

  // Also keep secondary distinct pills if they appeared in ≥2 frames (multi-pill)
  const extras = ranked
    .filter((r) => r.key !== chosenList[0].key && r.count >= 2)
    .slice(0, 5);
  const allChosen = [...chosenList, ...extras];

  const picks = allChosen.map((g) => {
    const b = g.best;
    const fusedConf = Math.min(
      0.98,
      Math.max(b.confidence || 0, g.avgConf) + (g.count >= 2 ? 0.04 : 0)
    );
    return {
      name: b.name,
      itemSeq: b.itemSeq,
      confidence: fusedConf,
      mark: b.mark,
      tier: b.tier,
      matchSource: b.matchSource,
      color: b.color,
      shape: b.shape,
      voteCount: g.count,
      ensembleMethod: method,
    };
  });

  return {
    picks,
    method,
    frameCount: frames.length,
    used: true,
  };
}

/**
 * Build a pipeline-like result object from fused picks + last raw result (for crop/boxes).
 */
export function buildEnsemblePipelineResult(lastPipelineResult, fused) {
  const lastDets = lastPipelineResult?.results || [];
  const results = (fused.picks || []).map((pick, i) => {
    const base =
      lastDets.find(
        (d) =>
          String(d.best?.itemSeq || d.best?.ITEM_SEQ || "") === pick.itemSeq ||
          (d.best?.name || d.best?.itemName) === pick.name
      ) || lastDets[i] || lastDets[0] || {};

    const best = {
      ...(base.best || {}),
      name: pick.name,
      itemName: pick.name,
      itemSeq: pick.itemSeq,
      fusedScore: pick.confidence,
      matchTier: pick.tier,
      matchSource: pick.matchSource,
    };

    return {
      ...base,
      mark: pick.mark || base.mark,
      color: pick.color || base.color,
      shape: pick.shape || base.shape,
      best,
      fusedConfidence: pick.confidence,
      matchTier: pick.tier,
      matchSource: pick.matchSource,
      lowAccuracy: pick.confidence < 0.45,
      ensemble: {
        used: true,
        frameCount: fused.frameCount,
        method: fused.method,
        voteCount: pick.voteCount,
      },
    };
  });

  return {
    ...(lastPipelineResult || {}),
    results,
    ensemble: {
      used: true,
      frameCount: fused.frameCount,
      method: fused.method,
    },
  };
}
