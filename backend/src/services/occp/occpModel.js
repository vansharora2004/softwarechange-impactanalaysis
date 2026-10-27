/**
 * occpModel.js
 * ------------
 * Implementation of Context-Free Path Baseline (Model A),
 * Operation-Conditioned Change Propagation (Model B / OCCP),
 * and Reciprocal Rank Fusion (RRF) baselines.
 *
 * Requirements & Constraints:
 *   1. Strictly leak-free: trained only on episodes strictly older than the target commit (j < c).
 *   2. Empirical rate without unvalidated smoothing or arbitrary constants:
 *        confidence(p) = positive(p) / total(p)
 *        confidence(o, p) = positive(o, p) / total(o, p)
 *   3. Deterministic candidate ranking:
 *        1) Highest eligible confidence
 *        2) Higher positive support, then higher total opportunities
 *        3) Shorter minimum hop distance
 *        4) Structural baseline rank (tie-breaker)
 *        5) Alphabetical ID
 *   4. Explicit backoff hierarchy for OCCP:
 *        Level 1: Operation-conditioned path (o, p)
 *        Level 2: Generic path (p)
 *        Level 3: Historical co-change count
 *        Level 4: Structural baseline rank
 *   5. Preserves identical candidate universe (0 candidates dropped).
 *   6. RRF fusion baseline uses fixed standard constant k = 60 (Cormack et al., 2009).
 */

'use strict';

export const RRF_K = 60;

/**
 * Mines historical path training opportunities from historical episodes.
 *
 * @param {Array<Object>} historicalEpisodes - Episodes strictly older than target commit
 * @returns {{
 *   genericPathStats: Map<string, { positive: number, total: number }>,
 *   conditionedPathStats: Map<string, { positive: number, total: number }>
 * }}
 */
export function trainPathModels(historicalEpisodes) {
  const genericPathStats = new Map();     // signature -> { positive, total }
  const conditionedPathStats = new Map(); // `${category}|${signature}` -> { positive, total }

  for (const ep of historicalEpisodes) {
    const { changedCompIds, componentEpisodes } = ep;

    for (const compEp of componentEpisodes) {
      const { opClass, candidatePathsMap } = compEp;
      // Get all detected categories for this source component
      const detectedCategories = (opClass.detectedCategories && opClass.detectedCategories.length > 0)
        ? opClass.detectedCategories
        : [opClass.primaryCategory || 'UNKNOWN_OR_MIXED'];

      for (const [candId, paths] of candidatePathsMap.entries()) {
        const isPositive = changedCompIds.has(candId);

        // Deduplicate path signatures for this (commit, source, candidate)
        const uniqueSignatures = new Set(paths.map(p => p.signature));

        for (const sig of uniqueSignatures) {
          // 1. Generic path stats
          if (!genericPathStats.has(sig)) {
            genericPathStats.set(sig, { positive: 0, total: 0 });
          }
          const gStat = genericPathStats.get(sig);
          gStat.total++;
          if (isPositive) gStat.positive++;

          // 2. Conditioned path stats for each detected category
          for (const cat of detectedCategories) {
            const condKey = `${cat}|${sig}`;
            if (!conditionedPathStats.has(condKey)) {
              conditionedPathStats.set(condKey, { positive: 0, total: 0 });
            }
            const cStat = conditionedPathStats.get(condKey);
            cStat.total++;
            if (isPositive) cStat.positive++;
          }
        }
      }
    }
  }

  return { genericPathStats, conditionedPathStats };
}

/**
 * Model A: Ranks structural candidates using context-independent typed-path confidence.
 *
 * @param {Array<Object>} structuralCandidates - Candidates from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Changed seed component ID
 * @param {Map<string, Array<Object>>} candidatePathsMap - candidateId -> Array<PathInfo>
 * @param {Map<string, Object>} genericPathStats - signature -> { positive, total }
 * @returns {Array<Object>} Ranked candidates
 */
export function rankModelA_ContextIndependent(
  structuralCandidates,
  sourceId,
  candidatePathsMap,
  genericPathStats
) {
  const ranked = structuralCandidates.map(c => {
    const paths = candidatePathsMap.get(c.id) || [];
    const uniqueSigs = [...new Set(paths.map(p => p.signature))];

    let bestConfidence = -1;
    let bestPositive = 0;
    let bestTotal = 0;
    let bestSignature = null;
    let hasSupport = false;

    for (const sig of uniqueSigs) {
      const stat = genericPathStats.get(sig);
      if (stat && stat.total > 0 && stat.positive > 0) {
        const conf = stat.positive / stat.total;
        if (
          conf > bestConfidence ||
          (conf === bestConfidence && stat.positive > bestPositive) ||
          (conf === bestConfidence && stat.positive === bestPositive && stat.total > bestTotal)
        ) {
          bestConfidence = conf;
          bestPositive = stat.positive;
          bestTotal = stat.total;
          bestSignature = sig;
          hasSupport = true;
        }
      }
    }

    return {
      ...c,
      modelA_confidence: hasSupport ? bestConfidence : 0,
      modelA_positiveSupport: bestPositive,
      modelA_totalSupport: bestTotal,
      modelA_bestSignature: bestSignature,
      modelA_hasSupport: hasSupport,
      modelA_evidenceType: hasSupport ? 'generic_path' : 'structural_fallback'
    };
  });

  // Sort candidates
  ranked.sort((a, b) => {
    // 1. Has positive support first
    if (a.modelA_hasSupport !== b.modelA_hasSupport) {
      return a.modelA_hasSupport ? -1 : 1;
    }
    // 2. Highest empirical confidence
    if (b.modelA_confidence !== a.modelA_confidence) {
      return b.modelA_confidence - a.modelA_confidence;
    }
    // 3. Higher positive support
    if (b.modelA_positiveSupport !== a.modelA_positiveSupport) {
      return b.modelA_positiveSupport - a.modelA_positiveSupport;
    }
    // 4. Higher total support
    if (b.modelA_totalSupport !== a.modelA_totalSupport) {
      return b.modelA_totalSupport - a.modelA_totalSupport;
    }
    // 5. Shorter hop distance
    if (a.minHop !== b.minHop) {
      return a.minHop - b.minHop;
    }
    // 6. Structural baseline rank
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    // 7. Alphabetical tie-break
    return a.id.localeCompare(b.id);
  });

  ranked.forEach((c, idx) => {
    c.modelA_rank = idx + 1;
  });

  return ranked;
}

/**
 * Model B: OCCP (Operation-Conditioned Change Propagation) Reranker.
 *
 * @param {Array<Object>} structuralCandidates - Candidates from generateStructuralCandidatesInMemory
 * @param {string} sourceId - Changed seed component ID
 * @param {Object} sourceOpClass - Output of classifyOperation on source component
 * @param {Map<string, Array<Object>>} candidatePathsMap - candidateId -> Array<PathInfo>
 * @param {Map<string, Object>} conditionedPathStats - `${cat}|${sig}` -> { positive, total }
 * @param {Map<string, Object>} genericPathStats - signature -> { positive, total }
 * @param {Map<string, number>} historyCounts - Co-change pair counts
 * @returns {Array<Object>} Ranked candidates with fallback levels
 */
export function rankModelB_OCCP(
  structuralCandidates,
  sourceId,
  sourceOpClass,
  candidatePathsMap,
  conditionedPathStats,
  genericPathStats,
  historyCounts = null
) {
  // Source detected operations
  const sourceCategories = (sourceOpClass.detectedCategories && sourceOpClass.detectedCategories.length > 0)
    ? sourceOpClass.detectedCategories
    : [sourceOpClass.primaryCategory || 'UNKNOWN_OR_MIXED'];

  const getCoChangeCount = (idA, idB) => {
    if (!historyCounts) return 0;
    const k = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
    return (historyCounts instanceof Map ? historyCounts.get(k) : historyCounts[k]) || 0;
  };

  const ranked = structuralCandidates.map(c => {
    const paths = candidatePathsMap.get(c.id) || [];
    const uniqueSigs = [...new Set(paths.map(p => p.signature))];

    // 1. Check Conditioned Evidence (o, p)
    let bestCondConf = -1;
    let bestCondPos = 0;
    let bestCondTot = 0;
    let bestCondSig = null;
    let bestCondCat = null;
    let hasConditionedSupport = false;

    for (const cat of sourceCategories) {
      for (const sig of uniqueSigs) {
        const condKey = `${cat}|${sig}`;
        const stat = conditionedPathStats.get(condKey);
        if (stat && stat.total > 0 && stat.positive > 0) {
          const conf = stat.positive / stat.total;
          if (
            conf > bestCondConf ||
            (conf === bestCondConf && stat.positive > bestCondPos) ||
            (conf === bestCondConf && stat.positive === bestCondPos && stat.total > bestCondTot)
          ) {
            bestCondConf = conf;
            bestCondPos = stat.positive;
            bestCondTot = stat.total;
            bestCondSig = sig;
            bestCondCat = cat;
            hasConditionedSupport = true;
          }
        }
      }
    }

    // 2. Check Generic Path Evidence (p)
    let bestGenConf = -1;
    let bestGenPos = 0;
    let bestGenTot = 0;
    let bestGenSig = null;
    let hasGenericSupport = false;

    for (const sig of uniqueSigs) {
      const stat = genericPathStats.get(sig);
      if (stat && stat.total > 0 && stat.positive > 0) {
        const conf = stat.positive / stat.total;
        if (
          conf > bestGenConf ||
          (conf === bestGenConf && stat.positive > bestGenPos) ||
          (conf === bestGenConf && stat.positive === bestGenPos && stat.total > bestGenTot)
        ) {
          bestGenConf = conf;
          bestGenPos = stat.positive;
          bestGenTot = stat.total;
          bestGenSig = sig;
          hasGenericSupport = true;
        }
      }
    }

    // 3. Check Co-change count
    const coChange = getCoChangeCount(sourceId, c.id);
    const hasCoChange = coChange > 0;

    // Determine fallback level
    let fallbackLevel = 'structural_baseline';
    let rankTier = 4; // 1: Conditioned, 2: Generic, 3: Co-Change, 4: Structural Baseline

    if (hasConditionedSupport) {
      fallbackLevel = 'operation_conditioned';
      rankTier = 1;
    } else if (hasGenericSupport) {
      fallbackLevel = 'generic_path';
      rankTier = 2;
    } else if (hasCoChange) {
      fallbackLevel = 'historical_cochange';
      rankTier = 3;
    } else {
      fallbackLevel = 'structural_baseline';
      rankTier = 4;
    }

    return {
      ...c,
      occp_rankTier: rankTier,
      occp_fallbackLevel: fallbackLevel,
      occp_hasConditionedSupport: hasConditionedSupport,
      occp_condConfidence: hasConditionedSupport ? bestCondConf : 0,
      occp_condPositive: bestCondPos,
      occp_condTotal: bestCondTot,
      occp_condCategory: bestCondCat,
      occp_condSignature: bestCondSig,

      occp_hasGenericSupport: hasGenericSupport,
      occp_genConfidence: hasGenericSupport ? bestGenConf : 0,
      occp_genPositive: bestGenPos,
      occp_genTotal: bestGenTot,
      occp_genSignature: bestGenSig,

      occp_coChangeCount: coChange
    };
  });

  // Sort candidates by strict OCCP hierarchy
  ranked.sort((a, b) => {
    // Tier 1 vs 2 vs 3 vs 4
    if (a.occp_rankTier !== b.occp_rankTier) {
      return a.occp_rankTier - b.occp_rankTier;
    }

    // Within Tier 1: Conditioned confidence -> positive -> total -> hop -> structRank -> ID
    if (a.occp_rankTier === 1) {
      if (b.occp_condConfidence !== a.occp_condConfidence) {
        return b.occp_condConfidence - a.occp_condConfidence;
      }
      if (b.occp_condPositive !== a.occp_condPositive) {
        return b.occp_condPositive - a.occp_condPositive;
      }
      if (b.occp_condTotal !== a.occp_condTotal) {
        return b.occp_condTotal - a.occp_condTotal;
      }
      if (a.minHop !== b.minHop) {
        return a.minHop - b.minHop;
      }
      if (a.structuralBaselineRank !== b.structuralBaselineRank) {
        return a.structuralBaselineRank - b.structuralBaselineRank;
      }
      return a.id.localeCompare(b.id);
    }

    // Within Tier 2: Generic confidence -> positive -> total -> hop -> structRank -> ID
    if (a.occp_rankTier === 2) {
      if (b.occp_genConfidence !== a.occp_genConfidence) {
        return b.occp_genConfidence - a.occp_genConfidence;
      }
      if (b.occp_genPositive !== a.occp_genPositive) {
        return b.occp_genPositive - a.occp_genPositive;
      }
      if (b.occp_genTotal !== a.occp_genTotal) {
        return b.occp_genTotal - a.occp_genTotal;
      }
      if (a.minHop !== b.minHop) {
        return a.minHop - b.minHop;
      }
      if (a.structuralBaselineRank !== b.structuralBaselineRank) {
        return a.structuralBaselineRank - b.structuralBaselineRank;
      }
      return a.id.localeCompare(b.id);
    }

    // Within Tier 3: Co-change count -> structRank -> ID
    if (a.occp_rankTier === 3) {
      if (b.occp_coChangeCount !== a.occp_coChangeCount) {
        return b.occp_coChangeCount - a.occp_coChangeCount;
      }
      if (a.structuralBaselineRank !== b.structuralBaselineRank) {
        return a.structuralBaselineRank - b.structuralBaselineRank;
      }
      return a.id.localeCompare(b.id);
    }

    // Within Tier 4: Structural baseline rank -> ID
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    return a.id.localeCompare(b.id);
  });

  ranked.forEach((c, idx) => {
    c.occp_rank = idx + 1;
  });

  return ranked;
}

/**
 * Model 5: Reciprocal Rank Fusion (RRF) between Structural Baseline and Historical Co-change.
 *
 * Formula:
 *   RRF_score(d) = 1 / (k + rank_struct(d)) + 1 / (k + rank_hist(d))
 *
 * @param {Array<Object>} candidates - Candidates with structuralBaselineRank and proposedRank (historical)
 * @param {number} k - Smoothing parameter (default: 60)
 * @returns {Array<Object>} Candidates sorted by rrf_score descending
 */
export function rankModelRRF_StructuralHistory(candidates, k = RRF_K) {
  const fused = candidates.map(c => {
    const rStruct = c.structuralBaselineRank || 9999;
    const rHist = c.proposedRank || 9999;
    const rrfScore = (1 / (k + rStruct)) + (1 / (k + rHist));
    return {
      ...c,
      rrf_score: rrfScore
    };
  });

  fused.sort((a, b) => {
    if (b.rrf_score !== a.rrf_score) {
      return b.rrf_score - a.rrf_score;
    }
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    return a.id.localeCompare(b.id);
  });

  fused.forEach((c, idx) => {
    c.rrf_rank = idx + 1;
  });

  return fused;
}

/**
 * Model 6: RRF Composite fusing Structural Baseline, Historical Co-change, and OCCP.
 *
 * Formula:
 *   RRF_score(d) = 1 / (k + rank_struct(d)) + 1 / (k + rank_hist(d)) + 1 / (k + rank_occp(d))
 *
 * @param {Array<Object>} candidates - Candidates with structuralBaselineRank, proposedRank, and occp_rank
 * @param {number} k - Smoothing parameter (default: 60)
 * @returns {Array<Object>} Candidates sorted by rrf_occp_score descending
 */
export function rankModelRRF_Composite(candidates, k = RRF_K) {
  const fused = candidates.map(c => {
    const rStruct = c.structuralBaselineRank || 9999;
    const rHist = c.proposedRank || 9999;
    const rOccp = c.occp_rank || 9999;
    const rrfOccpScore = (1 / (k + rStruct)) + (1 / (k + rHist)) + (1 / (k + rOccp));
    return {
      ...c,
      rrf_occp_score: rrfOccpScore
    };
  });

  fused.sort((a, b) => {
    if (b.rrf_occp_score !== a.rrf_occp_score) {
      return b.rrf_occp_score - a.rrf_occp_score;
    }
    if (a.occp_rank !== b.occp_rank) {
      return a.occp_rank - b.occp_rank;
    }
    if (a.structuralBaselineRank !== b.structuralBaselineRank) {
      return a.structuralBaselineRank - b.structuralBaselineRank;
    }
    return a.id.localeCompare(b.id);
  });

  fused.forEach((c, idx) => {
    c.rrf_occp_rank = idx + 1;
  });

  return fused;
}
